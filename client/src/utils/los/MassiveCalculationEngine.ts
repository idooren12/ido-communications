/**
 * MassiveCalculationEngine v6 - Streaming architecture for 100B+ points
 *
 * Key optimizations:
 * - Streaming results: onBatchResult callback, no allResults[] accumulation
 * - Lazy point generation via GridConfig (O(chunkSize) memory)
 * - Use Transferable ArrayBuffers for tile data to avoid copies
 * - All available CPU cores used
 * - Backward compatible: legacy callers without onBatchResult work identically
 */

import { TERRAIN_CONFIG } from './constants';
import { type GridConfig, generatePointChunks, computeBounds, estimateTotalPoints, computeZoom } from './gridGenerator';
import type { RasterCell, GridBounds } from './losAreaRaster';

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
  /** New: lazy grid configuration (replaces points[] for large calcs) */
  gridConfig?: GridConfig;
}

/** Summary returned by onComplete in streaming mode */
export interface StreamingSummary {
  totalProcessed: number;
  clear: number;
  blocked: number;
  noData: number;
  durationMs: number;
}

/** Discriminated union for onComplete */
export type Completion =
  | { mode: 'legacy'; results: any[] }
  | { mode: 'streaming'; summary: StreamingSummary };

export interface EngineCallbacks {
  onProgress?: (progress: TaskProgress) => void;
  /** Legacy: receives entire accumulated results array */
  onPartialResult?: (partialResult: any[], progress: TaskProgress) => void;
  /** Streaming: receives only new batch results (no accumulation) */
  onBatchResult?: (batch: RasterCell[], progress: TaskProgress) => void;
  /** Called when bounds and total points are known, before tile loading */
  onBoundsReady?: (bounds: GridBounds, totalPoints: number) => void;
  /** Called on completion. Type depends on streaming vs legacy mode. May be async — engine will await it. */
  onComplete?: (result: Completion) => void | Promise<void>;
  onError?: (error: string) => void;
}

// ============================================================================
// Constants
// ============================================================================

