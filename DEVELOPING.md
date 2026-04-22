# Developing Treegress Browser Core

This document is for maintainers of the Treegress Playwright fork.

User-facing project information belongs in [`README.md`](README.md). Keep release and maintenance workflow out of the package README files so GitHub and npm previews stay product-focused.

## Package Boundaries

This repository publishes:

- [`@treegress.com/treegress-browser-core`](https://www.npmjs.com/package/@treegress.com/treegress-browser-core)

The companion MCP package is maintained in a separate repository and publishes:

- `@treegress.com/treegress-browser-mcp`

Runtime coordination rule:

- if browser snapshot, formatter, locator compilation or ref-resolution changes, update core first
- then update the pinned core dependency in the MCP package and publish a new MCP version
- if only MCP wiring or packaging changes, a core release may not be necessary

## Source Of Truth

Custom DOM snapshot and locator behavior belongs in this repository.

Important areas:

- `packages/injected/src/*`
- `packages/playwright-core/src/server/*`
- `packages/playwright-core/src/tools/*`

Do not duplicate long-term snapshot or ref-resolution logic in the MCP repository when it can live here.

## Build

Build is mandatory before `npm pack` or `npm publish`.

Reason:

- published tarballs include generated `lib/*` and injected runtime artifacts, not just `src/*`
- packing without a fresh build can ship stale runtime code even when the source files are correct

```bash
cd <treegress-browser-core-repo>
npm run clean
npm run build
```

If the release changes custom DOM snapshot runtime behavior, verify the built runtime path before packing:

```bash
cd <treegress-browser-core-repo>
npm run test-custom-dom-prod-path
```

## Pack

Only pack after a fresh successful build.

```bash
mkdir -p /tmp/treegress-release-artifacts
mkdir -p /tmp/treegress-npm-cache

cd <treegress-browser-core-repo>/packages/playwright-core
npm_config_cache=/tmp/treegress-npm-cache npm pack --dry-run
npm_config_cache=/tmp/treegress-npm-cache npm pack --pack-destination /tmp/treegress-release-artifacts
```

## Publish

Before publishing:

- bump `packages/playwright-core/package.json`
- confirm `repository`, `homepage`, `author` and README content are correct
- run `npm run build`
- rerun verification if generated runtime or bundled assets changed after the last build

Publish:

```bash
cd <treegress-browser-core-repo>/packages/playwright-core
npm_config_cache=/tmp/treegress-npm-cache npm publish --access public
npm view @treegress.com/treegress-browser-core version
```

## After Core Release

If the MCP package depends on new runtime behavior from core:

1. Update the pinned `playwright-core` alias in the MCP package.
2. Bump the MCP package version.
3. Pack and publish the MCP package after core is visible in npm.

## Documentation Rule

- `README.md` and package-level README files are for users
- release notes, coordination rules and maintainer workflow belong here

## PR Governance

Protected branches should enforce:

- pull-request-only changes (no direct pushes)
- required status checks
- at least one approval from project administration/maintainers
- merge performed by project administration/maintainers

## Maintainers

For release, dependency-sync and build instructions, see [`DEVELOPING.md`](DEVELOPING.md).

Package-specific notes for the published core package live in:

- [`packages/playwright-core/README.md`](packages/playwright-core/README.md)
