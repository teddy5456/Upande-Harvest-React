import { LEVEL_LABELS } from '../types';

export function parseShelfId(shelfId: string): {
  side: string;
  position: number;
  level: string;
} | null {
  if (!shelfId || shelfId.length < 3) return null;

  const side = shelfId[0].toUpperCase();
  if (side !== 'A' && side !== 'B') return null;

  const rest = shelfId.slice(1);
  const position = parseInt(rest.slice(0, rest.length - 1), 10);
  const level = rest[rest.length - 1].toUpperCase();

  if (isNaN(position) || position < 1 || position > 99) return null;
  if (!LEVEL_LABELS[level]) return null;

  return { side, position, level };
}

export function formatShelfLocation(shelfId: string): string {
  const parsed = parseShelfId(shelfId);
  if (!parsed) return shelfId;
  return `Side ${parsed.side}  |  Shelf ${parsed.position}  |  ${LEVEL_LABELS[parsed.level]}`;
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
  try {
    const parsed = JSON.parse(data);
    if (parsed.shelf) return parsed.shelf;
  } catch {
    // Not JSON — treat as raw shelf ID
  }
  const cleaned = data.trim().toUpperCase();
  if (parseShelfId(cleaned)) return cleaned;
  return null;
}

export function parseScannedBucketQR(data: string): string | null {
  try {
    const parsed = JSON.parse(data);
    if (parsed['bucket-id']) return parsed['bucket-id'];
    if (parsed.bucket_id) return parsed.bucket_id;
    if (parsed.bucket) return parsed.bucket;
    if (parsed.id) return parsed.id;
  } catch {
    // Not JSON — treat as raw bucket ID
  }
  const cleaned = data.trim();
  if (cleaned.length > 0) return cleaned;
  return null;
}
