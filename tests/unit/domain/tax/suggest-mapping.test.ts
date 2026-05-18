import { describe, expect, it } from "vitest";
import { suggestMapping } from "../../../../src/domain/tax/suggest-mapping.js";

describe("suggestMapping", () => {
  it("ranks liability accounts by normalized authority token overlap", () => {
    const suggestions = suggestMapping(
      [
        { id: "acct_other", name: "Sales tax payable" },
        { id: "acct_fed", name: "Receiver General payable" },
        { id: "acct_qc", name: "Revenu Quebec payable" },
      ],
      [
        { code: "CRA", name: "Receiver General" },
        { code: "RQ", name: "Revenu Québec" },
      ],
    );

    expect(suggestions).toEqual([
      {
        authority_code: "CRA",
        suggestions: [
          { account_id: "acct_fed", account_name: "Receiver General payable", score: 0.67 },
          { account_id: "acct_other", account_name: "Sales tax payable", score: 0 },
          { account_id: "acct_qc", account_name: "Revenu Quebec payable", score: 0 },
        ],
      },
      {
        authority_code: "RQ",
        suggestions: [
          { account_id: "acct_qc", account_name: "Revenu Quebec payable", score: 0.67 },
          { account_id: "acct_other", account_name: "Sales tax payable", score: 0 },
          { account_id: "acct_fed", account_name: "Receiver General payable", score: 0 },
        ],
      },
    ]);
  });
});
