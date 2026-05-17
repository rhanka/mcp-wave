export interface SalesTax {
  id: string;
  name: string;
  abbreviation: string | null;
  rate: number;
}

export interface ResolveSalesTaxesResult {
  matched: SalesTax[];
  unresolved: string[];
}

export function resolveSalesTaxes(codes: string[], taxes: SalesTax[]): ResolveSalesTaxesResult {
  const byAbbreviation = new Map<string, SalesTax>();
  const byName = new Map<string, SalesTax>();

  for (const tax of taxes) {
    if (tax.abbreviation !== null) {
      byAbbreviation.set(tax.abbreviation.toLowerCase(), tax);
    }
    byName.set(tax.name.toLowerCase(), tax);
  }

  const matched: SalesTax[] = [];
  const unresolved: string[] = [];

  for (const code of codes) {
    const key = code.toLowerCase();
    const tax = byAbbreviation.get(key) ?? byName.get(key);

    if (tax === undefined) {
      unresolved.push(code);
    } else {
      matched.push(tax);
    }
  }

  return { matched, unresolved };
}
