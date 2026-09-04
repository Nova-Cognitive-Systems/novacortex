# NovaCortex on Unraid

Everything Unraid needs, in one folder.

| File | What it is |
|---|---|
| `docker-compose.unraid.yml` | The full stack in one file. Byte-identical copy of the repo-root file, which is the source of truth; `scripts/sync-unraid-templates.sh` keeps them equal and CI fails on drift. |
| `novacortex-redis.xml` | Community Apps template — Redis (sessions, rate limits). |
| `novacortex-surrealdb.xml` | Community Apps template — SurrealDB (memories, graph, knowledge base). |
| `novacortex-qdrant.xml` | Community Apps template — Qdrant (vector index). |
| `novacortex-api.xml` | Community Apps template — the REST + MCP API. |
| `novacortex-web.xml` | Community Apps template — the Web UI. |
| `novacortex-ollama.xml` | Community Apps template — optional Ollama sidecar for fully local embeddings. |
| `docker-compose.override.local-images.yml` | Development-only overlay that repoints api/web at locally built images. Used by `scripts/deploy-unraid.sh`. |

## Two ways to install

NovaCortex is five services — Redis, SurrealDB, Qdrant, the API and the Web UI. Both paths below
are supported, and both end up with the **same five container names**, so every command in these
docs works either way.

