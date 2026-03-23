import { fetchFarms } from '../services/api';

export interface Farm {
  name: string;
  farm_name: string;
  company: string;
}

let cache: Farm[] | null = null;
let cacheTime = 0;
const TTL = 10 * 60 * 1000; // 10 minutes

export function clearFarmCache(): void {
  cache = null;
  cacheTime = 0;
}

export async function getCachedFarms(): Promise<Farm[]> {
  const now = Date.now();
  if (cache && now - cacheTime < TTL) {
    return cache;
  }
  try {
    const response = await fetchFarms();
    cache = response.farms ?? [];
    cacheTime = now;
    return cache;
  } catch {
    if (cache) return cache;
    return [];
  }
}
