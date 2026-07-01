import { LEVEL_LABELS } from '../types';

// Shelf IDs follow the pattern {side-letters}{position-digits}{optional-level}.
// Server side (Shelf doctype) accepts any Data value, so different instances use
// different conventions: mona uses A/B sides with levels T/M/B (A1T..A100B);
// xflora uses any row letter, larger position numbers, and either T/M/B or 1/2/3
// levels (e.g. E1000M, C250T, A51 where 1 is the level). Keep the parser loose
// enough to cover both while still rejecting non-shelf scans.
export function parseShelfId(shelfId: string): {
  side: string;
  position: number;
  level: string;
} | null {
  if (!shelfId) return null;
  const trimmed = shelfId.trim().toUpperCase();
  if (!trimmed) return null;

  // {letters}{digits}{optional trailing letter or digit as level}
  const match = trimmed.match(/^([A-Z]+)(\d+)([A-Z0-9]?)$/);
  if (!match) return null;

  const [, side, posStr, level] = match;
  const position = parseInt(posStr, 10);
  if (isNaN(position) || position < 1) return null;

  return { side, position, level };
}

export function formatShelfLocation(shelfId: string): string {
  const parsed = parseShelfId(shelfId);
  if (!parsed) return shelfId;
  const parts = [`Side ${parsed.side}`, `Shelf ${parsed.position}`];
  if (parsed.level) parts.push(LEVEL_LABELS[parsed.level] ?? parsed.level);
  return parts.join('  |  ');
}

export function generateAllShelfIds(): string[] {
  const ids: string[] = [];
  const sides = ['A', 'B'];
  const positions = Array.from({ length: 99 }, (_, i) => i + 1);
  const levels = ['T', 'M', 'B'];

  for (const side of sides) {
    for (const pos of positions) {
      for (const level of levels) {
        ids.push(`${side}${pos}${level}`);
      }
    }
  }
  return ids;
}

export function parseScannedShelfQR(data: string): string | null {
  let candidate = data;
  try {
    const parsed = JSON.parse(data);
    if (parsed.shelf) candidate = String(parsed.shelf);
  } catch {
    // Not JSON — treat as raw shelf ID
  }
  // Some QR generators encode the shelf with an internal space (e.g. "B 1041");
  // strip all whitespace before validating so both spaced and unspaced forms work.
  const cleaned = candidate.replace(/\s+/g, '').toUpperCase();
  if (parseShelfId(cleaned)) return cleaned;
  return null;
}

export function parseScannedBucketQR(data: string): string | null {
  let candidate: string | null = null;
  try {
    const parsed = JSON.parse(data);
    candidate = parsed['bucket-id'] ?? parsed.bucket_id ?? parsed.bucket ?? parsed.id ?? null;
  } catch {
    // Not JSON — treat as raw bucket ID
    candidate = data.trim() || null;
  }
  if (!candidate) return null;
  // Reject accidental scans of non-bucket QRs (bunch/grader/shelf labels) —
  // a real bucket ID is always of the form "BUCKET-…", so the substring
  // must be present (case-insensitive).
  if (!/bucket/i.test(candidate)) return null;
  return candidate;
}
