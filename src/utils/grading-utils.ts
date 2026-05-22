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

export type GradingQRType = 'bunch' | 'grader' | 'bucket' | 'unknown';

/**
 * Detects which grading slot a scanned QR belongs to by inspecting JSON keys.
 * Falls back to 'unknown' for raw strings (caller routes to next empty slot).
 */
export function detectGradingQRType(data: string): GradingQRType {
  try {
    const parsed = JSON.parse(data);
    if (parsed.bunch_id || parsed.bunch) return 'bunch';
    if (parsed.grader || parsed.employee) return 'grader';
    if (parsed.bucket_id || parsed.bucket) return 'bucket';
  } catch {
    // Raw string — check common prefixes
    const upper = data.trim().toUpperCase();
    if (upper.startsWith('BN-') || upper.startsWith('BUNCH-')) return 'bunch';
    if (upper.startsWith('GR-') || upper.startsWith('EMP-') || upper.startsWith('GRADER-')) return 'grader';
    if (upper.startsWith('BK-') || upper.startsWith('BUCKET-')) return 'bucket';
  }
  return 'unknown';
}

/**
 * Extract the value from a QR regardless of which slot type it is.
 */
export function extractGradingQRValue(data: string): string {
  try {
    const parsed = JSON.parse(data);
    // Bunch
    if (parsed.bunch_id !== undefined || parsed.bunch !== undefined) {
      return parsed.bunch_id ?? parsed.bunch ?? data.trim();
    }
    // Grader — prefer employee/payroll ID over display name
    if (parsed.employee !== undefined || parsed.grader !== undefined || parsed.employee_id !== undefined) {
      return parsed.employee_id ?? parsed.employee ?? parsed.grader ?? data.trim();
    }
    // Bucket
    if (parsed.bucket_id !== undefined || parsed.bucket !== undefined) {
      return parsed.bucket_id ?? parsed.bucket ?? data.trim();
    }
    return parsed.id ?? data.trim();
  } catch {
    return data.trim();
  }
}
