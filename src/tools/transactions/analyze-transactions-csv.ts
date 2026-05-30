import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { ToolError } from "../../lib/errors.js";
import { defineTool } from "../../server/define-tool.js";

interface PatternRule {
  pattern: string;
  code: string;
  label: string;
  confidence: "high" | "medium" | "low";
  // Resolved at load-time:
  regex?: RegExp;
}

interface PatternFile {
  jurisdiction?: string;
  patterns: PatternRule[];
}

let cachedPatterns: PatternRule[] | null = null;

async function loadPatterns(): Promise<PatternRule[]> {
  if (cachedPatterns) return cachedPatterns;
  // resolve relative to the source file, regardless of cwd.
  const url = new URL("../../../data/transaction-mapping/CA-QC.json", import.meta.url);
  const raw = await readFile(fileURLToPath(url), "utf8");
  const json = JSON.parse(raw) as PatternFile;
  const compiled = (json.patterns ?? []).map((p) => {
    // Strip an optional inline `(?i)` prefix (Perl/Python syntax not supported by JS)
    // and translate it to the JS `i` flag.
    const inlineCaseInsensitive = p.pattern.startsWith("(?i)");
    const body = inlineCaseInsensitive ? p.pattern.slice(4) : p.pattern;
    return {
      ...p,
      regex: new RegExp(body, inlineCaseInsensitive ? "i" : ""),
    };
  });
  cachedPatterns = compiled;
  return compiled;
}

// ----- RFC4180-ish CSV parser (tolerant of CRLF, embedded quotes/commas) -----

