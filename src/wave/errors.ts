import { WaveApiError } from "../lib/errors.js";

const STATUS_BY_CODE: Record<string, number> = {
  AUTHENTICATION_ERROR: 401,
  AUTHORIZATION_ERROR: 403,
  NOT_FOUND: 404,
  VALIDATION_ERROR: 400,
  RATE_LIMITED: 429,
  INTERNAL_SERVER_ERROR: 500,
};

interface WaveGqlError {
  message?: string;
  extensions?: { code?: string };
}

export function mapWaveGraphQLError(e: WaveGqlError | undefined | null): WaveApiError {
  const code = e?.extensions?.code ?? "UNKNOWN";
  const status = STATUS_BY_CODE[code] ?? 500;
  return new WaveApiError(code, status, e ?? null);
}
