import pino, { type Logger } from "pino";

const REDACTED_KEYS = new Set([
  "authorization",
  "token",
  "api_token",
  "wave_api_token",
  "access_token",
  "refresh_token",
  "secret",
  "password",
  "email",
  "recipient",
  "to_email",
]);

export function redact(input: unknown): unknown {
  if (input === null || typeof input !== "object") return input;
  if (Array.isArray(input)) return input.map(redact);
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(input as Record<string, unknown>)) {
    if (REDACTED_KEYS.has(k.toLowerCase())) {
      out[k] = "[REDACTED]";
    } else {
      out[k] = redact(v);
    }
  }
  return out;
}

export interface LoggerOptions {
  level: "fatal" | "error" | "warn" | "info" | "debug" | "trace";
  logPII: boolean;
}

export function createLogger(opts: LoggerOptions): Logger {
  // Always log to stderr (fd 2) in sync mode. stdout is reserved for the
  // MCP protocol when this server runs under stdio transport; sync avoids
  // pino's worker-thread bootstrapping path which had compatibility issues
  // under Node 24 + tsx.
  return pino(
    {
      level: opts.level,
      formatters: {
        log: (obj) => (opts.logPII ? obj : (redact(obj) as Record<string, unknown>)),
      },
      timestamp: pino.stdTimeFunctions.isoTime,
    },
    pino.destination({ fd: 2, sync: true }),
  );
}
