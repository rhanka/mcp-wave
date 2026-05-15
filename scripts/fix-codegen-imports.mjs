// Post-codegen: rewrite the value-import of `RequestOptions` (a type-only
// export in graphql-request v7+) and `gql` (no-default-export in graphql-tag).
// Without this the generated SDK runs into ESM `SyntaxError` at load time.
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

if (patched !== raw) {
  await writeFile(TARGET, patched);
}
