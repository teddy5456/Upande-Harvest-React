import { LEVEL_LABELS } from '../types';

// A printed shelf label is FOUR parts run together, exactly as the ERP's label
// generator builds it (label_print.py: `shelf_id = f"{side}{shelf}{level}{column}"`):
//
//   A100B2  ->  side A, shelf 100, level B (Bottom), column 2
//   A10011  ->  side A, shelf 100, level 1 (Bottom), column 1
//
// The level prints as letters (T/M/B) or numbers (1=Bottom, 2=Middle, 3=Top)
// because Label Print has a Letters/Numbers toggle that has been flipped between
// print runs, so both forms are physically on the coldroom walls. The numeric
// form is only decodable because level and column are one digit each and come
// off the END — which is why a greedy \d+ for the shelf number reads A10011 as
// "shelf 10011" and A100B2's column as nothing at all.
//
// Older ids that predate columns also exist as Shelf records (A11, A1001 =
// side/shelf/column, no level; E1000M on xflora = side/shelf/level), so they are
// tried after the four-part forms rather than instead of them.
const SHELF_PATTERNS: {
  re: RegExp;
  parts: (m: RegExpMatchArray) => { side: string; position: number; level: string; column: string };
}[] = [
  // A100B2 / A1T1 — level as a letter, then the column
  {
    re: /^([A-Z]+)(\d+)([TMB])(\d+)$/,
    parts: (m) => ({ side: m[1], position: parseInt(m[2], 10), level: m[3], column: m[4] }),
  },
  // A10011 — level as 1..3, then a single-digit column
  {
    re: /^([A-Z]+)(\d+)([1-3])(\d)$/,
    parts: (m) => ({ side: m[1], position: parseInt(m[2], 10), level: m[3], column: m[4] }),
  },
  // A100B / E1000M — level, no column (printed before columns existed)
  {
    re: /^([A-Z]+)(\d+)([TMB])$/,
    parts: (m) => ({ side: m[1], position: parseInt(m[2], 10), level: m[3], column: '' }),
  },
  // A1001 / A11 / B993 — legacy Shelf records: side, shelf, column, no level
  {
    re: /^([A-Z]+)(\d+)([1-3])$/,
    parts: (m) => ({ side: m[1], position: parseInt(m[2], 10), level: '', column: m[3] }),
  },
  // A2 — side and shelf only
  {
    re: /^([A-Z]+)(\d+)$/,
    parts: (m) => ({ side: m[1], position: parseInt(m[2], 10), level: '', column: '' }),
  },
];

export function parseShelfId(shelfId: string): {
  side: string;
  position: number;
  level: string;
  /** Which column of the level the bucket sits in. '' on ids printed before
   *  columns existed. */
  column: string;
} | null {
  if (!shelfId) return null;
  const trimmed = shelfId.trim().toUpperCase();
  if (!trimmed) return null;

  for (const { re, parts } of SHELF_PATTERNS) {
    const m = trimmed.match(re);
    if (!m) continue;
    const parsed = parts(m);
    if (isNaN(parsed.position) || parsed.position < 1) return null;
    return parsed;
  }
  return null;
}

export function formatShelfLocation(shelfId: string): string {
  const parsed = parseShelfId(shelfId);
  if (!parsed) return shelfId;
  const parts = [`Side ${parsed.side}`, `Shelf ${parsed.position}`];
  if (parsed.level) parts.push(LEVEL_LABELS[parsed.level] ?? parsed.level);
  if (parsed.column) parts.push(`Col ${parsed.column}`);
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

/** Self-check: `npx tsx src/utils/shelf-utils.ts` (or ts-node). Asserts the
 *  decoding against the ids the ERP's label generator actually prints. */
export function __selfCheck() {
  const cases: [string, string, number, string, string][] = [
    // id        side  shelf  level  column
    ['A100B2', 'A', 100, 'B', '2'],
    ['A10011', 'A', 100, '1', '1'],
    ['A1T1', 'A', 1, 'T', '1'],
    ['A10013', 'A', 100, '1', '3'],
    ['A100B', 'A', 100, 'B', ''],
    ['E1000M', 'E', 1000, 'M', ''],
    ['A1001', 'A', 100, '', '1'],
    ['A11', 'A', 1, '', '1'],
    ['B993', 'B', 99, '', '3'],
    ['A2', 'A', 2, '', ''],
  ];
  for (const [id, side, position, level, column] of cases) {
    const p = parseShelfId(id);
    if (!p) throw new Error(`${id}: did not parse`);
    const got = `${p.side}/${p.position}/${p.level}/${p.column}`;
    const want = `${side}/${position}/${level}/${column}`;
    if (got !== want) throw new Error(`${id}: got ${got}, want ${want}`);
  }
  for (const bad of ['', 'SHELF-1', '1A2B', 'A', 'BUCKET-123']) {
    if (parseShelfId(bad)) throw new Error(`${bad}: should not parse`);
  }
  // A0 has a position of 0 — there is no shelf 0.
  if (parseShelfId('A0')) throw new Error('A0: should not parse');
  console.log('shelf-utils OK —', cases.length, 'ids decode as the label generator prints them');
}
