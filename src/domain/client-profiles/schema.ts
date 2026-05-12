import { z } from "zod";

export const ClientProfileSchema = z.object({
  alias: z.string().regex(/^[a-z0-9-]+$/, "alias must be [a-z0-9-]+"),
  unit: z.enum(["hours", "days", "fixed"]).default("hours"),
  hourly_rate: z.number().positive().optional(),
  currency: z.string().length(3),
  default_product_id: z.string().optional(),
  default_description: z.string().optional(),
  send_to: z.array(z.string().email()).min(1),
  cc: z.array(z.string().email()).default([]),
  payment_terms_days: z.number().int().min(0).default(30),
  language: z.enum(["en", "fr"]).default("en"),
  default_taxes: z.array(z.string()).default([]),
  invoice_notes: z.string().optional(),
});

export type ClientProfile = z.infer<typeof ClientProfileSchema>;
