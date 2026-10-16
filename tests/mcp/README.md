# MCP Custom-DOM Snapshot Integration

This folder contains MCP integration tests.
The `custom-dom` snapshot backend now drives `browser_snapshot` refs and ref-based actions in MCP tools.

## What Changed

- The `dom` snapshot engine (default) captures snapshots through `Page._customDomSnapshot()` / the internal `Frame.customDomSnapshot` protocol method instead of the aria snapshot.
- `--snapshot-engine aria` (or `PLAYWRIGHT_MCP_SNAPSHOT_ENGINE=aria`, `snapshot.engine` in config) switches back to upstream aria snapshots.
- MCP snapshot rendering formats the normalized custom DOM envelope into MCP text with `e1`, `e2`, ... refs.
- Ref resolution path (tool `target` parameter) is:
  `alias ref -> stable serializer id -> locator plan -> Playwright Locator`.
- Ref resolution is strict: if a custom-dom ref cannot be resolved, the tool returns resolver diagnostics instead of falling back to aria refs. Capture a fresh snapshot and retry.
- Snapshots scoped to an element, depth-limited, with boxes or in JSON form use the aria engine.

## Architecture Summary

- Core returns a normalized envelope with frame tree + DOM + locator plans.
- The tools backend (`tools/backend/customDom*.ts`, `tab.ts`) builds:
  - human-readable snapshot text
  - alias map (`eN -> stableId + framePath`)
  - locator plan storage (`framePath::stableId -> plan`)
- Resolver compiles locator candidates from plan in priority order and picks the first unique candidate.
- Frame-aware resolution uses `framePath` captured from snapshot traversal.
- Upstream MCP specs run with `mcpSnapshotEngine: 'aria'` (fixture default); custom-dom specs opt into `'dom'`.
- Note: the focused custom-dom validation suite is Chromium-only.

## Setup (Few Commands)

```bash
git clone <your-fork-url>
cd treegress-browser-core
npm ci
npm run build
node packages/playwright-core/cli.js install chromium
```

Run the focused custom-dom MCP validation suite:

```bash
npm run test-mcp-custom-dom
```

## Limitations

- Incremental snapshot diff is not implemented for `custom-dom`; MCP falls back to full snapshot text.
- Frame targeting is based on snapshot `framePath`; if iframe tree changes after snapshot, old refs can become stale.
- Snapshot textual shape is MCP-compatible but not byte-for-byte equivalent to aria snapshot output.

## Debugging Tips

- Enable verbose MCP logs:
  `DEBUG=pw:mcp:* npm run test-mcp-custom-dom`
- Inspect generated locator code with:
  `browser_generate_locator` on the ref from snapshot.
- If a ref fails after navigation or heavy DOM mutation, capture a new snapshot and retry with fresh refs.
