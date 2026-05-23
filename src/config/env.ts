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
  PUBLIC_BASE_URL: z.string().url().default("http://localhost:8080"),
  OAUTH_ISSUER_URL: z.string().url().default("http://localhost:8080"),
  OAUTH_CONSENT_SECRET: z.string().min(1).optional(),
  OAUTH_STORE_PATH: z.string().min(1).default(".data/oauth-store.json"),
  OAUTH_ACCESS_TOKEN_TTL_SECONDS: z.coerce.number().int().positive().default(3600),
  OAUTH_REFRESH_TOKEN_TTL_SECONDS: z.coerce.number().int().positive().default(2592000),
  OAUTH_AUTH_CODE_TTL_SECONDS: z.coerce.number().int().positive().default(300),
  OAUTH_ALLOWED_REDIRECT_URIS: z
    .string()
    .default("https://claude.ai/api/mcp/auth_callback,https://claude.com/api/mcp/auth_callback"),
});

const envSchema = baseSchema.superRefine((v, ctx) => {
  if (v.WAVE_AUTH_MODE === "env_token" && !v.WAVE_API_TOKEN) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "WAVE_API_TOKEN is required when WAVE_AUTH_MODE=env_token",
      path: ["WAVE_API_TOKEN"],
    });
  }
  if (v.NODE_ENV === "production") {
    if (new URL(v.PUBLIC_BASE_URL).protocol !== "https:") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "PUBLIC_BASE_URL must use https in production",
        path: ["PUBLIC_BASE_URL"],
      });
    }
    if (new URL(v.OAUTH_ISSUER_URL).protocol !== "https:") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "OAUTH_ISSUER_URL must use https in production",
        path: ["OAUTH_ISSUER_URL"],
      });
    }
    if (!v.OAUTH_CONSENT_SECRET) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "OAUTH_CONSENT_SECRET is required in production",
        path: ["OAUTH_CONSENT_SECRET"],
      });
    }
  }
});

export type AppEnv = z.infer<typeof envSchema>;

export function parseEnv(source: Record<string, string | undefined> = process.env): AppEnv {
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("\n  ");
    throw new Error(`Invalid environment configuration:\n  ${issues}`);
  }
  return parsed.data;
}
