export function parseScannedBunchQR(data: string): string | null {
  try {
    const parsed = JSON.parse(data);
    if (parsed.bunch_id) return parsed.bunch_id;
    if (parsed.bunch) return parsed.bunch;
    if (parsed.id) return parsed.id;
  } catch {
    // Not JSON — treat as raw bunch ID
  }
  const cleaned = data.trim();
  if (cleaned.length > 0) return cleaned;
  return null;
}

export function parseScannedGraderQR(data: string): string | null {
  try {
    const parsed = JSON.parse(data);
    if (parsed.grader) return parsed.grader;
    if (parsed.employee) return parsed.employee;
    if (parsed.id) return parsed.id;
  } catch {
    // Not JSON — treat as raw grader ID
  }
  const cleaned = data.trim();
  if (cleaned.length > 0) return cleaned;
  return null;
}

export function parseScannedGradingBucketQR(data: string): string | null {
  try {
    const parsed = JSON.parse(data);
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
