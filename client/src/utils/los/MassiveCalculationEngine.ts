/**
 * MassiveCalculationEngine v4 - Fixed Tile Loading & Results
 */

import { TERRAIN_CONFIG } from './constants';

// ============================================================================
// Types
// ============================================================================

export interface TaskProgress {
  phase: 'generating' | 'preloading-tiles' | 'calculating' | 'finalizing';
  tilesLoaded: number;
  tilesTotal: number;
  tilesFailed: number;
  pointsProcessed: number;
  pointsTotal: number;
  percent: number;
  estimatedTimeRemaining: number | null;
  startTime: number;
}

export interface TaskConfig {
  origin?: { lat: number; lon: number; height: number };
  targetHeight?: number;
  frequencyMHz?: number;
  minDistance?: number;
  maxDistance?: number;
  minAzimuth?: number;
  maxAzimuth?: number;
  resolution?: number;
  points?: Array<{ lat: number; lon: number }>;
  chunkSize?: number;
  zoom?: number;
}

export interface EngineCallbacks {
  onProgress?: (progress: TaskProgress) => void;
  onPartialResult?: (partialResult: any[], progress: TaskProgress) => void;
  onComplete?: (result: any[]) => void;
  onError?: (error: string) => void;
}

// ============================================================================
// Constants
// ============================================================================

const DEFAULT_CHUNK_SIZE = 500;  // Smaller for better progress updates
const MAX_WORKERS = 4;
const MAX_POINTS = 5000000;
const TILE_CACHE_SIZE = 1000;  // Much larger cache
const TILE_RETRY_COUNT = 3;
const TILE_RETRY_DELAY = 500;
const TILE_BATCH_SIZE = 8;  // Load tiles in smaller batches to avoid rate limiting

// ============================================================================
// Worker Code
// ============================================================================

