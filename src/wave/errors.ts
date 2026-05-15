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

function codeFromHttpStatus(status: number): string {
  if (status === 429) return "RATE_LIMITED";
  if (status === 401) return "AUTHENTICATION_ERROR";
  if (status === 403) return "AUTHORIZATION_ERROR";
  if (status === 404) return "NOT_FOUND";
  if (status >= 500) return "INTERNAL_SERVER_ERROR";
  if (status >= 400) return "VALIDATION_ERROR";
  return "UNKNOWN";
}

export function mapWaveGraphQLError(
  e: WaveGqlError | undefined | null,
  httpStatus?: number,
): WaveApiError {
  const extensionCode = e?.extensions?.code;
  if (extensionCode) {
    const status = STATUS_BY_CODE[extensionCode] ?? httpStatus ?? 500;
    return new WaveApiError(extensionCode, status, e ?? null);
  }
  if (httpStatus !== undefined) {
    return new WaveApiError(codeFromHttpStatus(httpStatus), httpStatus, e ?? null);
  }
  return new WaveApiError("UNKNOWN", 500, e ?? null);
}
