import { z } from "zod";

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Expected YYYY-MM-DD");

const RemittanceAuthority = z.object({
  code: z.string().min(1),
  name: z.string().min(1),
  level: z.enum(["federal", "regional", "municipal", "other"]),
});

const PayrollTax = z.object({
  code: z.string().min(1),
  name: z.string().min(1),
  remits_to: z.string().min(1),
  type: z.enum(["withheld", "employer_only", "both"]),
  employer_rate: z.number().min(0).max(1).optional(),
  employee_rate: z.number().min(0).max(1).optional(),
  employer_factor: z.number().positive().optional(),
  insurable_max: z.number().nonnegative().optional(),
  pensionable_max: z.number().nonnegative().optional(),
  basic_exemption: z.number().nonnegative().optional(),
});

const SalesTax = z.object({
  code: z.string().min(1),
  name: z.string().min(1),
  rate: z.number().min(0).max(1),
  remits_to: z.string().min(1),
});

export const TaxRatesSchema = z
  .object({
    jurisdiction: z.string().min(1),
    year: z.number().int(),
    effective_from: isoDate,
    effective_to: isoDate,
    remittance_authorities: z.array(RemittanceAuthority).min(1),
    payroll_taxes: z.array(PayrollTax),
    sales_taxes: z.array(SalesTax),
  })
  .superRefine((v, ctx) => {
    if (v.effective_from > v.effective_to) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "effective_from must be <= effective_to",
        path: ["effective_from"],
      });
    }
    const codes = new Set(v.remittance_authorities.map((a) => a.code));
    for (const [i, t] of v.payroll_taxes.entries()) {
      if (!codes.has(t.remits_to)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `payroll_taxes[${i}].remits_to '${t.remits_to}' is not a known authority code`,
          path: ["payroll_taxes", i, "remits_to"],
        });
      }
    }
    for (const [i, t] of v.sales_taxes.entries()) {
      if (!codes.has(t.remits_to)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `sales_taxes[${i}].remits_to '${t.remits_to}' is not a known authority code`,
          path: ["sales_taxes", i, "remits_to"],
        });
      }
    }
  });

export type TaxRates = z.infer<typeof TaxRatesSchema>;
