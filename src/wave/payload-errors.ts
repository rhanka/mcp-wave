import { WaveApiError } from "../lib/errors.js";

export interface WavePayload {
  didSucceed: boolean;
  inputErrors?: Array<{
    code?: string | null;
    message?: string | null;
    path?: ReadonlyArray<string> | null;
  }> | null;
  [key: string]: unknown;
}

export function throwIfInputErrors(
  payload: WavePayload | null | undefined,
  op: string,
): asserts payload is WavePayload {
  if (!payload) {
    throw new WaveApiError("EMPTY_PAYLOAD", 500, { operation: op });
  }
  if (!payload.didSucceed) {
    throw new WaveApiError("VALIDATION_ERROR", 400, {
      operation: op,
      inputErrors: payload.inputErrors ?? [],
    });
  }
}
