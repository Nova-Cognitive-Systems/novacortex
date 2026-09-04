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

NovaCortex is five services (SurrealDB, Qdrant, Redis, API, Web UI) plus an optional Ollama
sidecar. A CA *Docker template* installs exactly one container, so there is no honest way to
express the whole stack as one template — and inventing a monolithic all-in-one image just to
have something for `<Repository>` to point at would mean maintaining a second, unsupported
deployment shape.

So the install path stays **Docker Compose Manager**, and what we ship to CA is metadata that is
true:

| Artifact | Purpose |
|---|---|
| `ca_profile.xml` (repo root) | Repository overview, icon and support links shown on the maintainer profile. Required by CA; submission cannot be finalised without a non-empty `<Profile>`. |
| `icon.svg` (repo root) | Repository icon referenced by `ca_profile.xml` and by both templates. |
| `templates/unraid/novacortex-web.xml` | Docker template for the Web UI container alone. |
| `templates/unraid/novacortex-api.xml` | Docker template for the API container alone. |
| `docker-compose.unraid.yml` | The actual supported install, linked from both templates' `<Overview>`. |

The two Docker templates are genuinely useful on their own — Unraid users who already run
Qdrant, Redis and SurrealDB as separate containers can install just the API, and someone running
the API elsewhere can install just the Web UI — but both `<Overview>` blocks say plainly that a
fresh install should use Compose, and `<Requires>` names the missing dependencies.

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
- **Versions must stay aligned.** Both templates pin the same tag the compose files default to.
  `scripts/sync-unraid-templates.sh --check` enforces this, and CI runs it — a release bump has
  to touch `docker-compose.yml`, `docker-compose.unraid.yml`, `scripts/gen-env.sh` and both
  template XMLs together.
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
- [x] **Valid Docker template XML** — one file per app under `templates/unraid/`, each with
      `Name`, a resolvable `Repository`, `Registry`, `Network`, `Support`, `Project`, `Overview`,
      `Description`, `Category`, `WebUI` and `Icon`.
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
