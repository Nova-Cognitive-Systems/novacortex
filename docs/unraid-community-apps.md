---
title: Unraid Community Apps
description: How NovaCortex is distributed through Unraid Community Applications, and the checklist for submitting or re-validating the repository
---

# Unraid Community Apps

Community Applications (CA) is how Unraid users discover software. This page covers what
NovaCortex ships for CA, why it is shaped that way, and the checklist for submitting the
repository at <https://ca.unraid.net/submit/new>.

For the user-facing install instructions see [`templates/unraid/README.md`](../templates/unraid/README.md).

## What we ship, and why

NovaCortex is five services (Redis, SurrealDB, Qdrant, API, Web UI) plus an optional Ollama
sidecar. A CA *Docker template* installs exactly one container, and CA's whole value is that the
Unraid UI can set paths, ports and secrets through `<Config>` entries. A submission that shipped
two templates and told everyone to hand-edit a `.env` for the rest would not deliver that.

So we ship **one template per service**, each with its settings as UI fields, plus the Compose
file for people who prefer one click. Both paths produce the same five container names. What we
deliberately do *not* do is invent a monolithic all-in-one image so that a single
`<Repository>` can stand in for the stack — that would mean maintaining a second, unsupported
deployment shape forever.

| Artifact | Purpose |
|---|---|
| `ca_profile.xml` (repo root) | Repository overview, icon and support links shown on the maintainer profile. Required by CA; submission cannot be finalised without a non-empty `<Profile>`. |
| `icon.svg` (repo root) | Repository icon referenced by `ca_profile.xml` and by every template. |
| `templates/unraid/novacortex-redis.xml` | Redis — sessions and rate limits. |
| `templates/unraid/novacortex-surrealdb.xml` | SurrealDB — memories, relation graph, knowledge base, tokens. |
| `templates/unraid/novacortex-qdrant.xml` | Qdrant — vector index. |
| `templates/unraid/novacortex-api.xml` | The REST + MCP API. |
| `templates/unraid/novacortex-web.xml` | The Web UI. |
| `templates/unraid/novacortex-ollama.xml` | Optional Ollama sidecar, so embeddings can run on the server instead of at OpenAI. |
| `docker-compose.unraid.yml` | The one-click alternative, linked from every template's `<Overview>`. |

The three backing-service templates are NovaCortex-flavoured presets of upstream images, not a
claim of ownership: `<Project>` points at the upstream project (surrealdb.com, qdrant.tech,
redis.io), `<Support>` points at our issue tracker because we maintain the template, and each
`<Overview>` says so in the first paragraph.

### How the templates fit together

The five containers share a user-defined Docker network called `novacortex`, created once with
`docker network create novacortex`. That is not decoration: container-name DNS does not work on
Docker's default bridge, and it is how `novacortex-api` reaches `ws://novacortex-surrealdb:8000`.
Every template's `<Overview>` opens with that step and the install order.

The template `<Name>` values are lowercase and identical to the compose `container_name` values,
because Unraid names the container after `<Name>`. That is what makes
`docker logs novacortex-api` work regardless of which path the user took.

Redis, SurrealDB and Qdrant publish no ports, matching the Compose stack.

### Two image quirks the templates work around

Both are load-bearing; do not "simplify" them away without re-testing on a real server.

**SurrealDB has no default `CMD`** (`ENTRYPOINT ["/surreal"]`, `Cmd: null`), so the template
supplies `<PostArgs>start</PostArgs>`. Everything else goes through the documented `SURREAL_*`
environment variables, which is what keeps the root password an ordinary masked template field.
The image also defaults to uid 65532 while Unraid appdata is root-owned, so the template carries
`<ExtraParams>--user 0:0</ExtraParams>`, mirroring `user: "0:0"` in the compose file.

**`redis-server` takes its password as a command-line flag** and the official image exposes no
environment variable for it, so a naive template would force users into the Post Arguments box.
Instead `<PostArgs>` re-enters the image's own entrypoint through `sh -c`, which expands
`"$REDIS_PASSWORD"` from a normal masked `<Config>` variable. The re-entry matters: on the second
pass the entrypoint still sees `redis-server` as `$1` while running as root, so it chowns `/data`
to uid 999 and drops privileges with `gosu` exactly as upstream intends, instead of leaving Redis
running as root.