function createWorkerCode(): string {
  return `
const EARTH_RADIUS = 6371000.0;
const K_FACTOR = 1.333333;
const SPEED_OF_LIGHT = 299792458.0;
const DEG_TO_RAD = Math.PI / 180;
const RAD_TO_DEG = 180 / Math.PI;

let tileCache = new Map();

function lngLatToTile(lng, lat, zoom) {
  const n = Math.pow(2, zoom);
  lat = Math.max(-85.05, Math.min(85.05, lat));
  const latRad = lat * DEG_TO_RAD;
  const tileX = Math.floor(((lng + 180) / 360) * n);
  const tileY = Math.floor((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2 * n);
  const xInTile = ((lng + 180) / 360) * n - tileX;
  const yInTile = (1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2 * n - tileY;
  return {
    tileX: Math.max(0, Math.min(n-1, tileX)),
    tileY: Math.max(0, Math.min(n-1, tileY)),
    pixelX: Math.min(255, Math.max(0, Math.floor(xInTile * 256))),
    pixelY: Math.min(255, Math.max(0, Math.floor(yInTile * 256)))
  };
}

function getElevation(lat, lng, zoom) {
  const { tileX, tileY, pixelX, pixelY } = lngLatToTile(lng, lat, zoom);
  const key = zoom + '/' + tileX + '/' + tileY;
  const data = tileCache.get(key);
  if (!data) return null;
  const idx = (pixelY * 256 + pixelX) * 4;
  if (data[idx + 3] === 0) return null;
  const elev = (data[idx] * 256 + data[idx + 1] + data[idx + 2] / 256) - 32768;
  return (elev < -500 || elev > 9000) ? null : elev;
}

function haversine(lat1, lon1, lat2, lon2) {
  const dLat = (lat2 - lat1) * DEG_TO_RAD;
  const dLon = (lon2 - lon1) * DEG_TO_RAD;
  const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
            Math.cos(lat1 * DEG_TO_RAD) * Math.cos(lat2 * DEG_TO_RAD) *
            Math.sin(dLon/2) * Math.sin(dLon/2);
  return EARTH_RADIUS * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

function interpolate(lat1, lon1, lat2, lon2, f) {
  const phi1 = lat1 * DEG_TO_RAD, lam1 = lon1 * DEG_TO_RAD;
  const phi2 = lat2 * DEG_TO_RAD, lam2 = lon2 * DEG_TO_RAD;
  const dPhi = phi2 - phi1, dLam = lam2 - lam1;
  const a = Math.sin(dPhi/2) * Math.sin(dPhi/2) + Math.cos(phi1) * Math.cos(phi2) * Math.sin(dLam/2) * Math.sin(dLam/2);
  const d = 2 * Math.asin(Math.sqrt(a));
  if (d < 1e-10) return { lat: lat1, lon: lon1 };
  const A = Math.sin((1-f)*d) / Math.sin(d);
  const B = Math.sin(f*d) / Math.sin(d);
  const x = A * Math.cos(phi1) * Math.cos(lam1) + B * Math.cos(phi2) * Math.cos(lam2);
  const y = A * Math.cos(phi1) * Math.sin(lam1) + B * Math.cos(phi2) * Math.sin(lam2);
  const z = A * Math.sin(phi1) + B * Math.sin(phi2);
  return { lat: Math.atan2(z, Math.sqrt(x*x + y*y)) * RAD_TO_DEG, lon: Math.atan2(y, x) * RAD_TO_DEG };
}

function calcLOS(origin, target, zoom, freqMHz) {
  const dist = haversine(origin.lat, origin.lon, target.lat, target.lon);
  if (dist < 1) return { clear: true, fresnelClear: true, distance: dist, hasData: true };

  // Check if we have tile data for origin and target
  const oElev = getElevation(origin.lat, origin.lon, zoom);
  const tElev = getElevation(target.lat, target.lon, zoom);

  // If no elevation data available, return null result
  if (oElev === null && tElev === null) {
    return { clear: null, fresnelClear: null, distance: dist, hasData: false };
  }

  const samples = Math.min(50, Math.max(5, Math.ceil(dist / 200)));
  const wl = freqMHz ? SPEED_OF_LIGHT / (freqMHz * 1e6) : null;

  const startH = (oElev || 0) + (origin.height || 0);
  const endH = (tElev || 0) + (target.height || 2);

  let clear = true, fresnelClear = true;
  let hasAnyData = oElev !== null || tElev !== null;

  for (let i = 1; i < samples; i++) {
    const f = i / samples;
    const d1 = dist * f, d2 = dist - d1;
    const p = interpolate(origin.lat, origin.lon, target.lat, target.lon, f);
    const gnd = getElevation(p.lat, p.lon, zoom);

    if (gnd === null) continue;
    hasAnyData = true;

    const curve = (d1 * d2) / (2 * EARTH_RADIUS * K_FACTOR);
    const losH = startH + (endH - startH) * f - curve;
    const clr = losH - gnd;

    if (clr < 0) { clear = false; break; }
    if (wl && fresnelClear && clr < Math.sqrt(wl * d1 * d2 / dist) * 0.6) fresnelClear = false;
  }

  return {
    clear: hasAnyData ? clear : null,
    fresnelClear: hasAnyData ? (wl ? fresnelClear : undefined) : null,
    distance: dist,
    hasData: hasAnyData
  };
}

self.onmessage = async (e) => {
  const { id, type, payload } = e.data;

  if (type === 'setTiles') {
    tileCache.clear();
    for (const [key, arr] of Object.entries(payload)) {
      tileCache.set(key, new Uint8ClampedArray(arr));
    }
    self.postMessage({ id, type: 'ready', payload: { tileCount: tileCache.size } });
    return;
  }

  if (type === 'calc') {
    const { points, origin, targetHeight, zoom, freqMHz } = payload;
    const results = points.map(p => {
      const r = calcLOS(origin, { lat: p.lat, lon: p.lon, height: targetHeight }, zoom, freqMHz);
      return { lat: p.lat, lon: p.lon, ...r };
    });
    self.postMessage({ id, type: 'done', payload: results });
  }
};
`;
}

// ============================================================================
// Tile Manager with Retry
// ============================================================================

class TileManager {
  private cache = new Map<string, ImageData>();
  private failedTiles = new Set<string>();