| | [Path A — Community Apps](#path-a--five-templates-from-community-apps) | [Path B — Compose Manager](#path-b--the-whole-stack-with-compose-manager) |
|---|---|---|
| Setup | Install five templates in order | One compose file + one `.env` |
| Paths, ports, secrets | Unraid UI fields | Edited in `.env` |
| Local embeddings (nothing leaves the server) | `novacortex-ollama` template + four fields on the API | `gen-env.sh --local-embeddings` + the `local-ai` profile |
| Best for | People who want everything in the Docker tab | Fastest path to a running stack |

## Path A — five templates from Community Apps

**Step 0, once:** create the shared Docker network. The containers find each other by name, and
container-name DNS only works on a user-defined network:

```bash
docker network create novacortex
```

Then install these five templates, **in this order**, so each one finds its dependencies already
running (Docker templates have no `depends_on`, so the order is on you):

| # | Template | Set in the UI |
|---|---|---|
| 1 | `novacortex-redis` | Data path, **Redis Password** |
| 2 | `novacortex-surrealdb` | Data path, **Root Username / Root Password** |
| 3 | `novacortex-qdrant` | Storage path |
| 4 | `novacortex-api` | API port, `SURREALDB_PASS`, `REDIS_URL` (with the Redis password in it) |
| — | `novacortex-ollama` | *Optional.* Model storage path. Install it before the API for [local embeddings](#local-embeddings-keeping-memory-text-on-your-server). |
| 5 | `novacortex-web` | Web UI port, API URL |

Each template already defaults its data path to the right place under
`/mnt/user/appdata/novacortex` and points at its siblings by container name, so in practice you
are only typing the two passwords and re-using them on the API.

Finish with the bootstrap code, exactly as in path B:

```bash
docker logs novacortex-api 2>&1 | grep -A1 "Bootstrap code"
```

Redis, SurrealDB and Qdrant deliberately publish **no ports** — they are reachable only from the
`novacortex` network, which is where you want a database holding your agent's memory.

## Path B — the whole stack with Compose Manager

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

On path A these are the **Web UI Port** and **API Port** fields in the templates; on path B they
are `WEB_PORT` / `API_PORT` in the `.env`.

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

## Local embeddings: keeping memory text on your server

Semantic search needs an embedding model. Out of the box NovaCortex uses **no** embeddings at all
and falls back to substring matching — `/health` and the Settings page always report which mode
is active, so a silent degrade is visible. To switch it on you either send memory text to OpenAI,
or run the model yourself. This section is the second option.

Both install paths give you the same thing: an Ollama container on the `novacortex` network that
the API talks to over an OpenAI-compatible endpoint. No memory text ever leaves the server.

### Path A — the `novacortex-ollama` template

1. Install `novacortex-ollama`. The only field that matters is where models are stored; several
   GB per chat model, so pick a location you are happy with.
2. Pull the embedding model — **nothing works until you do this**:

   ```bash
   docker exec novacortex-ollama ollama pull nomic-embed-text
   ```

3. Set four fields on the `novacortex-api` template:

   | Field | Value |
   |---|---|
   | Embeddings: Base URL | `http://novacortex-ollama:11434/v1` |
   | Embeddings: API Key | `ollama` — any non-empty value; Ollama ignores it |
   | Embeddings: Model | `nomic-embed-text` |
   | Embeddings: Vector Size | `768` |

For the intelligence layer as well — LLM fact extraction and append-only conflict resolution —
also `docker exec novacortex-ollama ollama pull qwen3:8b` and set **Intelligence: LLM Model** to
`qwen3:8b`. That is a separate feature: setting it alone does not enable embeddings.

### Path B — the `local-ai` compose profile

`gen-env.sh` writes the same settings for you:

```bash
./scripts/gen-env.sh --unraid --local-embeddings   # semantic search only
./scripts/gen-env.sh --unraid --local-ai           # search + intelligence layer
```

Either flag writes `OPENAI_BASE_URL`, `OPENAI_API_KEY`, `EMBEDDING_MODEL`,
`QDRANT_VECTOR_SIZE=768` and `OLLAMA_PULL`; `--local-ai` adds `LLM_MODEL=qwen3:8b`. Then enable
the profile. Compose Manager runs plain `docker compose up`, so add `COMPOSE_PROFILES=local-ai`
to the project's `.env` — Compose reads its own settings from that file:

```bash
docker compose --profile local-ai up -d    # equivalent, from a terminal
```

The bundled `ollama-init` container pulls the models listed in `OLLAMA_PULL` on first start, so
there is no manual `docker exec` step on this path.

### Vector size is the one that bites

`nomic-embed-text` produces **768**-dimension vectors; OpenAI's `text-embedding-3-small` produces
**1536**. `QDRANT_VECTOR_SIZE` has to match whichever model you use. A mismatch fails API startup
deliberately, rather than silently storing nothing.

Changing it on an install that already has memories means a **fresh Qdrant collection** — the
stored vectors have the old dimension and cannot be converted, so everything has to be
re-embedded. Decide before you start filling the memory, or plan the re-index.

Budget roughly 10 GB of RAM or VRAM for `qwen3:8b` plus `nomic-embed-text`, or pick smaller
models. CPU-only is fine for embeddings alone. For an NVIDIA GPU, install the **Nvidia Driver**
plugin from Community Apps, then on path A add `--runtime=nvidia` plus the `NVIDIA_VISIBLE_DEVICES`
variable in the Ollama template's Extra Parameters, or on path B use `docker-compose.gpu.yml`.

## About the templates

Each template installs one container, and every setting that matters — appdata path, host port,
password — is a `<Config>` field in the Unraid UI, so path A never asks you to edit a file.

`novacortex-api` and `novacortex-web` pin the same GHCR release the compose file defaults to
(currently `ghcr.io/nova-cognitive-systems/novacortex-{api,web}:1.3.2`) and offer `latest` as an
alternate tag in the branch selector. **They must run the same version as each other.** The three
backing-service templates pin the same upstream images the compose file uses
(`surrealdb/surrealdb:v2.2`, `qdrant/qdrant:v1.14.0`, `redis:7-alpine`, `ollama/ollama:latest`);
`scripts/sync-unraid-templates.sh --check` fails CI if any of those six pins drifts from the
compose file.

They are also usable individually. If you already run Qdrant and Redis for something else, point
`novacortex-api` at those instead; if the API lives on another host, install only
`novacortex-web` and set API URL to `http://THAT-HOST:3001`.

One wrinkle worth knowing: the Redis password is delivered through the template's Post Arguments
rather than straight into `redis-server`, because the official Redis image takes its password as
a command-line flag and has no environment variable for it. You still just type the password
into the masked **Redis Password** field — see the comment in `novacortex-redis.xml` for how it
is wired.

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
