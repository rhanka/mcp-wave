import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";
import { ToolError } from "../../lib/errors.js";
import { type TaxRates, TaxRatesSchema } from "./schema.js";

export class TaxRatesLoader {
  private cache = new Map<string, TaxRates>();

  constructor(private readonly dir: string) {}

  async load(jurisdiction: string, year: number): Promise<TaxRates> {
    const key = `${jurisdiction.toLowerCase()}-${year}`;
    const cached = this.cache.get(key);
    if (cached) return cached;
    const file = join(this.dir, `${key}.yaml`);
    let raw: string;
    try {
      raw = await readFile(file, "utf8");
    } catch {
      throw new ToolError(
        "TAX_RATES_NOT_FOUND",
        { jurisdiction, year, file },
        "Add the YAML table for this jurisdiction/year to data/tax-rates/",
      );
    }
    const parsed = TaxRatesSchema.safeParse(parseYaml(raw));
    if (!parsed.success) {
      throw new ToolError(
        "TAX_RATES_INVALID",
        { jurisdiction, year, issues: parsed.error.issues },
        "Fix the YAML to match the schema in src/domain/tax/schema.ts",
      );
    }
    this.cache.set(key, parsed.data);
    return parsed.data;
  }

  async loadForDate(jurisdiction: string, isoDate: string): Promise<TaxRates> {
    const files = await readdir(this.dir).catch(() => []);
    const candidates = files.filter((f) =>
      f.toLowerCase().startsWith(`${jurisdiction.toLowerCase()}-`),
    );
    for (const f of candidates) {
      const m = f.match(/^.+-(\d{4})\.yaml$/);
      if (!m?.[1]) continue;
      const year = Number(m[1]);
      const table = await this.load(jurisdiction, year).catch(() => null);
      if (table && isoDate >= table.effective_from && isoDate <= table.effective_to) {
        return table;
      }
    }
    throw new ToolError(
      "TAX_RATES_NOT_FOUND",
      { jurisdiction, date: isoDate },
      "No tax rates table covers this date for this jurisdiction.",
    );
  }
}
