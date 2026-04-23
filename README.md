# Treegress Browser Core

[![npm](https://img.shields.io/npm/v/%40treegress.com%2Ftreegress-browser-core?label=%40treegress.com%2Ftreegress-browser-core)](https://www.npmjs.com/package/@treegress.com/treegress-browser-core)
[![npm](https://img.shields.io/npm/v/%40treegress.com%2Ftreegress-browser-mcp?label=%40treegress.com%2Ftreegress-browser-mcp)](https://www.npmjs.com/package/@treegress.com/treegress-browser-mcp)

Treegress Browser Core is a Treegress-maintained fork of [Playwright](https://playwright.dev) focused on richer DOM snapshots and locator plans for AI-driven browser automation.

This repository is the source for the published package [`@treegress.com/treegress-browser-core`](https://www.npmjs.com/package/@treegress.com/treegress-browser-core). In production it is typically used together with [`@treegress.com/treegress-browser-mcp`](https://www.npmjs.com/package/@treegress.com/treegress-browser-mcp), which exposes the MCP server layer on top of this core.

## Why Treegress Extends Playwright MCP

AI agents need access to the actual page structure they are testing.

Standard Playwright MCP flows expose an ARIA snapshot derived from the accessibility tree. In real test flows, not just simple demos, that can leave part of the UI outside the model's view when interactable elements are poorly represented in the accessibility layer.

Treegress extends this flow by:

- serializing the full DOM tree
- extracting the full set of interactable elements
- assigning a `refId` to each element so downstream actions such as `click`, `fill`, and similar operations can target them reliably

This gives the agent a structurally complete representation of the page instead of a partial accessibility-based abstraction. In practice, that improves element coverage and enables broader, more reliable test scenarios.

If you want to see what Treegress is building in this area, visit [treegress.com](https://treegress.com).

## What This Fork Adds

- Custom DOM snapshot backend for `browser_snapshot`
- Richer snapshot text formatting for LLM agents
- Ref-to-locator plans used by MCP browser tools
- Treegress-specific browser automation flow built on top of Playwright internals

## Installation

Most users should install the MCP package, not the core package directly.

### Recommended: generic MCP client setup

Any MCP client that supports a local `stdio` server can run Treegress with this process configuration:

```json
{
  "name": "treegress-browser",
  "type": "stdio",
  "command": "npx",
  "args": [
    "--yes",
    "--package=@treegress.com/treegress-browser-mcp@latest",
    "treegress-browser-mcp",
    "--snapshot-engine",
    "dom"
  ]
}
```

Use the same `command` and `args` values in your client-specific config format:

- Cursor: place this server under `mcpServers` in `.cursor/mcp.json`
- VS Code or other MCP-capable editors: add the same `stdio` server in the client's MCP settings UI or config file
- Claude Desktop and similar clients: map the same values into that client's server definition format

If your client only accepts a single shell command, use this equivalent launcher:

```bash
bash -lc 'npm_config_cache=/tmp/treegress-mcp-cache npx --yes --package=@treegress.com/treegress-browser-mcp@latest treegress-browser-mcp --snapshot-engine dom'
```

Notes:

- Requires `Node.js 18+`
- Global `npm i -g` is not required
- `@treegress.com/treegress-browser-core` is installed automatically as a dependency of `@treegress.com/treegress-browser-mcp`
- `--snapshot-engine dom` enables the Treegress custom DOM path

### Direct core install

Only use this if you explicitly need the browser core package outside the MCP server:

```bash
npm i @treegress.com/treegress-browser-core
```

The CLI binary remains:

```bash
npx --yes --package=@treegress.com/treegress-browser-core@latest treegress-browser-core --help
```

## How It Fits Together

The Treegress browser stack is split into two published packages:

- [`@treegress.com/treegress-browser-core`](https://www.npmjs.com/package/@treegress.com/treegress-browser-core)
- [`@treegress.com/treegress-browser-mcp`](https://www.npmjs.com/package/@treegress.com/treegress-browser-mcp)

Source repositories:

- Core runtime repository: [github.com/MobiDev-Org/treegress-browser-core](https://github.com/MobiDev-Org/treegress-browser-core)
- MCP adapter repository: [github.com/MobiDev-Org/treegress-browser-mcp](https://github.com/MobiDev-Org/treegress-browser-mcp)

Role split:

- `treegress-browser-core` (this repository) is the source of truth for custom-dom snapshot/runtime behavior.
- `treegress-browser-mcp` consumes the core runtime and exposes MCP server/tool integration.

This repository keeps the upstream Playwright monorepo structure. The publishable core package lives in:

- [`packages/playwright-core`](packages/playwright-core)

## Maintainers

Before `npm pack` or `npm publish`, run `npm run build` from the repository root so generated runtime artifacts are current. Full release and verification steps live in [`DEVELOPING.md`](DEVELOPING.md).

## Based On Playwright

This is a customized fork built on top of Microsoft Playwright.

- Upstream repository: [github.com/microsoft/playwright](https://github.com/microsoft/playwright)
- Upstream docs: [playwright.dev](https://playwright.dev)
- License: Apache-2.0

Treegress-specific changes should stay clearly separated from upstream behavior where possible. The goal of this fork is to extend Playwright for Treegress browser automation, not to obscure its origin.

## Copyright And Licensing

Copyright 2026 MobiDev Corporation. All rights reserved.

This project is licensed under the Apache License 2.0, except for `packages/injected/src/customDomSerializer.ts`, which is subject to a custom non-commercial license. See the file header for details.
