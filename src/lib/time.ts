const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export type IsoDate = string;

export function isoToday(clock: () => Date = () => new Date()): IsoDate {
  return isoDate(clock());
}

export function isoDate(d: Date): IsoDate {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function parseIsoDate(s: string): Date {
  if (!ISO_DATE_RE.test(s)) {
    throw new Error(`Invalid ISO date '${s}', expected YYYY-MM-DD`);
  }
  const d = new Date(`${s}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) throw new Error(`Invalid date '${s}'`);
  return d;
}

export function plusDays(s: IsoDate, days: number): IsoDate {
  const d = parseIsoDate(s);
  d.setUTCDate(d.getUTCDate() + days);
  return isoDate(d);
}
