# Contributing

Thanks for contributing to Treegress Browser Core.

## Before you start

1. Create or pick an issue first (except for small typo/docs-only fixes).
2. Confirm your change belongs in this repository:
- `treegress-browser-core` is the source of truth for snapshot, formatter, locator-plan and ref-resolution runtime behavior.
- MCP wiring-only changes should usually go to `treegress-browser-mcp`.

## Local setup

Requires Node.js 18+.

```bash
node --version
```

Clone this repository:

```bash
git clone https://github.com/MobiDev-Org/treegress-browser-core.git
cd treegress-browser-core
```

Install dependencies and start watch build:

```bash
npm ci
npm run watch
npx playwright install
```

## Where to make changes

Primary runtime areas:

- `packages/injected/src/*`
- `packages/playwright-core/src/server/*`
- `packages/playwright-core/src/tools/*`

Do not duplicate long-term custom-dom runtime logic in other repositories when it can live here.

## Tests

Run relevant tests before opening a PR.

Core/library path:

```bash
npm run ctest
npm run ttest
```

If you changed custom-dom runtime behavior, also run:

```bash
npm run test-custom-dom-prod-path
```

## Documentation

If behavior or public-facing workflow changes, update docs in the same PR.

At minimum, review:

- `README.md`
- `DEVELOPING.md`
- package README files under `packages/*`

## Commit messages

Use conventional commits:

```text
label(namespace): title
```

Recommended labels: `fix`, `feat`, `docs`, `test`, `devops`, `chore`.

## Pull request policy (strict)

All submissions require pull requests.

Required for merge:

1. CI is green.
2. Issue is linked.
3. At least one explicit approval from project administration/maintainers.
4. PR is merged by project administration/maintainers.

Repository administrators must enforce this with branch protection rules on protected branches.

## Dependency policy

There is a high bar for new dependencies and dependency upgrades.

Discuss dependency changes in an issue first and get maintainer approval before final review.

## Security and conduct

- Security reports: see `SECURITY.md`.
- Community behavior: see `CODE_OF_CONDUCT.md`.