  async loadTiles(
    keys: string[],
    url: string,
    onProgress?: (loaded: number, failed: number, total: number) => void
  ): Promise<Map<string, Uint8ClampedArray>> {
    const toLoad = keys.filter(k => !this.cache.has(k) && !this.failedTiles.has(k));
    let loaded = 0;
    let failed = 0;

    // Load in small batches with delay to avoid rate limiting
    for (let i = 0; i < toLoad.length; i += TILE_BATCH_SIZE) {
      const batch = toLoad.slice(i, i + TILE_BATCH_SIZE);

      await Promise.all(batch.map(async key => {
        const success = await this.loadTileWithRetry(key, url);
        if (success) {
          loaded++;
        } else {
          failed++;
          this.failedTiles.add(key);
        }
        onProgress?.(loaded, failed, toLoad.length);
      }));

      // Small delay between batches to avoid rate limiting
      if (i + TILE_BATCH_SIZE < toLoad.length) {
        await new Promise(r => setTimeout(r, 50));
      }
    }

    // Return available tiles
    const result = new Map<string, Uint8ClampedArray>();
    for (const k of keys) {
      const d = this.cache.get(k);
      if (d) result.set(k, new Uint8ClampedArray(d.data));
    }
    return result;
  }

  private async loadTileWithRetry(key: string, baseUrl: string): Promise<boolean> {
    const [z, x, y] = key.split('/').map(Number);
    const tileUrl = baseUrl.replace('{z}', String(z)).replace('{x}', String(x)).replace('{y}', String(y));

    for (let attempt = 0; attempt < TILE_RETRY_COUNT; attempt++) {
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 10000);

        const res = await fetch(tileUrl, { signal: controller.signal });
        clearTimeout(timeout);

        if (!res.ok) {
          if (attempt < TILE_RETRY_COUNT - 1) {
            await new Promise(r => setTimeout(r, TILE_RETRY_DELAY * (attempt + 1)));
            continue;
          }
          return false;
        }

        const blob = await res.blob();
        const bmp = await createImageBitmap(blob);
        const canvas = new OffscreenCanvas(256, 256);
        const ctx = canvas.getContext('2d')!;
        ctx.drawImage(bmp, 0, 0);

        // Evict old tiles if needed
        if (this.cache.size >= TILE_CACHE_SIZE) {
          const first = this.cache.keys().next().value;
          if (first) this.cache.delete(first);
        }

        this.cache.set(key, ctx.getImageData(0, 0, 256, 256));
        return true;

      } catch (e) {
        if (attempt < TILE_RETRY_COUNT - 1) {
          await new Promise(r => setTimeout(r, TILE_RETRY_DELAY * (attempt + 1)));
        }
      }
    }
    return false;
  }

  clear() {
    this.cache.clear();
    this.failedTiles.clear();
  }

  getCacheSize() { return this.cache.size; }
  getFailedCount() { return this.failedTiles.size; }
}

// ============================================================================
// Worker Pool
// ============================================================================

class WorkerPool {
  private workers: Worker[] = [];
  private url: string;

  constructor(n: number) {
    const blob = new Blob([createWorkerCode()], { type: 'application/javascript' });
    this.url = URL.createObjectURL(blob);
    for (let i = 0; i < n; i++) this.workers.push(new Worker(this.url));
  }

  async sendTiles(data: Map<string, Uint8ClampedArray>): Promise<number[]> {
    const obj: Record<string, ArrayBuffer> = {};
    data.forEach((v, k) => { obj[k] = v.buffer.slice(0); });

    const results = await Promise.all(this.workers.map((w, i) => new Promise<number>((res, rej) => {
      const t = setTimeout(() => rej(new Error('Worker timeout')), 30000);
      const h = (e: MessageEvent) => {
        if (e.data.type === 'ready') {
          clearTimeout(t);
          w.removeEventListener('message', h);
          res(e.data.payload?.tileCount || 0);
        }
      };
      w.addEventListener('message', h);
      w.postMessage({ id: i, type: 'setTiles', payload: obj });
    })));

    return results;
  }

  async calc(idx: number, points: any[], config: any): Promise<any[]> {
    return new Promise((res, rej) => {
      const w = this.workers[idx];
      const id = Date.now() + '-' + idx + '-' + Math.random();
      const t = setTimeout(() => rej(new Error('Calculation timeout')), 120000);
      const h = (e: MessageEvent) => {
        if (e.data.id === id && e.data.type === 'done') {
          clearTimeout(t);
          w.removeEventListener('message', h);
          res(e.data.payload);
        }
      };
      w.addEventListener('message', h);
      w.postMessage({ id, type: 'calc', payload: { points, ...config } });
    });
  }

  count() { return this.workers.length; }

  terminate() {
    this.workers.forEach(w => w.terminate());
    this.workers = [];
    URL.revokeObjectURL(this.url);
  }
}

// ============================================================================
// Main Engine
// ============================================================================

