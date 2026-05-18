export interface AccountLite {
  id: string;
  name: string;
}

export interface AuthorityLite {
  code: string;
  name: string;
}

export interface AccountSuggestion {
  account_id: string;
  account_name: string;
  score: number;
}

export interface MappingSuggestion {
  authority_code: string;
  suggestions: AccountSuggestion[];
}

export function suggestMapping(
  accounts: AccountLite[],
  authorities: AuthorityLite[],
): MappingSuggestion[] {
  return authorities.map((authority) => {
    const wanted = `${authority.name} ${authority.code}`;
    const suggestions = accounts.map((account) => ({
      account_id: account.id,
      account_name: account.name,
      score: similarity(account.name, wanted),
    }));
    suggestions.sort((left, right) => right.score - left.score);
    return {
      authority_code: authority.code,
      suggestions: suggestions.slice(0, 3),
    };
  });
}

function similarity(accountName: string, wanted: string): number {
  const accountTokens = tokenSet(accountName);
  const wantedTokens = tokenSet(wanted);
  let hits = 0;
  for (const token of accountTokens) {
    if (wantedTokens.has(token)) hits += 1;
  }
  return Math.round((hits / Math.max(1, accountTokens.size)) * 100) / 100;
}

function tokenSet(value: string): Set<string> {
  return new Set(
    value
      .normalize("NFD")
      .replace(/\p{Diacritic}/gu, "")
      .toLowerCase()
      .split(/\W+/)
      .filter(Boolean),
  );
}
