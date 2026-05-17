export type SplitValidation =
  | { ok: true }
  | {
      ok: false;
      provided_sum: number;
      expected: number;
      delta: number;
      tolerance: number;
    };

export function validateSplitSum(
  parts: number[],
  expected: number,
  tolerance: number,
): SplitValidation {
  const providedSum = parts.reduce((sum, part) => sum + part, 0);
  const delta = providedSum - expected;

  if (Math.abs(delta) <= tolerance) {
    return { ok: true };
  }

  return {
    ok: false,
    provided_sum: providedSum,
    expected,
    delta,
    tolerance,
  };
}
