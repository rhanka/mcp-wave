import { ToolError } from "../../lib/errors.js";

export interface Line {
  quantity: number;
  unit_price: number;
  tax_codes: string[];
}

export interface TaxRef {
  code: string;
  rate: number;
}

export interface InvoiceTotalsInput {
  lines: Line[];
  taxes: TaxRef[];
  currency: string;
}

export interface InvoiceTotals {
  subtotal: number;
  taxes_breakdown: Array<{ code: string; amount: number }>;
  total: number;
  currency: string;
}

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

export function computeInvoiceTotals(input: InvoiceTotalsInput): InvoiceTotals {
  for (const [i, l] of input.lines.entries()) {
    if (l.quantity < 0) {
      throw new ToolError("INVALID_LINE", { index: i, reason: "negative quantity" });
    }
    if (l.unit_price < 0) {
      throw new ToolError("INVALID_LINE", { index: i, reason: "negative unit_price" });
    }
  }

  const rateOf = new Map(input.taxes.map((t) => [t.code, t.rate] as const));
  const subtotal = round2(input.lines.reduce((acc, l) => acc + l.quantity * l.unit_price, 0));
  const breakdown = new Map<string, number>();

  for (const l of input.lines) {
    const lineSub = l.quantity * l.unit_price;
    for (const code of l.tax_codes) {
      const rate = rateOf.get(code);
      if (rate === undefined) {
        throw new ToolError("TAX_CODE_NOT_RESOLVED", { code, available: [...rateOf.keys()] });
      }
      breakdown.set(code, (breakdown.get(code) ?? 0) + lineSub * rate);
    }
  }

  const taxes_breakdown = [...breakdown.entries()].map(([code, amount]) => ({
    code,
    amount: round2(amount),
  }));
  const taxesSum = taxes_breakdown.reduce((a, t) => a + t.amount, 0);

  return {
    subtotal,
    taxes_breakdown,
    total: round2(subtotal + taxesSum),
    currency: input.currency,
  };
}
