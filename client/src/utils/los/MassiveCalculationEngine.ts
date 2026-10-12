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
import { tileKeysForBounds, boundsOf, demZoomForExtent, type DemLayer } from './core/terrain';
import { haversineMeters, type LosStatus } from './core/losCore';
import { fetchTerrariumTile } from './core/tileLoader';
import i18n from '../../i18n/config';

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
  /** RF: line of sight, but the Fresnel zone is obstructed. */
  fresnel: number;
  /** Blocked by less than the terrain data's accuracy. */
  marginal: number;
  blocked: number;
  noData: number;
  durationMs: number;
}

/** Discriminated union for onComplete */
/** One point as returned by a calculation worker. */
export interface WorkerPointResult {
  lat: number;
  lon: number;
  status?: LosStatus;
  clear?: boolean | null;
  fresnelClear?: boolean | null;
  hasData?: boolean;
  [key: string]: unknown;
}

export type Completion =
  | { mode: 'legacy'; results: WorkerPointResult[] }
  | { mode: 'streaming'; summary: StreamingSummary };

export interface EngineCallbacks {
  onProgress?: (progress: TaskProgress) => void;
  /** Legacy: receives entire accumulated results array */
  onPartialResult?: (partialResult: WorkerPointResult[], progress: TaskProgress) => void;
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
const TILE_BATCH_SIZE = 20;

// ============================================================================
// Tile Manager with Retry
// ============================================================================

class TileManager {
  private cache = new Map<string, Uint8ClampedArray>();
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
      if (d) result.set(k, d);
    }
    return result;
  }

  private async loadTileWithRetry(key: string, baseUrl: string, parentSignal?: AbortSignal): Promise<boolean> {
    const data = await fetchTerrariumTile(key, baseUrl, parentSignal);
    if (!data) return false;
    if (this.cache.size >= TILE_CACHE_SIZE) {
      const first = this.cache.keys().next().value;
      if (first) this.cache.delete(first);
    }
    this.cache.set(key, data);
    return true;
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

  constructor(n: number) {
    for (let i = 0; i < n; i++) {
      this.workers.push(new Worker(new URL('./workers/areaLosWorker.ts', import.meta.url), { type: 'module' }));
    }
  }

  async sendTiles(data: Map<string, Uint8ClampedArray>, zoom: number, layers: DemLayer[]): Promise<number[]> {
    const obj: Record<string, ArrayBuffer> = {};
    data.forEach((v, k) => { obj[k] = v.slice().buffer as ArrayBuffer; });

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
      w.postMessage({ id: i, type: 'setTiles', payload: { zoom, tiles: obj, layers } });
    })));

    return results;
  }

  async calc(idx: number, points: Array<{ lat: number; lon: number }>, config: Record<string, unknown>): Promise<WorkerPointResult[]> {
    return new Promise((res, rej) => {
      const w = this.workers[idx];
      const id = Date.now() + '-' + idx + '-' + Math.random();
      const t = setTimeout(() => {
        w.removeEventListener('message', h);
        w.removeEventListener('error', errH);
        rej(new Error(`Worker ${idx} calculation timeout (5 min)`));
      }, 300000);
      const h = (e: MessageEvent) => {
        if (e.data.id !== id) return;
        if (e.data.type === 'done' || e.data.type === 'error') {
          clearTimeout(t);
          w.removeEventListener('message', h);
          w.removeEventListener('error', errH);
          if (e.data.type === 'done') res(e.data.payload);
          else rej(new Error(`Worker ${idx} error: ${e.data.payload}`));
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

  async calculate(config: TaskConfig, cb: EngineCallbacks = {}): Promise<WorkerPointResult[]> {
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
        cb.onComplete?.({ mode: streaming ? 'streaming' : 'legacy', ...(streaming ? { summary: { totalProcessed: 0, clear: 0, fresnel: 0, marginal: 0, blocked: 0, noData: 0, durationMs: 0 } } : { results: [] }) } as Completion);
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
        const err = i18n.t('los.losArea.maxPointsExceeded', { max: MAX_POINTS.toLocaleString() });
        cb.onError?.(err);
        throw new Error(err);
      }

      const o = config.origin;
      const extent = o ? Math.max(...eagerPoints.map(p => haversineMeters(o.lat, o.lon, p.lat, p.lon))) : 0;
      zoom = config.zoom || demZoomForExtent(extent);
    }

    // ---- Compute tile keys ----
    let tileKeys: string[];
    if (bounds) {
      // From bounds (lazy mode) — compute tile keys from bounding box
      const o = config.gridConfig?.origin || config.origin;
      tileKeys = tileKeysForBounds(o ? boundsOf([
        { lat: bounds.south, lon: bounds.west }, { lat: bounds.north, lon: bounds.east }, o,
      ]) : bounds, zoom);
    } else {
      // From points (eager mode)
      tileKeys = tileKeysForBounds(boundsOf(config.origin ? [...eagerPoints!, config.origin] : eagerPoints!), zoom);
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
    // Uploaded custom DSM layers override terrain tiles (they used to be ignored here).
    const layers = await loadCustomLayers();
    // Each worker gets its own copy of the DSM rasters, so use fewer workers when they exist.
    const maxWorkers = layers.length > 0 ? Math.min(MAX_WORKERS, 4) : MAX_WORKERS;
    const numW = Math.min(maxWorkers, Math.max(2, Math.ceil(totalPoints / 1000)));
    this.pool = new WorkerPool(numW);
    console.log(`Using ${numW} workers`);

    const tileCounts = await this.pool.sendTiles(tileData, zoom, layers);
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
    const allResults: WorkerPointResult[] = []; // legacy: accumulates; streaming: stays empty
    let done = 0;
    let streamClear = 0, streamFresnel = 0, streamMarginal = 0, streamBlocked = 0, streamNoData = 0;

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
                status: r.status,
                clear: r.clear ?? null,
                fresnelClear: r.fresnelClear ?? null,
                hasData: r.hasData !== false,
              };
              rasterBatch.push(cell);

              switch (r.status) {
                case 'clear': streamClear++; break;
                case 'fresnel': streamFresnel++; break;
                case 'marginal': streamMarginal++; break;
                case 'blocked': streamBlocked++; break;
                default: streamNoData++;
              }
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
          fresnel: streamFresnel,
          marginal: streamMarginal,
          blocked: streamBlocked,
          noData: streamNoData,
          durationMs,
        };
        console.log(`Streaming done: ${actualTotal.toLocaleString()} points, ${streamClear} clear, ${streamFresnel} fresnel, ${streamMarginal} marginal, ${streamBlocked} blocked, ${streamNoData} noData, ${(durationMs / 1000).toFixed(1)}s`);
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

}

// ============================================================================
// Exports
// ============================================================================

let instance: Engine | null = null;
export function getMassiveEngine(): Engine {
  if (!instance) instance = new Engine();
  return instance;
}

export async function smartCalculate(config: TaskConfig, cb: EngineCallbacks = {}): Promise<WorkerPointResult[]> {
  return getMassiveEngine().calculate(config, cb);
}

/** Uploaded custom DSM layers (empty when none are loaded). */
async function loadCustomLayers(): Promise<DemLayer[]> {
  try {
    const dsm = await import('./customDSM');
    return dsm.getCustomLayers();
  } catch {
    return [];
  }
}
