/**
 * Loading Terrarium terrain tiles (main thread or worker).
 * Tiles are decoded once to packed Uint16 elevations (see terrain.ts).
 */

import { TERRAIN_CONFIG } from '../constants';
import { packTerrariumTile, tileKeysForBounds, type GeoBounds } from './terrain';

const RETRIES = 3;
const RETRY_DELAY_MS = 400;
const TIMEOUT_MS = 10_000;

/** Fetch and decode one tile to RGBA bytes. Returns null if it does not exist or keeps failing. */
export async function fetchTerrariumTile(key: string, urlTemplate = TERRAIN_CONFIG.url, signal?: AbortSignal): Promise<Uint8ClampedArray | null> {
  const [z, x, y] = key.split('/');
  const url = urlTemplate.replace('{z}', z).replace('{x}', x).replace('{y}', y);

  for (let attempt = 0; attempt < RETRIES; attempt++) {
    if (signal?.aborted) return null;
    const controller = new AbortController();
    const onAbort = () => controller.abort();
    signal?.addEventListener('abort', onAbort, { once: true });
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const res = await fetch(url, { signal: controller.signal });
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const bitmap = await createImageBitmap(await res.blob());
      const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
      const ctx = canvas.getContext('2d');
      if (!ctx) return null;
      ctx.drawImage(bitmap, 0, 0);
      bitmap.close();
      return ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    } catch {
      if (signal?.aborted) return null;
      if (attempt < RETRIES - 1) await new Promise(r => setTimeout(r, RETRY_DELAY_MS * (attempt + 1)));
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
    }
  }
  return null;
}

/** Fetch one tile and decode it to packed elevations, or null. */
export async function fetchPackedTile(key: string, urlTemplate = TERRAIN_CONFIG.url, signal?: AbortSignal): Promise<Uint16Array | null> {
  const rgba = await fetchTerrariumTile(key, urlTemplate, signal);
  return rgba ? packTerrariumTile(rgba) : null;
}

/** Small LRU cache of decoded tiles for the line tool and point readouts. */
class TileCache {
  private readonly entries = new Map<string, Promise<Uint16Array | null>>();
  private readonly maxEntries: number;

  constructor(maxEntries: number) {
    this.maxEntries = maxEntries;
  }

  get(key: string, urlTemplate: string): Promise<Uint16Array | null> {
    const cacheKey = `${urlTemplate}|${key}`;
    const cached = this.entries.get(cacheKey);
    if (cached) {
      this.entries.delete(cacheKey);
      this.entries.set(cacheKey, cached);
      return cached;
    }
    const pending = fetchPackedTile(key, urlTemplate).then(data => {
      if (data === null) this.entries.delete(cacheKey); // allow a later retry
      return data;
    });
    this.entries.set(cacheKey, pending);
    while (this.entries.size > this.maxEntries) {
      this.entries.delete(this.entries.keys().next().value as string);
    }
    return pending;
  }
}

// 512 packed tiles = 64 MB at most.
const lineTileCache = new TileCache(512);

/** Load the given tiles (cached). Missing / failed tiles are left out of the map. */
export async function loadTiles(keys: string[], urlTemplate = TERRAIN_CONFIG.url): Promise<Map<string, Uint16Array>> {
  const tiles = new Map<string, Uint16Array>();
  await Promise.all(keys.map(async key => {
    const data = await lineTileCache.get(key, urlTemplate);
    if (data) tiles.set(key, data);
  }));
  return tiles;
}

/** Load every tile covering `bounds` at zoom z (cached). */
export async function loadTilesForBounds(bounds: GeoBounds, z: number, urlTemplate = TERRAIN_CONFIG.url): Promise<Map<string, Uint16Array>> {
  return loadTiles(tileKeysForBounds(bounds, z), urlTemplate);
}
