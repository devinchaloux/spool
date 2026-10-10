// ── Tempo's beat ──

// The beat a tempo counts, in quarter notes: the meter's lower number, except
// in compound meters (6/8, 9/8, 12/8 and the like), which count three of those
// as one dotted beat (maintainer, 2026-10-10).
export function tempoBeat(count: number, unit: number): number {
  const u = 4 / (unit || 4);
  return count > 3 && count % 3 === 0 && unit >= 8 ? u * 3 : u;
}
export const BEAT_NAMES: Record<number, string> = {
  4: 'whole note', 3: 'dotted half note', 2: 'half note', 1.5: 'dotted quarter note',
  1: 'quarter note', 0.75: 'dotted eighth note', 0.5: 'eighth note', 0.25: 'sixteenth note',
}
