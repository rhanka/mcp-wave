import { z } from "zod";
import { ToolError } from "../../lib/errors.js";
import { defineTool } from "../../server/define-tool.js";

export const getPayrollRatesTool = defineTool({
  name: "get_payroll_rates",
  description:
    "Return the versioned payroll-tax rate table for a jurisdiction (e.g. 'CA-QC'), either by explicit year or by a date the table covers.",
  inputSchema: z
    .object({
      jurisdiction: z.string().min(1),
      year: z.number().int().optional(),
      on_date: z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/, "Expected YYYY-MM-DD")
        .optional(),
    })
    .refine((v) => v.year !== undefined || v.on_date !== undefined, {
      message: "Provide either year or on_date",
    }),
  async execute(input, ctx) {
    if (input.year !== undefined) {
      return ctx.taxRates.load(input.jurisdiction, input.year);
    }
    if (input.on_date) {
      return ctx.taxRates.loadForDate(input.jurisdiction, input.on_date);
    }
    throw new ToolError("INVALID_INPUT", {}, "year or on_date required");
  },
});
