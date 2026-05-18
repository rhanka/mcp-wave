# mcp-wave

Model Context Protocol server for [Wave Accounting](https://waveapps.com).

See `docs/superpowers/specs/2026-05-09-mcp-wave-design.md` for the design spec
and `docs/superpowers/plans/2026-05-09-mcp-wave-implementation.md` for the
implementation plan.

## Quick start

```bash
npm install
cp .env.example .env             # then fill in WAVE_API_TOKEN and WAVE_DEFAULT_BUSINESS_ID
npm run codegen                  # generate the TS SDK from the checked-in Wave schema
npm run dev:stdio                # run MCP locally over stdio
```

To refresh `data/wave-schema.graphql` from the live Wave API instead of the
checked-in schema, run `npm run codegen:introspect` first.

For local stdio use, keep `WAVE_AUTH_MODE=env_token`.
Switch to `WAVE_AUTH_MODE=bearer_passthrough` only when the MCP client must
forward its own Wave bearer token over HTTP.

## Tool catalog

Current MCP surface: 25 tools.

Read tools:
- `list_businesses`
- `list_customers`
- `get_customer`
- `list_invoices`
- `get_invoice`
- `get_invoice_payment`
- `download_invoice_pdf`
- `list_products`
- `list_vendors`
- `list_accounts`
- `get_account`
- `list_client_profiles`
- `get_payroll_rates`

Write tools:
- `create_invoice`
- `send_invoice`
- `mark_invoice_paid`
- `update_invoice_payment`
- `delete_invoice_payment`
- `send_invoice_payment_receipt`
- `delete_invoice`
- `create_customer`
- `upsert_product`

Workflow tools:
- `create_invoice_for_client`
- `setup_account_mapping`
- `split_payroll_remittance`

This catalog reflects the current public Wave schema. Transaction read tools and
financial report tools are not exposed because the public API does not provide
those surfaces today. Imported bank-transaction reconciliation is also still a
Wave-UI-only gap: this MCP can manage invoice payment records, but it cannot
list/match/split imported bank transactions through the public API.

## Stdio client config

Any stdio MCP client that accepts an `mcpServers` JSON block can launch the
server with this shape:

```json
{
  "mcpServers": {
    "wave-local": {
      "command": "npx",
      "args": ["tsx", "/absolute/path/to/mcp-wave/src/entrypoints/stdio.ts"],
      "env": {
        "WAVE_AUTH_MODE": "env_token",
        "WAVE_API_TOKEN": "wave_full_access_token",
        "WAVE_DEFAULT_BUSINESS_ID": "biz_x",
        "WAVE_GRAPHQL_ENDPOINT": "https://gql.waveapps.com/graphql/public"
      }
    }
  }
}
```

## HTTP smoke

Start the HTTP transport locally:

```bash
npm run dev:http
curl -fsS http://localhost:8080/healthz
```

Initialize an MCP HTTP session:

```bash
curl -i http://localhost:8080/mcp \
  -X POST \
  -H 'Accept: application/json, text/event-stream' \
  -H 'Content-Type: application/json' \
  -d '{
    "jsonrpc": "2.0",
    "id": 1,
    "method": "initialize",
    "params": {
      "protocolVersion": "2025-03-26",
      "capabilities": {},
      "clientInfo": { "name": "curl", "version": "0" }
    }
  }'
```

The response includes an `mcp-session-id` header. Reuse that header for
follow-up calls such as `tools/list`.

## Status

Under active development.
