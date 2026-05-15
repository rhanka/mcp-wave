import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";
import { ToolError } from "../../lib/errors.js";
import { type AccountMapping, AccountMappingSchema } from "./account-mapping-schema.js";

export class AccountMappingLoader {
  private cache: AccountMapping | null = null;

  constructor(
    private readonly dir: string,
    private readonly file = "default.yaml",
  ) {}

  async load(): Promise<AccountMapping> {
    if (this.cache) return this.cache;
    const path = join(this.dir, this.file);
    let raw: string;
    try {
      raw = await readFile(path, "utf8");
    } catch {
      throw new ToolError(
        "ACCOUNT_MAPPING_MISSING",
        { path },
        "Run setup_account_mapping or create data/account-mapping/default.yaml.",
      );
    }
    const parsed = AccountMappingSchema.safeParse(parseYaml(raw));
    if (!parsed.success) {
      throw new ToolError(
        "ACCOUNT_MAPPING_INVALID",
        { issues: parsed.error.issues },
        "Fix the YAML to match AccountMappingSchema.",
      );
    }
    this.cache = parsed.data;
    return parsed.data;
  }
}
