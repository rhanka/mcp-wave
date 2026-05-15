import { z } from "zod";

const Bucket = z.object({
  payable_account_id: z.string().min(1),
});

export const AccountMappingSchema = z.object({
  business_id_env: z.string().min(1).optional(),
  jurisdiction: z.string().min(1),
  remittance_buckets: z.record(z.string(), Bucket),
  tax_code_to_account: z.record(z.string(), z.string()).optional(),
});

export type AccountMapping = z.infer<typeof AccountMappingSchema>;
