import { fetchGreenhouses } from '../services/api';
import { Greenhouse } from '../types';

let cache: Greenhouse[] | null = null;
let cacheTime = 0;
const TTL = 5 * 60 * 1000; // 5 minutes

export async function getCachedGreenhouses(): Promise<Greenhouse[]> {
  const now = Date.now();
  if (cache && now - cacheTime < TTL) {
    return cache;
  }
  try {
    const response = await fetchGreenhouses();
    cache = response.greenhouses ?? [];
    cacheTime = now;
    return cache;
  } catch {
    // If fetch fails and we have stale cache, return it
    if (cache) return cache;
    throw new Error('Unable to load greenhouses. Check your connection.');
  }
}

export function invalidateGreenhouseCache(): void {
  cache = null;
  cacheTime = 0;
}
