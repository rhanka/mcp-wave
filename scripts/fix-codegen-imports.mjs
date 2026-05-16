// Post-codegen patches for the typescript-graphql-request plugin output:
//   1. `RequestOptions` is a type-only export in graphql-request v7+, the
//      plugin still imports it as a value (ESM SyntaxError at load time).
//   2. `gql` is a named export in graphql-tag, not a default.
//   3. In graphql-codegen v7, the `typescript` and `typescript-operations`
//      plugins both emit enum-type aliases (AccountTypeValue, CurrencyCode,
//      InvoiceStatus, …) duplicating each block. Strip the second occurrence
//      of every `export type X = ...` declaration to dedupe.
import { readFile, writeFile } from "node:fs/promises";

const TARGET = "src/wave/generated/sdk.ts";

const raw = await readFile(TARGET, "utf8");

let patched = raw.replace(
  /^import \{ GraphQLClient, RequestOptions \} from 'graphql-request';$/m,
  "import { GraphQLClient } from 'graphql-request';\nimport type { RequestOptions } from 'graphql-request';",
);
patched = patched.replace(
  /^import gql from 'graphql-tag';$/m,
  "import { gql } from 'graphql-tag';",
);

// Dedupe top-level `export type X = ...;` blocks. Strategy: walk through every
// top-level export-type declaration; on second occurrence of the same name,
// drop that whole declaration block (including its leading JSDoc comment).
{
  const blockRegex =
    /(?:\/\*\*[\s\S]*?\*\/\s*\n)?export type ([A-Za-z_][A-Za-z0-9_]*) =[\s\S]*?(?=\n(?:\/\*\*|export |import |\nconst |\nfunction |\ntype ))/g;
  const seen = new Set();
  patched = patched.replace(blockRegex, (match, name) => {
    if (seen.has(name)) return "";
    seen.add(name);
    return match;
  });
}

if (patched !== raw) {
  await writeFile(TARGET, patched);
}