`<PostArgs>` is worth a note of its own. Unraid reads and writes it as a first-class template
field — it is the "Post Arguments" box in the container editor, serialised in
`emhttp/plugins/dynamix.docker.manager/include/Helpers.php`, and appended after the image name in
`docker run` — but it is **not** in CA's published [XML field
reference](https://ca.unraid.net/submit/help/xml-field-reference). CA installs an app by handing
Unraid the original XML from `TemplateURL`, so it should arrive intact. If SurrealDB or Redis
comes up misconfigured after a CA install, check whether `PostArgs` survived before looking
anywhere else.

### Compose source packages (future)

CA's parser has an undocumented-but-public contract for shipping a Compose project directly,
listed in the [XML field reference](https://ca.unraid.net/submit/help/xml-field-reference):

| Tag | Meaning |
|---|---|
| `<AppTemplateType>` | Installer contract type. `compose` selects a Compose source package. |
| `<ComposeSourceRepository>` | GitHub repository containing the Compose project source. |
| `<ComposeProjectPath>` | Repository-relative directory whose **root contains `compose.yaml`**. |
| `<ComposeSourceCommit>` | Exact lowercase 40-character Git commit SHA of the Compose source. |

This is the right long-term home for the NovaCortex stack, and it targets Unraid 8. We are not
using it yet for two reasons: the contract page it is supposed to be described on
(`/submit/help/compose-packages`) is still a 404, and `<ComposeSourceCommit>` pins an exact
commit, which needs a stamping step in the release workflow (build the compose directory, push,
then commit the resulting SHA into the template). Adopting it means adding
`templates/unraid/compose/compose.yaml` (note the filename — CA wants `compose.yaml`, not
`docker-compose.yml`) and teaching `.github/workflows/release.yml` to stamp the SHA.

## Facts worth knowing before you touch the templates

- **Images are real and public.** `ghcr.io/nova-cognitive-systems/novacortex-api` and
  `…/novacortex-web` are published by `.github/workflows/release.yml` on every `v*` tag, as
  `{version}`, `{major}.{minor}` and `latest`. Anonymous pulls work — CA's scan checks that
  `<Repository>` resolves.
- **The web image is amd64-only** (Next.js builds are impractically slow under QEMU arm64).
  Unraid is x86_64-only, so this does not affect Unraid users. The api image is amd64 + arm64.
- **The upstream pins are real too** — `surrealdb/surrealdb:v2.2`, `qdrant/qdrant:v1.14.0`,
  `redis:7-alpine` and `ollama/ollama:latest` all resolve anonymously on Docker Hub.
- **Versions must stay aligned.** All five templates pin exactly what the compose file uses.
  `scripts/sync-unraid-templates.sh --check` enforces this, and CI runs it — a NovaCortex release
  bump has to touch `docker-compose.yml`, `docker-compose.unraid.yml`, `scripts/gen-env.sh` and
  the api + web templates together, and bumping a backing service means the compose file and its
  template.
- **`templates/unraid/docker-compose.unraid.yml` is a generated copy** of the repo-root file.
  Edit the root file and run `scripts/sync-unraid-templates.sh`.

## Submission checklist

CA requirements, each mapped to the thing in this repository that satisfies it. Re-check these
whenever the templates change.

- [x] **Repository is public and active** — <https://github.com/Nova-Cognitive-Systems/novacortex>,
      not archived or disabled.
- [x] **OSI-approved licence at the repository root** — `LICENSE` (Apache-2.0). This covers the
      repository contents; container image licensing is assessed separately.
- [x] **`ca_profile.xml` at the repository root with a non-empty `<Profile>`** — describes the
      repository, links the icon, and sets `WebPage` = <https://novacortex.dev>. There is no
      `<Discord>`, because there is no NovaCortex Discord. `<Forum>` — documented as "forum
      thread **or support landing page**" — holds the GitHub Issues URL, since there is no
      Unraid forum thread yet; if one is ever created, point `<Forum>` at it and move the
      Issues link into the `<Profile>` text.
- [x] **Repository icon that is not the starter placeholder** — `icon.svg`, the NovaCortex mark
      in the product's own palette (`#0a0e17` ground, `#00f0ff` cyan, `#ff2d95` accent).
- [x] **Valid Docker template XML** — one file per container under `templates/unraid/`, each
      with `Name`, a resolvable `Repository`, `Registry`, `Network`, `Support`, `Project`,
      `Overview`, `Description`, `Category`, `Icon` and `TemplateURL`, plus `WebUI` on the two
      that have a browser interface.
- [x] **Settings are `<Config>` fields, not documentation** — every appdata path, host port and
      password the user must choose is an editable field in the Unraid UI. Nothing in path A
      requires touching a file over SSH.
- [x] **Every template has a `TemplateURL`** pointing at the raw GitHub URL of *that exact file*
      on `main`. These 404 until the branch is merged — verify them after merge.
- [x] **CA-valid categories** — `AI:Tools Tools:Utilities`. Both paths exist in
      <https://ca.unraid.net/api/categories>; the parser normalises the string into a
      `CategoryList`.
- [x] **No starter placeholders left** — the old `templates/unraid/novacortex.xml` pointed at the
      nonexistent image `ghcr.io/nova/novacortex` and the wrong GitHub org `Nova/novacortex`; it
      has been deleted.

### Verifying before you click Submit

```bash
# 1. XML is well-formed and has the tags CA requires
python3 -c "import xml.dom.minidom,sys; [xml.dom.minidom.parse(f) for f in sys.argv[1:]]" \
  ca_profile.xml templates/unraid/*.xml

# 2. Unraid artifacts have not drifted
./scripts/sync-unraid-templates.sh --check

# 3. Every URL in the templates resolves (run after merging to main)
grep -ho 'https://[^<[:space:]"]*' ca_profile.xml templates/unraid/*.xml | sort -u \
  | while read -r u; do printf '%s %s\n' "$(curl -s -o /dev/null -w '%{http_code}' -L "$u")" "$u"; done

# 4. The pinned images really exist on GHCR (anonymous pull, no docker needed)
for img in novacortex-api novacortex-web; do
  tok=$(curl -s "https://ghcr.io/token?scope=repository:nova-cognitive-systems/$img:pull&service=ghcr.io" \
        | sed 's/.*"token":"\([^"]*\)".*/\1/')
  curl -s -o /dev/null -w "$img %{http_code}\n" -H "Authorization: Bearer $tok" \
    -H "Accept: application/vnd.oci.image.index.v1+json" \
    "https://ghcr.io/v2/nova-cognitive-systems/$img/manifests/1.3.2"
done

# 5. ...and so do the three upstream images the backing-service templates pin
for spec in surrealdb/surrealdb:v2.2 qdrant/qdrant:v1.14.0 library/redis:7-alpine; do
  repo=${spec%:*}; tag=${spec##*:}
  tok=$(curl -s "https://auth.docker.io/token?service=registry.docker.io&scope=repository:$repo:pull" \
        | sed 's/.*"token":"\([^"]*\)".*/\1/')
  curl -s -o /dev/null -w "$spec %{http_code}\n" -H "Authorization: Bearer $tok" \
    -H "Accept: application/vnd.oci.image.index.v1+json,application/vnd.docker.distribution.manifest.list.v2+json" \
    "https://registry-1.docker.io/v2/$repo/manifests/$tag"
done
```

### Then, in the submission flow

1. Sign in at <https://ca.unraid.net/submit/new> with GitHub OAuth (the submitter must have
   access to the repository).
2. Enter the repository URL and run **Validate**.
3. Run **Scan**. It resolves `TemplateURL`, `Repository`, `Icon` and the `ca_profile.xml`
   profile, so all of them must already be live on `main`.
4. Fix anything the scan reports, push, and re-run Validate + Scan.
5. Submit for review. Docker submissions are reviewed by CA moderators; expect questions about
   why a five-service stack ships single-container templates — the answer is the `<Overview>`
   text, which points at Compose Manager.

## After the templates are live

- CA re-reads `TemplateURL` on its own schedule, so template edits merged to `main` propagate
  without re-submitting.
- Bumping the NovaCortex release means bumping the pinned tag in both templates in the same
  commit as the compose files. `scripts/sync-unraid-templates.sh --check` in CI will not let a
  half-done bump merge.
