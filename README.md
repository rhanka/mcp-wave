# mcp-wave

Model Context Protocol server for [Wave Accounting](https://waveapps.com).

See `docs/superpowers/specs/2026-05-09-mcp-wave-design.md` for the design spec
and `docs/superpowers/plans/2026-05-09-mcp-wave-implementation.md` for the
implementation plan.

## Quick start

```bash
npm install
cp .env.example .env             # then fill in WAVE_API_TOKEN
npm run codegen                  # fetch Wave schema and generate TS SDK
npm run dev:stdio                # run MCP locally over stdio
```

## Status

Under active development.
