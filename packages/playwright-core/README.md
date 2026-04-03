# @treegress.com/treegress-browser-core

This package contains the browser automation core used by the Treegress MCP server.

Most users should install [`@treegress.com/treegress-browser-mcp`](https://www.npmjs.com/package/@treegress.com/treegress-browser-mcp) instead of using this package directly.

## Why Treegress Extends Playwright MCP

AI agents need access to the actual page structure they are testing.

Standard Playwright MCP flows expose an ARIA snapshot derived from the accessibility tree. In real test flows, that can hide interactable UI when elements are poorly represented in the accessibility layer.

Treegress extends this flow by:

- serializing the full DOM tree
- extracting the full set of interactable elements
- assigning a `refId` to each element so downstream actions such as `click`, `fill`, and similar operations can target them reliably

This package provides the core snapshot, formatting and locator logic behind that behavior. In practice, it gives the agent a structurally complete representation of the page instead of a partial accessibility abstraction, improving element coverage and enabling broader, more reliable test scenarios.

If you want to see what Treegress is building in this area, visit [treegress.com](https://treegress.com).

## Installation

If you are configuring an MCP client, add the MCP server package to your client config rather than installing `@treegress.com/treegress-browser-core` globally.

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

Use the same `command` and `args` values in your client-specific MCP config:

- Cursor: place this server under `mcpServers` in `.cursor/mcp.json`
- VS Code or other MCP-capable editors: add the same `stdio` server in the client's MCP settings UI or config file
- Claude Desktop and similar clients: map the same values into that client's server definition format

If your client only accepts a single shell command, use this equivalent launcher:

```bash
bash -lc 'npm_config_cache=/tmp/treegress-mcp-cache npx --yes --package=@treegress.com/treegress-browser-mcp@latest treegress-browser-mcp --snapshot-engine dom'
```

If you need the core package directly:

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

## Maintainers

Before `npm pack` or `npm publish`, run `npm run build` from the repository root so generated runtime artifacts are current. Full release and dependency-sync workflow lives in `DEVELOPING.md`.
