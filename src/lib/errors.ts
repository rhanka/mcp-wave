export class ToolError extends Error {
  constructor(
    public readonly code: string,
    public readonly details: Record<string, unknown> = {},
    public readonly hint?: string,
  ) {
    super(`${code}${hint ? `: ${hint}` : ""}`);
    this.name = "ToolError";
  }

  toJSON(): { code: string; details: Record<string, unknown>; hint?: string } {
    const out: { code: string; details: Record<string, unknown>; hint?: string } = {
      code: this.code,
      details: this.details,
    };
    if (this.hint !== undefined) out.hint = this.hint;
    return out;
  }
}

export class WaveApiError extends ToolError {
  constructor(
    public readonly waveCode: string,
    public readonly httpStatus: number,
    public readonly waveDetails: unknown,
  ) {
    super(`WAVE_${waveCode}`, { httpStatus, waveDetails });
    this.name = "WaveApiError";
  }
}

export function normalizeError(e: unknown): ToolError {
  if (e instanceof ToolError) return e;
  if (e instanceof Error) {
    return new ToolError("INTERNAL_ERROR", { message: e.message, stack: e.stack });
  }
  return new ToolError("INTERNAL_ERROR", { value: String(e) });
}
