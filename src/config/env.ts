import { z } from "zod";

const baseSchema = z.object({
  WAVE_AUTH_MODE: z.enum(["env_token", "bearer_passthrough", "mock"]),
  WAVE_API_TOKEN: z.string().min(1).optional(),
  WAVE_DEFAULT_BUSINESS_ID: z.string().min(1),
  WAVE_GRAPHQL_ENDPOINT: z.string().url(),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info"),
  LOG_PII: z
    .enum(["true", "false"])
    .default("false")
    .transform((v) => v === "true"),
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  ALLOWED_ORIGINS: z.string().default("http://localhost:*"),
  RATE_LIMIT_RPM: z.coerce.number().int().positive().default(60),
});

const envSchema = baseSchema.superRefine((v, ctx) => {
  if (v.WAVE_AUTH_MODE === "env_token" && !v.WAVE_API_TOKEN) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "WAVE_API_TOKEN is required when WAVE_AUTH_MODE=env_token",
      path: ["WAVE_API_TOKEN"],
    });
  }
});

export type AppEnv = z.infer<typeof envSchema>;

export function parseEnv(source: Record<string, string | undefined> = process.env): AppEnv {
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `${i.path.join(".")}: ${i.message}`)
      .join("\n  ");
    throw new Error(`Invalid environment configuration:\n  ${issues}`);
  }
  return parsed.data;
}