class Engine {
  private tiles = new TileManager();
  private pool: WorkerPool | null = null;
  private cancelled = false;
  private paused = false;

  async calculate(config: TaskConfig, cb: EngineCallbacks = {}): Promise<any[]> {
    this.cancelled = false;
    this.paused = false;
    const start = Date.now();

    // Generate points
    cb.onProgress?.({
      phase: 'generating',
      tilesLoaded: 0,
      tilesTotal: 0,
      tilesFailed: 0,
      pointsProcessed: 0,
      pointsTotal: 0,
      percent: 0,
      estimatedTimeRemaining: null,
      startTime: start
    });

    const points = this.genPoints(config);
    if (points.length === 0) { cb.onComplete?.([]); return []; }
    if (points.length > MAX_POINTS) {
      const err = `\u05DE\u05E7\u05E1\u05D9\u05DE\u05D5\u05DD ${MAX_POINTS.toLocaleString()} \u05E0\u05E7\u05D5\u05D3\u05D5\u05EA`;
      cb.onError?.(err);
      throw new Error(err);
    }

    // Get required tiles
    const zoom = config.zoom || (points.length > 100000 ? 10 : points.length > 20000 ? 11 : 12);
    const tileKeys = this.getTileKeys(points, zoom, config.origin);

    console.log(`Calculating ${points.length.toLocaleString()} points, need ${tileKeys.length} tiles at zoom ${zoom}`);

    // Load tiles with progress
    const tileData = await this.tiles.loadTiles(tileKeys, TERRAIN_CONFIG.url, (loaded, failed, total) => {
      if (this.cancelled) return;
      cb.onProgress?.({
        phase: 'preloading-tiles',
        tilesLoaded: loaded,
        tilesTotal: total,
        tilesFailed: failed,
        pointsProcessed: 0,
        pointsTotal: points.length,
        percent: Math.round((loaded + failed) / Math.max(1, total) * 15),
        estimatedTimeRemaining: null,
        startTime: start
      });
    });

    console.log(`Loaded ${tileData.size} tiles, ${this.tiles.getFailedCount()} failed`);

    if (this.cancelled) return [];

    // Init workers
    const numW = Math.min(MAX_WORKERS, Math.max(1, Math.ceil(points.length / 1000)));
    this.pool = new WorkerPool(numW);

    const tileCounts = await this.pool.sendTiles(tileData);
    console.log(`Workers received tiles:`, tileCounts);

    if (this.cancelled) { this.pool.terminate(); return []; }

    // Process in chunks
    const chunkSize = config.chunkSize || DEFAULT_CHUNK_SIZE;
    const chunks: any[][] = [];
    for (let i = 0; i < points.length; i += chunkSize) {
      chunks.push(points.slice(i, i + chunkSize));
    }

    const allResults: any[] = [];
    let done = 0;
    const calcConfig = {
      origin: config.origin,
      targetHeight: config.targetHeight || 2,
      zoom,
      freqMHz: config.frequencyMHz
    };

    for (let i = 0; i < chunks.length; i += numW) {
      while (this.paused && !this.cancelled) await new Promise(r => setTimeout(r, 100));
      if (this.cancelled) break;

      const batch = chunks.slice(i, i + numW);

      try {
        const batchResults = await Promise.all(
          batch.map((c, j) => this.pool!.calc(j % numW, c, calcConfig))
        );

        for (const r of batchResults) allResults.push(...r);
        done += batch.reduce((s, c) => s + c.length, 0);
      } catch (e) {
        console.error('Batch calculation error:', e);
        // Continue with next batch instead of failing completely
        done += batch.reduce((s, c) => s + c.length, 0);
      }

      const elapsed = Date.now() - start;
      const rate = done / elapsed;
      const remaining = rate > 0 ? (points.length - done) / rate / 1000 : null;

      const prog: TaskProgress = {
        phase: 'calculating',
        tilesLoaded: tileData.size,
        tilesTotal: tileKeys.length,
        tilesFailed: this.tiles.getFailedCount(),
        pointsProcessed: done,
        pointsTotal: points.length,
        percent: 15 + Math.round(done / points.length * 85),
        estimatedTimeRemaining: remaining ? Math.round(remaining) : null,
        startTime: start,
      };
      cb.onProgress?.(prog);

      // Partial results every 5 batches
      if (i % (numW * 5) === 0 || i + numW >= chunks.length) {
        cb.onPartialResult?.([...allResults], prog);
      }
    }

    this.pool.terminate();
    this.pool = null;

    if (!this.cancelled) {
      // Count results
      const withData = allResults.filter(r => r.hasData !== false).length;
      const noData = allResults.length - withData;
      console.log(`Results: ${withData} with data, ${noData} without data`);

      cb.onProgress?.({
        phase: 'finalizing',
        tilesLoaded: tileData.size,
        tilesTotal: tileKeys.length,
        tilesFailed: this.tiles.getFailedCount(),
        pointsProcessed: points.length,
        pointsTotal: points.length,
        percent: 100,
        estimatedTimeRemaining: 0,
        startTime: start
      });
      cb.onComplete?.(allResults);
    }

    return allResults;
  }

