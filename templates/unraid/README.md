# NovaCortex on Unraid

Everything Unraid needs, in one folder.

| File | What it is |
|---|---|
| `docker-compose.unraid.yml` | The full stack. Byte-identical copy of the repo-root file, which is the source of truth; `scripts/sync-unraid-templates.sh` keeps them equal and CI fails on drift. |
| `novacortex-web.xml` | Community Apps template for the Web UI container on its own. |
| `novacortex-api.xml` | Community Apps template for the API container on its own. |
| `docker-compose.override.local-images.yml` | Development-only overlay that repoints api/web at locally built images. Used by `scripts/deploy-unraid.sh`. |

## Install the full stack (recommended)

NovaCortex is five services — SurrealDB, Qdrant, Redis, the API and the Web UI — so the
supported install is Compose, not a single Docker template.

1. Install the **Docker Compose Manager** plugin from Community Apps.
2. **Docker → Compose → Add New Stack**, name it `novacortex`. The plugin creates
   `/boot/config/plugins/compose.manager/projects/novacortex/`.
3. Put `docker-compose.unraid.yml` in that directory as `docker-compose.yml` — either paste it
   into the plugin's compose editor, or from an Unraid terminal:

   ```bash
   cd /boot/config/plugins/compose.manager/projects/novacortex
   curl -fsSL -o docker-compose.yml \
     https://raw.githubusercontent.com/Nova-Cognitive-Systems/novacortex/main/docker-compose.unraid.yml
   ```

4. Create the `.env` next to it. The stack refuses to start without `SURREALDB_PASS` and
   `REDIS_PASSWORD`, so generate them rather than inventing them. **Use `--unraid`** — it is
   what sets `APPDATA` to the array instead of next to the compose file (see
   [Data root](#data-root-the-one-setting-that-breaks-installs) below):

   ```bash
   # still in the project directory, on the Unraid terminal
   curl -fsSL -o gen-env.sh \
     https://raw.githubusercontent.com/Nova-Cognitive-Systems/novacortex/main/scripts/gen-env.sh
   bash gen-env.sh --unraid .env        # add --local-ai for the fully offline variant
   rm gen-env.sh
   ```

   Run on the server itself, `--unraid` is also auto-detected. `.env.unraid.example` in the repo
   root documents every value the compose file reads.

5. **Check the ports are free** before starting — see [Ports](#ports):

   ```bash
   ss -ltnp | grep -E ':(3000|3001)'   # no output = both free
   ```

6. **Compose Up**. First start pulls the pinned GHCR images and initialises the databases.
7. Read the one-time bootstrap code and finish setup:

   ```bash
   docker logs novacortex-api 2>&1 | grep -A1 "Bootstrap code"
   ```

   Open `http://<server-ip>:3000` (or whatever `WEB_PORT` you set), paste the `nc_boot_…` code
   on the login page, and you have an admin token.

### Ports

| Variable | Default | Service | Notes |
|---|---|---|---|
| `WEB_PORT` | 3000 | Web UI | **Frequently already taken.** 3000 is the default for Grafana, Homepage, Overseerr and plenty more; `WEB_PORT=3100` is a safe alternative. |
| `API_PORT` | 3001 | REST API | Swagger at `/docs`. |

Only the host side moves. The containers keep listening on 3000/3001 internally, the Web UI
still reaches the API over the internal Docker network, and the Community Apps *WebUI* link
follows whatever host port you set. If you set `CORS_ORIGINS`, update the port there to match.

SurrealDB, Qdrant and Redis are reachable only on the internal `novacortex` Docker network —
they are deliberately not published to the LAN.

### Data root: the one setting that breaks installs

`APPDATA` must be an **absolute path on the array or a pool**. The default,
`/mnt/user/appdata/novacortex`, is correct; a relative path like `./data` is not.

Compose Manager keeps its projects under `/boot/config/plugins/compose.manager/projects/`, and
`/boot` is the **FAT32 USB boot flash**. FAT32 has no Unix ownership, and it is a USB stick. A
relative `APPDATA` therefore puts Redis' append-only file and SurrealDB's RocksDB store there,
where they cannot work: the Redis image chowns `/data` to its own `redis` user (uid 999) at
startup before dropping privileges, that chown cannot succeed on FAT32, and the container
restart-loops while its healthcheck reports unhealthy. Even if it did start, you would be
writing a database's write-ahead log to the boot flash.

`scripts/gen-env.sh --unraid` sets this correctly. If you hit the symptom on an existing
install, fix `APPDATA` in `.env`, then recreate the stack:

```bash
docker compose down
docker compose up -d
```

### Appdata layout

Everything under `${APPDATA}` is bind-mounted, so it survives `docker.img` rebuilds and is
covered by the Unraid appdata backup plugin:

```
/mnt/user/appdata/novacortex/
├── surrealdb/   # memories, relations, knowledge base, tokens (RocksDB)
├── qdrant/      # vector index
└── redis/       # sessions + rate-limit state (regenerable)
```

Ollama models are the one exception: they live in the named `ollama-models` Docker volume, since
they are large and re-downloadable.

On a normal appdata path you do **not** need to chown anything by hand. Each container sorts its
own ownership out: SurrealDB runs as root (the compose file pins `user: "0:0"` because pre-v1.3
data is root-owned), Qdrant runs as root, and Redis starts as root only to chown `/data` to
uid 999 before dropping to that user. If you restored a backup and Redis still logs a permission
error, this puts it right:

```bash
chown -R 999:999 /mnt/user/appdata/novacortex/redis
docker restart novacortex-redis
```

### Fully offline AI (`local-ai` profile)

The compose file ships an optional Ollama sidecar. With it, embeddings **and** the memory
intelligence layer run on this server and no memory text ever leaves it:

```bash
./scripts/gen-env.sh --local-ai     # writes OPENAI_BASE_URL, EMBEDDING_MODEL,
                                    # QDRANT_VECTOR_SIZE=768, LLM_MODEL, OLLAMA_PULL
docker compose --profile local-ai up -d
```

Compose Manager runs plain `docker compose up`, so the way to enable the profile there is to add
`COMPOSE_PROFILES=local-ai` to the project's `.env` — Compose reads its own settings from that
file. Budget ~10 GB RAM/VRAM for `qwen3:8b` plus `nomic-embed-text`, or pick smaller models.

`nomic-embed-text` produces 768-dimension vectors, so `QDRANT_VECTOR_SIZE=768` needs a **fresh**
Qdrant collection. Switching embedding models on an existing install means re-embedding.

## The Community Apps templates

`novacortex-web.xml` and `novacortex-api.xml` install one container each, against backing
services you already run. They exist for people who, for example, already have Qdrant and Redis
on their server, or who want the Web UI on one box and the API on another. They are not a
replacement for the Compose install — neither container is useful on its own.

Both pin the same GHCR release the compose file defaults to (currently
`ghcr.io/nova-cognitive-systems/novacortex-{web,api}:1.3.2`) and offer `latest` as an alternate
tag in the template's branch selector. **The Web UI and API must run the same version.**

See [`docs/unraid-community-apps.md`](../../docs/unraid-community-apps.md) for the Community
Apps submission checklist.

## Testing an unreleased build

`scripts/deploy-unraid.sh` builds the api and web images on your workstation, side-loads them
onto the server over SSH, and installs `docker-compose.unraid.yml` plus
`docker-compose.override.local-images.yml` (which repoints only those two services at the local
tags). Everything else stays identical to a normal install.

```bash
UNRAID_IP=192.168.1.100 ./scripts/deploy-unraid.sh
```