export function parseCsv(input: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  let i = 0;
  // strip BOM
  if (input.charCodeAt(0) === 0xfeff) i = 1;

  while (i < input.length) {
    const ch = input[i];
    if (inQuotes) {
      if (ch === '"') {
        if (input[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i += 1;
        continue;
      }
      field += ch;
      i += 1;
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
      i += 1;
      continue;
    }
    if (ch === ",") {
      row.push(field);
      field = "";
      i += 1;
      continue;
    }
    if (ch === "\r") {
      // swallow CR, handle CRLF or lone CR
      i += 1;
      if (input[i] === "\n") i += 1;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      continue;
    }
    if (ch === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      i += 1;
      continue;
    }
    field += ch;
    i += 1;
  }
  // flush trailing field/row
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  // drop trailing empty rows
  while (rows.length > 0) {
    const last = rows[rows.length - 1];
    if (last && last.length === 1 && last[0] === "") rows.pop();
    else break;
  }
  return rows;
}

// ----- Header detection -----

const HEADER_ALIASES: Record<string, string[]> = {
  account: ["account", "bank account", "account name", "bank"],
  date: ["date", "transaction date", "posted date"],
  description: ["description", "memo", "notes", "details", "payee"],
  amount: ["amount", "transaction amount", "net amount", "signed amount"],
  withdrawal: ["withdrawal", "withdrawals", "debit", "debits", "money out", "out"],
  deposit: ["deposit", "deposits", "credit", "credits", "money in", "in"],
  category: ["category", "posted to", "account category", "ledger account"],
};

function normalizeHeader(h: string): string {
  return h.trim().toLowerCase().replace(/\s+/g, " ").replace(/[._]/g, " ");
}

function mapHeaders(headerRow: string[]): Record<string, number> {
  const map: Record<string, number> = {};
  headerRow.forEach((rawHeader, idx) => {
    const h = normalizeHeader(rawHeader);
    for (const [canonical, variants] of Object.entries(HEADER_ALIASES)) {
      if (variants.includes(h) && map[canonical] === undefined) {
        map[canonical] = idx;
        return;
      }
    }
  });
  return map;
}

// ----- Amount parsing -----

function parseAmount(raw: string | undefined): number | null {
  if (raw === undefined) return null;
  const trimmed = raw.trim();
  if (trimmed === "") return null;
  // Strip currency symbols, thousands separators, spaces.
  // Handle ($1,234.56) accounting-style negatives.
  let s = trimmed.replace(/[$£€¥CAD\s,]/g, "");
  let negative = false;
  if (s.startsWith("(") && s.endsWith(")")) {
    negative = true;
    s = s.slice(1, -1);
  }
  if (s.startsWith("-")) {
    negative = true;
    s = s.slice(1);
  }
  const n = Number(s);
  if (!Number.isFinite(n)) return null;
  return negative ? -n : n;
}

// ----- Categorization -----

interface CategorizeResult {
  proposedCategoryAccount: string | null;
  confidence: "high" | "medium" | "low" | "none";
  reasoning: string;
}

function categorize(
  description: string,
  currentCategory: string | undefined,
  patterns: PatternRule[],
): CategorizeResult {
  // If the row already has a non-empty category, treat as the strongest signal.
  if (
    currentCategory &&
    currentCategory.trim() !== "" &&
    currentCategory.toLowerCase() !== "uncategorized"
  ) {
    return {
      proposedCategoryAccount: currentCategory.trim(),
      confidence: "high",
      reasoning: `Row already categorized in source CSV as "${currentCategory.trim()}".`,
    };
  }
  for (const rule of patterns) {
    if (rule.regex?.test(description)) {
      return {
        proposedCategoryAccount: rule.code,
        confidence: rule.confidence,
        reasoning: `Matched pattern ${rule.code} (${rule.label}).`,
      };
    }
  }
  return {
    proposedCategoryAccount: null,
    confidence: "none",
    reasoning:
      "No pattern matched. Add a rule to data/transaction-mapping/CA-QC.json or categorize manually.",
  };
}

// ----- Tool definition -----

export const analyzeTransactionsCsvTool = defineTool({
  name: "analyze_transactions_csv",
  description:
    "Parse a Wave Transactions CSV export and PROPOSE per-row categorization (chart-of-accounts hint, confidence, reasoning). Writes nothing to Wave — caller reviews proposals then applies via split_transaction or other write tools.",
  inputSchema: z.object({
    csv: z.string().min(1),
    businessId: z.string().min(1),
    defaultAnchorAccountId: z.string().min(1).optional(),
  }),
  async execute(input, _ctx) {
    const rows = parseCsv(input.csv);
    if (rows.length < 2) {
      throw new ToolError(
        "CSV_NO_ROWS",
        { rowCount: rows.length },
        "CSV must contain at least a header row and one data row.",
      );
    }
    const header = rows[0];
    if (!header) {
      throw new ToolError("CSV_NO_HEADER", {});
    }
    const cols = mapHeaders(header);

    if (cols.date === undefined) {
      throw new ToolError(
        "CSV_MISSING_DATE_COLUMN",
        { headers: header },
        "Expected one of: date, transaction date, posted date.",
      );
    }
    if (cols.description === undefined) {
      throw new ToolError(
        "CSV_MISSING_DESCRIPTION_COLUMN",
        { headers: header },
        "Expected one of: description, memo, notes, details, payee.",
      );
    }
    const hasSignedAmount = cols.amount !== undefined;
    const hasSplitAmount = cols.withdrawal !== undefined || cols.deposit !== undefined;
    if (!hasSignedAmount && !hasSplitAmount) {
      throw new ToolError(
        "CSV_MISSING_AMOUNT_COLUMN",
        { headers: header },
        "Expected an Amount column or a Withdrawal/Deposit pair.",
      );
    }

    const patterns = await loadPatterns();
    const proposals: Array<{
      rowIndex: number;
      date: string;
      amount: number;
      description: string;
      anchorAccount: string;
      proposedCategoryAccount: string | null;
      confidence: "high" | "medium" | "low" | "none";
      reasoning: string;
    }> = [];

    for (let r = 1; r < rows.length; r += 1) {
      const row = rows[r];
      if (!row || row.every((v) => v.trim() === "")) continue;

      const date = (row[cols.date]?.trim() ?? "").slice(0, 10);
      const description = row[cols.description]?.trim() ?? "";
      let amount: number | null = null;
      if (hasSignedAmount) {
        amount = parseAmount(row[cols.amount as number]);
      } else {
        const withdrawal = parseAmount(
          cols.withdrawal !== undefined ? row[cols.withdrawal] : undefined,
        );
        const deposit = parseAmount(cols.deposit !== undefined ? row[cols.deposit] : undefined);
        if (withdrawal !== null && withdrawal !== 0) amount = -Math.abs(withdrawal);
        else if (deposit !== null && deposit !== 0) amount = Math.abs(deposit);
        else amount = 0;
      }
      if (amount === null) {
        // skip rows we can't parse rather than blow up the whole batch
        continue;
      }

      const anchorAccount =
        (cols.account !== undefined ? row[cols.account]?.trim() : undefined) ||
        input.defaultAnchorAccountId ||
        "";

      const currentCategory = cols.category !== undefined ? row[cols.category] : undefined;
      const cat = categorize(description, currentCategory, patterns);

      proposals.push({
        rowIndex: r,
        date,
        amount,
        description,
        anchorAccount,
        proposedCategoryAccount: cat.proposedCategoryAccount,
        confidence: cat.confidence,
        reasoning: cat.reasoning,
      });
    }

    const withSuggestion = proposals.filter((p) => p.proposedCategoryAccount !== null).length;

    return {
      proposals,
      summary: {
        total: proposals.length,
        withSuggestion,
        withoutSuggestion: proposals.length - withSuggestion,
      },
      businessId: input.businessId,
    };
  },
});
