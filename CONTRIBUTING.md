# Contributing to NovaCortex

## Commit identity (enforced in CI)

All commits on this repository are authored by the project bot, `Nova-DevBot`. This is a
hard requirement checked by the `Commit identity` workflow:

- `author.name` must be **`Nova-DevBot`**
- `author.email` must be **`dev@novacognitive.com`** or
  **`298337751+Nova-DevBot@users.noreply.github.com`**

Either email is accepted; anything else — including personal human accounts — fails CI.
Configure your clone before committing:

```bash
git config user.name  "Nova-DevBot"
git config user.email "dev@novacognitive.com"
```

The committer may be GitHub (that is what happens when a PR is merged), and merge commits
are skipped by the check. Only the commit *author* is enforced. Full rule and the
re-authoring recipe for rejected commits: [AGENTS.md](./AGENTS.md).

## Pull requests

- One concern per PR; do not bundle unrelated work.
- Run the local checks before pushing:

```bash
npm ci
npm run build --workspace=packages/core
npm run lint
npm test                # needs the dev stack: npm run dev:db
```

- CI runs lint + typecheck, the live-stack test suite, Docker builds, a dependency audit,
  and the commit-identity check. All must pass.

## Security

Never commit secrets, `.env` files, or license signing keys. To report a vulnerability,
see [SECURITY.md](./SECURITY.md).