const DEFAULT_CHUNK_SIZE = 5000;
const MAX_WORKERS = Math.min(typeof navigator !== 'undefined' ? (navigator.hardwareConcurrency || 4) : 4, 16);
const MAX_POINTS = 500000000;
const TILE_CACHE_SIZE = 2000;
const TILE_RETRY_COUNT = 3;
const TILE_RETRY_DELAY = 500;
const TILE_BATCH_SIZE = 20;

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

  const oElev = getElevation(origin.lat, origin.lon, zoom);
  const tElev = getElevation(target.lat, target.lon, zoom);

  if (oElev === null && tElev === null) {
    return { clear: null, fresnelClear: null, distance: dist, hasData: false };
  }

  const samples = 200;
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
  private abortController: AbortController | null = null;

  async loadTiles(
    keys: string[],
    url: string,
    onProgress?: (loaded: number, failed: number, total: number) => void
  ): Promise<Map<string, Uint8ClampedArray>> {
    this.abortController = new AbortController();
    const { signal } = this.abortController;

    const toLoad = keys.filter(k => !this.cache.has(k) && !this.failedTiles.has(k));
    let loaded = 0;
    let failed = 0;

    for (let i = 0; i < toLoad.length; i += TILE_BATCH_SIZE) {
      if (signal.aborted) break;
      const batch = toLoad.slice(i, i + TILE_BATCH_SIZE);

      await Promise.all(batch.map(async key => {
        if (signal.aborted) return;
        const success = await this.loadTileWithRetry(key, url, signal);
        if (signal.aborted) return;
        if (success) {
          loaded++;
        } else {
          failed++;
          this.failedTiles.add(key);
        }
        onProgress?.(loaded, failed, toLoad.length);
      }));

      if (i + TILE_BATCH_SIZE < toLoad.length && !signal.aborted) {
        await new Promise(r => setTimeout(r, 10));
      }
    }

    this.abortController = null;

    const result = new Map<string, Uint8ClampedArray>();
    for (const k of keys) {
      const d = this.cache.get(k);
      if (d) result.set(k, new Uint8ClampedArray(d.data));
    }
    return result;
  }

  private async loadTileWithRetry(key: string, baseUrl: string, parentSignal?: AbortSignal): Promise<boolean> {
    const [z, x, y] = key.split('/').map(Number);
    const tileUrl = baseUrl.replace('{z}', String(z)).replace('{x}', String(x)).replace('{y}', String(y));

    for (let attempt = 0; attempt < TILE_RETRY_COUNT; attempt++) {
      if (parentSignal?.aborted) return false;
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 10000);
        // Abort individual fetch if parent is aborted
        const onAbort = () => controller.abort();
        parentSignal?.addEventListener('abort', onAbort, { once: true });

        const res = await fetch(tileUrl, { signal: controller.signal });
        clearTimeout(timeout);
        parentSignal?.removeEventListener('abort', onAbort);

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

        if (this.cache.size >= TILE_CACHE_SIZE) {
          const first = this.cache.keys().next().value;
          if (first) this.cache.delete(first);
        }

        this.cache.set(key, ctx.getImageData(0, 0, 256, 256));
        return true;

      } catch (e) {
        if (parentSignal?.aborted) return false;
        if (attempt < TILE_RETRY_COUNT - 1) {
          await new Promise(r => setTimeout(r, TILE_RETRY_DELAY * (attempt + 1)));
        }
      }
    }
    return false;
  }

  abort() {
    this.abortController?.abort();
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
      const t = setTimeout(() => {
        w.removeEventListener('message', h);
        w.removeEventListener('error', errH);
        rej(new Error(`Worker ${idx} calculation timeout (5 min)`));
      }, 300000);
      const h = (e: MessageEvent) => {
        if (e.data.id === id && e.data.type === 'done') {
          clearTimeout(t);
          w.removeEventListener('message', h);
          w.removeEventListener('error', errH);
          res(e.data.payload);
        }
      };
      const errH = (e: ErrorEvent) => {
        clearTimeout(t);
        w.removeEventListener('message', h);
        w.removeEventListener('error', errH);
        rej(new Error(`Worker ${idx} error: ${e.message}`));
      };
      w.addEventListener('message', h);
      w.addEventListener('error', errH);
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

    // Determine mode: streaming (onBatchResult present) vs legacy
    const streaming = !!cb.onBatchResult;

    cb.onProgress?.({
      phase: 'generating',
      tilesLoaded: 0, tilesTotal: 0, tilesFailed: 0,
      pointsProcessed: 0, pointsTotal: 0,
      percent: 0, estimatedTimeRemaining: null, startTime: start
    });

    // ---- Point generation: lazy (gridConfig) or eager (legacy) ----
    let totalPoints: number;
    let pointIterator: Generator<Array<{ lat: number; lon: number }>> | null = null;
    let eagerPoints: Array<{ lat: number; lon: number }> | null = null;
    let zoom: number;
    let bounds: GridBounds | null = null;

    if (config.gridConfig) {
      // Lazy mode: use gridGenerator
      totalPoints = estimateTotalPoints(config.gridConfig);
      bounds = computeBounds(config.gridConfig);
      zoom = config.zoom || computeZoom(config.gridConfig);

      if (totalPoints === 0) {
        cb.onComplete?.({ mode: streaming ? 'streaming' : 'legacy', ...(streaming ? { summary: { totalProcessed: 0, clear: 0, blocked: 0, noData: 0, durationMs: 0 } } : { results: [] }) } as Completion);
        return [];
      }

      // Notify consumer of bounds + total so it can create StreamingRasterCanvas
      cb.onBoundsReady?.(bounds, totalPoints);

      const chunkSize = config.chunkSize || (totalPoints > 1000000 ? 10000 : DEFAULT_CHUNK_SIZE);
      pointIterator = generatePointChunks(config.gridConfig, chunkSize);
    } else {
      // Eager mode: generate all points upfront (legacy)
      eagerPoints = this.genPoints(config);
      totalPoints = eagerPoints.length;

      if (totalPoints === 0) {
        cb.onComplete?.({ mode: 'legacy', results: [] });
        return [];
      }
      if (totalPoints > MAX_POINTS) {
        const err = `מקסימום ${MAX_POINTS.toLocaleString()} נקודות`;
        cb.onError?.(err);
        throw new Error(err);
      }

      zoom = config.zoom || (totalPoints > 100000 ? 10 : totalPoints > 20000 ? 11 : 12);
    }

    // ---- Compute tile keys ----
    let tileKeys: string[];
    if (bounds) {
      // From bounds (lazy mode) — compute tile keys from bounding box
      tileKeys = this.getTileKeysFromBounds(bounds, zoom, config.gridConfig?.origin || config.origin);
    } else {
      // From points (eager mode)
      tileKeys = this.getTileKeys(eagerPoints!, zoom, config.origin);
    }

    console.log(`Calculating ~${totalPoints.toLocaleString()} points, need ${tileKeys.length} tiles at zoom ${zoom}`);

    // ---- Load tiles ----
    const tileData = await this.tiles.loadTiles(tileKeys, TERRAIN_CONFIG.url, (loaded, failed, total) => {
      if (this.cancelled) return;
      cb.onProgress?.({
        phase: 'preloading-tiles',
        tilesLoaded: loaded, tilesTotal: total, tilesFailed: failed,
        pointsProcessed: 0, pointsTotal: totalPoints,
        percent: Math.round((loaded + failed) / Math.max(1, total) * 10),
        estimatedTimeRemaining: null, startTime: start
      });
    });

    console.log(`Loaded ${tileData.size} tiles, ${this.tiles.getFailedCount()} failed`);
    if (this.cancelled) return [];

    // ---- Create worker pool ----
    const numW = Math.min(MAX_WORKERS, Math.max(2, Math.ceil(totalPoints / 1000)));
    this.pool = new WorkerPool(numW);
    console.log(`Using ${numW} workers`);

    const tileCounts = await this.pool.sendTiles(tileData);
    console.log(`Workers received tiles:`, tileCounts);

    if (this.cancelled) { this.pool.terminate(); this.pool = null; return []; }

    const calcConfig = {
      origin: config.gridConfig?.origin || config.origin,
      targetHeight: config.gridConfig?.targetHeight || config.targetHeight || 2,
      zoom,
      freqMHz: config.gridConfig?.frequencyMHz || config.frequencyMHz
    };

    // ---- Calculation loop ----
    // Streaming mode: no allResults[], call onBatchResult per batch
    // Legacy mode: accumulate in allResults[], call onPartialResult periodically
    const allResults: any[] = streaming ? [] : []; // legacy: accumulates; streaming: stays empty
    let done = 0;
    let streamClear = 0, streamBlocked = 0, streamNoData = 0;

    const chunkSize = config.chunkSize || (totalPoints > 1000000 ? 10000 : DEFAULT_CHUNK_SIZE);

    // Determine partial result frequency for legacy mode
    const partialResultInterval = totalPoints > 5000000 ? numW * 100 :
                                   totalPoints > 1000000 ? numW * 50 :
                                   numW * 20;

    // Build chunk source: either from generator or from eager points
    let eagerOffset = 0; // tracks position in eagerPoints across iterations
    const getNextChunks = (count: number): Array<Array<{ lat: number; lon: number }>> => {
      const chunks: Array<Array<{ lat: number; lon: number }>> = [];
      if (pointIterator) {
        // Lazy: pull from generator
        for (let i = 0; i < count; i++) {
          if (this.cancelled) break;
          const next = pointIterator.next();
          if (next.done) break;
          chunks.push(next.value);
        }
      } else if (eagerPoints) {
        // Eager: slice from array
        for (let i = 0; i < count && eagerOffset < eagerPoints.length; i++) {
          chunks.push(eagerPoints.slice(eagerOffset, eagerOffset + chunkSize));
          eagerOffset += chunkSize;
        }
      }
      return chunks;
    };

    let batchIndex = 0;
    let exhausted = false;
    console.log(`Starting calculation loop: streaming=${streaming}, totalPoints=${totalPoints.toLocaleString()}, chunkSize=${chunkSize}, numWorkers=${numW}, mode=${pointIterator ? 'lazy' : 'eager'}`);

    while (!exhausted && !this.cancelled) {
      while (this.paused && !this.cancelled) await new Promise(r => setTimeout(r, 100));
      if (this.cancelled) break;

      // Pull numW chunks to feed all workers in parallel
      const workerChunks = getNextChunks(numW);
      if (workerChunks.length === 0) {
        exhausted = true;
        break;
      }

      try {
        const batchResults = await Promise.all(
          workerChunks.map((c, j) => this.pool!.calc(j % numW, c, calcConfig))
        );

        // Ignore late results if cancelled during await
        if (this.cancelled) break;

        const batchPointCount = workerChunks.reduce((s, c) => s + c.length, 0);
        done += batchPointCount;

        if (streaming) {
          // Streaming mode: convert to RasterCell[] and call onBatchResult
          for (const workerResult of batchResults) {
            const rasterBatch: RasterCell[] = [];
            for (const r of workerResult) {
              const cell: RasterCell = {
                lat: r.lat,
                lon: r.lon,
                clear: r.clear ?? null,
                fresnelClear: r.fresnelClear ?? null,
                hasData: r.hasData !== false,
              };
              rasterBatch.push(cell);

              // Track stats
              if (!cell.hasData) streamNoData++;
              else if (cell.clear === true) streamClear++;
              else if (cell.clear === false) streamBlocked++;
              else streamNoData++; // clear === null with hasData — shouldn't happen, but safe
            }

            if (rasterBatch.length > 0 && !this.cancelled) {
              const pct = Math.min(99, 10 + Math.round(done / Math.max(1, totalPoints) * 90));
              const prog: TaskProgress = {
                phase: 'calculating',
                tilesLoaded: tileData.size, tilesTotal: tileKeys.length,
                tilesFailed: this.tiles.getFailedCount(),
                pointsProcessed: done, pointsTotal: totalPoints,
                percent: pct,
                estimatedTimeRemaining: this.estimateRemaining(start, done, totalPoints),
                startTime: start,
              };
              cb.onBatchResult!(rasterBatch, prog);
            }
          }
        } else {
          // Legacy mode: accumulate
          for (const r of batchResults) {
            for (let k = 0; k < r.length; k++) allResults.push(r[k]);
          }
        }
      } catch (e) {
        if (this.cancelled) break;
        console.error(`Batch calculation error (batch ${batchIndex}, done=${done.toLocaleString()}/${totalPoints.toLocaleString()}):`, e);
        done += workerChunks.reduce((s, c) => s + c.length, 0);
      }

      // Progress update (both modes)
      const pctOuter = Math.min(99, 10 + Math.round(done / Math.max(1, totalPoints) * 90));
      const prog: TaskProgress = {
        phase: 'calculating',
        tilesLoaded: tileData.size, tilesTotal: tileKeys.length,
        tilesFailed: this.tiles.getFailedCount(),
        pointsProcessed: done, pointsTotal: totalPoints,
        percent: pctOuter,
        estimatedTimeRemaining: this.estimateRemaining(start, done, totalPoints),
        startTime: start,
      };
      cb.onProgress?.(prog);

      // Legacy partial results
      if (!streaming && (batchIndex % partialResultInterval === 0 || exhausted)) {
        cb.onPartialResult?.(allResults, prog);
      }

      batchIndex += numW;
    }

    console.log(`Calculation loop ended: exhausted=${exhausted}, cancelled=${this.cancelled}, done=${done.toLocaleString()}/${totalPoints.toLocaleString()}, batches=${batchIndex}`);

    this.pool?.terminate();
    this.pool = null;

    if (!this.cancelled) {
      const durationMs = Date.now() - start;

      // Update totalPoints to actual count if generator produced a different amount
      const actualTotal = done;

      cb.onProgress?.({
        phase: 'finalizing',
        tilesLoaded: tileData.size, tilesTotal: tileKeys.length,
        tilesFailed: this.tiles.getFailedCount(),
        pointsProcessed: actualTotal, pointsTotal: actualTotal,
        percent: 100, estimatedTimeRemaining: 0, startTime: start
      });

      if (streaming) {
        const summary: StreamingSummary = {
          totalProcessed: actualTotal,
          clear: streamClear,
          blocked: streamBlocked,
          noData: streamNoData,
          durationMs,
        };
        console.log(`Streaming done: ${actualTotal.toLocaleString()} points, ${streamClear} clear, ${streamBlocked} blocked, ${streamNoData} noData, ${(durationMs / 1000).toFixed(1)}s`);
        // Await onComplete so the consumer can do final flush before we return
        await cb.onComplete?.({ mode: 'streaming', summary });
      } else {
        const withData = allResults.filter(r => r.hasData !== false).length;
        const noData = allResults.length - withData;
        console.log(`Results: ${withData} with data, ${noData} without data, total time: ${(durationMs / 1000).toFixed(1)}s`);
        await cb.onComplete?.({ mode: 'legacy', results: allResults });
      }
    }

    return streaming ? [] : allResults;
  }

  pause() { this.paused = true; }
  resume() { this.paused = false; }

  cancel() {
    this.cancelled = true;
    this.tiles.abort();
    this.pool?.terminate();
    this.pool = null;
  }

  clearCache() { this.tiles.clear(); }

  private estimateRemaining(start: number, done: number, total: number): number | null {
    const elapsed = Date.now() - start;
    const rate = done / elapsed;
    if (rate <= 0) return null;
    return Math.round((total - done) / rate / 1000);
  }

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

  private getTileKeysFromBounds(bounds: GridBounds, z: number, origin?: { lat: number; lon: number; height: number }): string[] {
    const n = Math.pow(2, z);

    let minLat = bounds.south, maxLat = bounds.north;
    let minLon = bounds.west, maxLon = bounds.east;
    if (origin) {
      if (origin.lat < minLat) minLat = origin.lat;
      if (origin.lat > maxLat) maxLat = origin.lat;
      if (origin.lon < minLon) minLon = origin.lon;
      if (origin.lon > maxLon) maxLon = origin.lon;
    }

    const toTile = (lat: number, lon: number) => {
      lat = Math.max(-85.05, Math.min(85.05, lat));
      const latRad = lat * Math.PI / 180;
      const tx = Math.floor(((lon + 180) / 360) * n);
      const ty = Math.floor((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2 * n);
      return { tx: Math.max(0, Math.min(n - 1, tx)), ty: Math.max(0, Math.min(n - 1, ty)) };
    };

    const tl = toTile(maxLat, minLon);
    const br = toTile(minLat, maxLon);

    const keys: string[] = [];
    for (let tx = tl.tx; tx <= br.tx; tx++) {
      for (let ty = tl.ty; ty <= br.ty; ty++) {
        keys.push(`${z}/${tx}/${ty}`);
      }
    }
    return keys;
  }

  private getTileKeys(pts: Array<{ lat: number; lon: number }>, z: number, origin?: { lat: number; lon: number }): string[] {
    const n = Math.pow(2, z);

    let minLat = Infinity, maxLat = -Infinity, minLon = Infinity, maxLon = -Infinity;
    for (const p of pts) {
      if (p.lat < minLat) minLat = p.lat;
      if (p.lat > maxLat) maxLat = p.lat;
      if (p.lon < minLon) minLon = p.lon;
      if (p.lon > maxLon) maxLon = p.lon;
    }
    if (origin) {
      if (origin.lat < minLat) minLat = origin.lat;
      if (origin.lat > maxLat) maxLat = origin.lat;
      if (origin.lon < minLon) minLon = origin.lon;
      if (origin.lon > maxLon) maxLon = origin.lon;
    }

    const toTile = (lat: number, lon: number) => {
      lat = Math.max(-85.05, Math.min(85.05, lat));
      const latRad = lat * Math.PI / 180;
      const tx = Math.floor(((lon + 180) / 360) * n);
      const ty = Math.floor((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2 * n);
      return { tx: Math.max(0, Math.min(n - 1, tx)), ty: Math.max(0, Math.min(n - 1, ty)) };
    };

    const tl = toTile(maxLat, minLon);
    const br = toTile(minLat, maxLon);

    const keys: string[] = [];
    for (let tx = tl.tx; tx <= br.tx; tx++) {
      for (let ty = tl.ty; ty <= br.ty; ty++) {
        keys.push(`${z}/${tx}/${ty}`);
      }
    }
    return keys;
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

export type { TaskProgress, TaskConfig, EngineCallbacks, StreamingSummary, Completion };
