# MCP Custom-DOM Snapshot Integration

This folder contains MCP integration tests.
The `custom-dom` snapshot backend now drives `browser_snapshot` refs and ref-based actions in MCP tools.

## What Changed

- `browser_snapshot` now requests Playwright core AI snapshots with backend `custom-dom`.
- MCP snapshot rendering now formats normalized custom DOM envelope into MCP text with `e1`, `e2`, ... refs.
- Ref resolution path is now:
  `alias ref -> stable serializer id -> locator plan -> Playwright Locator`.
- Ref resolution is custom-dom-first. In the current MVP build, strict custom-dom mode is enabled; if ref resolution fails, capture a fresh snapshot. aria backend remains available only as a debug override for snapshot capture.
- In this fork, browser_snapshot is still named/described using legacy accessibility wording in some code paths, but the default runtime backend for MCP snapshot flow is custom-dom.

## Architecture Summary

- Core returns a normalized envelope with frame tree + DOM + locator plans.
- MCP formatter builds:
  - human-readable snapshot text
  - alias map (`eN -> stableId + framePath`)
  - locator plan storage (`framePath::stableId -> plan`)
- Resolver compiles locator candidates from plan in priority order and picks the first unique candidate.
- Frame-aware resolution uses `framePath` captured from snapshot traversal.
- Note: the focused custom-dom validation suite is Chromium-only.

## Setup (Few Commands)

```bash
git clone <your-fork-url>
cd playwright
npm i
npm run build
npm run install-mcp-browser
```

Run MCP server:

```bash
npm run start-mcp
```

Run the focused custom-dom MCP validation suite:

```bash
npm run test-mcp-custom-dom
```

Run the same suite on all MCP projects:

```bash
npm run test-mcp-custom-dom-all
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