  pause() { this.paused = true; }
  resume() { this.paused = false; }
  cancel() { this.cancelled = true; this.pool?.terminate(); this.pool = null; }
  clearCache() { this.tiles.clear(); }

  private genPoints(c: TaskConfig): Array<{ lat: number; lon: number }> {
    if (c.points?.length) return c.points;
    if (!c.origin || !c.resolution) return [];

    const pts: Array<{ lat: number; lon: number }> = [];
    const minD = c.minDistance || 0, maxD = c.maxDistance || 5000, res = c.resolution;
    const minA = c.minAzimuth || 0, maxA = c.maxAzimuth || 360;

    for (let d = Math.max(res, minD); d <= maxD; d += res) {
      const circ = 2 * Math.PI * d;
      const angRes = Math.max(0.5, (res / circ) * 360);
      for (let a = minA; a < maxA; a += angRes) {
        pts.push(this.destPoint(c.origin.lat, c.origin.lon, a, d));
      }
    }
    return pts;
  }

  private destPoint(lat: number, lon: number, brng: number, dist: number) {
    const R = 6371000;
    const d = dist / R;
    const b = brng * Math.PI / 180;
    const p1 = lat * Math.PI / 180, l1 = lon * Math.PI / 180;
    const p2 = Math.asin(Math.sin(p1) * Math.cos(d) + Math.cos(p1) * Math.sin(d) * Math.cos(b));
    const l2 = l1 + Math.atan2(Math.sin(b) * Math.sin(d) * Math.cos(p1), Math.cos(d) - Math.sin(p1) * Math.sin(p2));
    return { lat: p2 * 180 / Math.PI, lon: ((l2 * 180 / Math.PI) + 540) % 360 - 180 };
  }

  private getTileKeys(pts: Array<{ lat: number; lon: number }>, z: number, origin?: { lat: number; lon: number }): string[] {
    const set = new Set<string>();
    const n = Math.pow(2, z);

    const addTile = (lat: number, lon: number) => {
      lat = Math.max(-85.05, Math.min(85.05, lat));
      const latRad = lat * Math.PI / 180;
      const tx = Math.floor(((lon + 180) / 360) * n);
      const ty = Math.floor((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2 * n);
      set.add(`${z}/${Math.max(0, Math.min(n-1, tx))}/${Math.max(0, Math.min(n-1, ty))}`);
    };

    for (const p of pts) addTile(p.lat, p.lon);
    if (origin) addTile(origin.lat, origin.lon);

    // Also add tiles along paths (for LOS sampling)
    if (origin && pts.length > 0) {
      // Sample some intermediate points
      const sampleCount = Math.min(pts.length, 100);
      const step = Math.max(1, Math.floor(pts.length / sampleCount));
      for (let i = 0; i < pts.length; i += step) {
        const p = pts[i];
        // Add a few intermediate tiles
        for (let f = 0.25; f <= 0.75; f += 0.25) {
          const midLat = origin.lat + (p.lat - origin.lat) * f;
          const midLon = origin.lon + (p.lon - origin.lon) * f;
          addTile(midLat, midLon);
        }
      }
    }

    return Array.from(set);
  }
}

// ============================================================================
// Exports
// ============================================================================

let instance: Engine | null = null;
export function getMassiveEngine(): Engine {
  if (!instance) instance = new Engine();
  return instance;
}

export async function smartCalculate(config: TaskConfig, cb: EngineCallbacks = {}): Promise<any[]> {
  return getMassiveEngine().calculate(config, cb);
}

export type { TaskProgress, TaskConfig, EngineCallbacks };
