/** Parse "8.5" or "8.5%" into basis points (850). Accepts 0–1000%. */
export function parsePct(input: string): number | null {
  const m = /^\s*(\d{1,4})(?:\.(\d{1,2}))?\s*%?\s*$/.exec(input);
  if (!m) return null;
  const bps = Number(m[1]) * 100 + Number((m[2] ?? '').padEnd(2, '0'));
  return bps <= 100_000 ? bps : null;
}

export function bpsToInput(bps: number): string {
  return (bps / 100).toString();
}
