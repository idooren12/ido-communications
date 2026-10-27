/**
 * Area (coverage) calculation engine: streams grid points to a pool of Web Workers that run
 * the shared LOS model, and streams the results back.
 *
 * - Lazy point generation via GridConfig (O(chunkSize) memory)
 * - Terrain: tiles decoded once to packed Uint16 elevations (2 bytes/pixel), sent to each
 *   worker as one transferred buffer
 * - DEM zoom chosen by a memory budget (zoom 12 up to ~80 km radius), worker count by memory
 * - Failed batches are reported as "no data" cells, so the map and the counts stay complete
 */

import { TERRAIN_CONFIG } from './constants';
import { type GridConfig, type GridLayout, generatePointChunks, computeBounds, estimateTotalPoints, computeZoom, gridLayout, terrainBounds } from './gridGenerator';
import type { RasterCell, GridBounds } from './losAreaRaster';
import { tileKeysForBounds, boundsOf, chooseAreaZoom, groundResolution, type DemLayer } from './core/terrain';
import type { LosStatus } from './core/losCore';
import { fetchPackedTile } from './core/tileLoader';
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
  refractionK?: number;
  points?: Array<{ lat: number; lon: number }>;
  chunkSize?: number;
  zoom?: number;
  /** Lazy grid configuration (the normal path). */
  gridConfig?: GridConfig;
}

/** What terrain the calculation used. */
export interface TerrainInfo {
  zoom: number;
  /** DEM pixel size at the observer, metres. */
  pixelM: number;
  tilesLoaded: number;
  tilesFailed: number;
  workers: number;
}

/** Summary returned by onComplete in streaming mode */
export interface StreamingSummary {
  totalProcessed: number;
  clear: number;
  /** RF: line of sight, but the Fresnel zone is obstructed. */
  fresnel: number;
  /** Within the terrain data's uncertainty. */
  marginal: number;
  blocked: number;
  noData: number;
  /** Points whose batch failed (included in noData). */
  failed: number;
  durationMs: number;
}

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
  /** Called when bounds, the grid layout and total points are known, before tile loading */
  onBoundsReady?: (bounds: GridBounds, totalPoints: number, layout: GridLayout | null) => void;
  /** Called once the terrain is loaded, with the DEM resolution used. */
  onTerrainReady?: (info: TerrainInfo) => void;
  /** Called on completion. May be async — the engine awaits it. */
  onComplete?: (result: Completion) => void | Promise<void>;
  onError?: (error: string) => void;
}

// ============================================================================
// Constants
// ============================================================================

const DEFAULT_CHUNK_SIZE = 5000;
const HW_CONCURRENCY = typeof navigator !== 'undefined' ? (navigator.hardwareConcurrency || 4) : 4;
const MAX_WORKERS = Math.min(HW_CONCURRENCY, 12);
/** Total memory the workers' terrain copies may take. */
const WORKER_MEMORY_BUDGET_BYTES = 512 * 1024 * 1024;
const MAX_POINTS = 500000000;
const TILE_BATCH_SIZE = 20;
const TILE_PIXELS = 256 * 256;

// ============================================================================
// Tile Manager
// ============================================================================

class TileManager {
  private cache = new Map<string, Uint16Array>();
  private abortController: AbortController | null = null;
  private failedLastRun = 0;
  private readonly maxEntries = 2000;

  /** Load tiles; failures are retried on every run (a network blip must not poison later runs). */
  async loadTiles(
    keys: string[],
    url: string,
    onProgress?: (loaded: number, failed: number, total: number) => void
  ): Promise<Map<string, Uint16Array>> {
    this.abortController = new AbortController();
    const { signal } = this.abortController;

    const toLoad = keys.filter(k => !this.cache.has(`${url}|${k}`));
    let loaded = 0;
    let failed = 0;

    for (let i = 0; i < toLoad.length; i += TILE_BATCH_SIZE) {
      if (signal.aborted) break;
      const batch = toLoad.slice(i, i + TILE_BATCH_SIZE);
      await Promise.all(batch.map(async key => {
        if (signal.aborted) return;
        const data = await fetchPackedTile(key, url, signal);
        if (signal.aborted) return;
        if (data) {
          if (this.cache.size >= this.maxEntries) {
            const first = this.cache.keys().next().value;
            if (first) this.cache.delete(first);
          }
          this.cache.set(`${url}|${key}`, data);
          loaded++;
        } else {
          failed++;
        }
        onProgress?.(loaded, failed, toLoad.length);
      }));
    }

    this.abortController = null;
    this.failedLastRun = failed;
    const result = new Map<string, Uint16Array>();
    for (const k of keys) {
      const d = this.cache.get(`${url}|${k}`);
      if (d) result.set(k, d);
    }
    return result;
  }

  abort() { this.abortController?.abort(); }
  clear() { this.cache.clear(); }
  getFailedCount() { return this.failedLastRun; }
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

  /** Send the terrain to every worker: one packed buffer each, transferred (no second copy). */
  async sendTiles(data: Map<string, Uint16Array>, zoom: number, layers: DemLayer[]): Promise<number[]> {
    const keys = [...data.keys()];
    const packed = new Uint16Array(keys.length * TILE_PIXELS);
    keys.forEach((k, i) => packed.set(data.get(k)!, i * TILE_PIXELS));

    return Promise.all(this.workers.map((w, i) => new Promise<number>((res, rej) => {
      const t = setTimeout(() => rej(new Error('Worker timeout')), 60000);
      const h = (e: MessageEvent) => {
        if (e.data.type === 'ready') {
          clearTimeout(t);
          w.removeEventListener('message', h);
          res(e.data.payload?.tileCount || 0);
        } else if (e.data.type === 'error') {
          clearTimeout(t);
          w.removeEventListener('message', h);
          rej(new Error(String(e.data.payload)));
        }
      };
      w.addEventListener('message', h);
      const copy = i === this.workers.length - 1 ? packed : packed.slice();
      w.postMessage({ id: i, type: 'setTiles', payload: { zoom, keys, packed: copy, layers } }, [copy.buffer]);
    })));
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

/** Number of workers: by CPU, by work, and so that their terrain copies fit the memory budget. */
export function workerCount(totalPoints: number, terrainBytes: number, hasLayers: boolean): number {
  const byMemory = Math.max(1, Math.floor(WORKER_MEMORY_BUDGET_BYTES / Math.max(1, terrainBytes)));
  const cap = hasLayers ? Math.min(MAX_WORKERS, 4) : MAX_WORKERS;
  return Math.max(1, Math.min(cap, byMemory, Math.ceil(totalPoints / 1000)));
}

function layersBytes(layers: DemLayer[]): number {
  return layers.reduce((s, l) => s + l.width * l.height * 4, 0);
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
    const streaming = !!cb.onBatchResult;

    cb.onProgress?.({
      phase: 'generating',
      tilesLoaded: 0, tilesTotal: 0, tilesFailed: 0,
      pointsProcessed: 0, pointsTotal: 0,
      percent: 0, estimatedTimeRemaining: null, startTime: start
    });

    // ---- Points: lazy (gridConfig) or a given list ----
    let totalPoints: number;
    let pointIterator: Generator<Array<{ lat: number; lon: number }>> | null = null;
    let eagerPoints: Array<{ lat: number; lon: number }> | null = null;
    let zoom: number;
    let tileBounds: GridBounds;
    const origin = config.gridConfig?.origin ?? config.origin;
    if (!origin) {
      cb.onError?.('No origin');
      return [];
    }

    if (config.gridConfig) {
      totalPoints = estimateTotalPoints(config.gridConfig);
      const bounds = computeBounds(config.gridConfig);
      tileBounds = terrainBounds(config.gridConfig);
      zoom = config.zoom ?? computeZoom(config.gridConfig);

      if (totalPoints === 0) {
        await cb.onComplete?.(streaming
          ? { mode: 'streaming', summary: { totalProcessed: 0, clear: 0, fresnel: 0, marginal: 0, blocked: 0, noData: 0, failed: 0, durationMs: 0 } }
          : { mode: 'legacy', results: [] });
        return [];
      }
      cb.onBoundsReady?.(bounds, totalPoints, gridLayout(config.gridConfig));
      const chunkSize = config.chunkSize || (totalPoints > 1000000 ? 10000 : DEFAULT_CHUNK_SIZE);
      pointIterator = generatePointChunks(config.gridConfig, chunkSize);
    } else {
      eagerPoints = config.points ?? [];
      totalPoints = eagerPoints.length;
      if (totalPoints === 0) {
        await cb.onComplete?.({ mode: 'legacy', results: [] });
        return [];
      }
      if (totalPoints > MAX_POINTS) {
        const err = i18n.t('los.losArea.maxPointsExceeded', { max: MAX_POINTS.toLocaleString() });
        cb.onError?.(err);
        throw new Error(err);
      }
      tileBounds = boundsOf([...eagerPoints, origin]);
      zoom = config.zoom ?? chooseAreaZoom(tileBounds);
    }

    const tileKeys = tileKeysForBounds(tileBounds, zoom);

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
    if (this.cancelled) return [];

    // ---- Worker pool ----
    const layers = await loadCustomLayers();
    const terrainBytes = tileData.size * TILE_PIXELS * 2 + layersBytes(layers);
    const numW = workerCount(totalPoints, terrainBytes, layers.length > 0);
    this.pool = new WorkerPool(numW);
    try {
      await this.pool.sendTiles(tileData, zoom, layers);
    } catch (e) {
      this.pool.terminate();
      this.pool = null;
      const msg = e instanceof Error ? e.message : String(e);
      cb.onError?.(msg);
      throw e;
    }
    if (this.cancelled) { this.pool.terminate(); this.pool = null; return []; }

    cb.onTerrainReady?.({
      zoom,
      pixelM: groundResolution(origin.lat, zoom),
      tilesLoaded: tileData.size,
      tilesFailed: tileKeys.length - tileData.size,
      workers: numW,
    });

    const calcConfig = {
      origin,
      targetHeight: config.gridConfig?.targetHeight ?? config.targetHeight ?? 2,
      freqMHz: config.gridConfig?.frequencyMHz ?? config.frequencyMHz,
      refractionK: config.refractionK,
    };

    // ---- Calculation loop ----
    const allResults: WorkerPointResult[] = [];
    let done = 0;
    let streamClear = 0, streamFresnel = 0, streamMarginal = 0, streamBlocked = 0, streamNoData = 0, streamFailed = 0;
    const chunkSize = config.chunkSize || (totalPoints > 1000000 ? 10000 : DEFAULT_CHUNK_SIZE);

    let eagerOffset = 0;
    const getNextChunks = (count: number): Array<Array<{ lat: number; lon: number }>> => {
      const chunks: Array<Array<{ lat: number; lon: number }>> = [];
      if (pointIterator) {
        for (let i = 0; i < count; i++) {
          if (this.cancelled) break;
          const next = pointIterator.next();
          if (next.done) break;
          chunks.push(next.value);
        }
      } else if (eagerPoints) {
        for (let i = 0; i < count && eagerOffset < eagerPoints.length; i++) {
          chunks.push(eagerPoints.slice(eagerOffset, eagerOffset + chunkSize));
          eagerOffset += chunkSize;
        }
      }
      return chunks;
    };

    const progressNow = (): TaskProgress => ({
      phase: 'calculating',
      tilesLoaded: tileData.size, tilesTotal: tileKeys.length,
      tilesFailed: tileKeys.length - tileData.size,
      pointsProcessed: done, pointsTotal: Math.max(totalPoints, done),
      percent: Math.min(99, 10 + Math.round(done / Math.max(1, totalPoints) * 90)),
      estimatedTimeRemaining: this.estimateRemaining(start, done, totalPoints),
      startTime: start,
    });

    const emit = (results: WorkerPointResult[]) => {
      if (!streaming) {
        for (const r of results) allResults.push(r);
        return;
      }
      const rasterBatch: RasterCell[] = new Array(results.length);
      for (let i = 0; i < results.length; i++) {
        const r = results[i];
        rasterBatch[i] = { lat: r.lat, lon: r.lon, status: r.status, clear: r.clear ?? null, fresnelClear: r.fresnelClear ?? null, hasData: r.hasData !== false };
        switch (r.status) {
          case 'clear': streamClear++; break;
          case 'fresnel': streamFresnel++; break;
          case 'marginal': streamMarginal++; break;
          case 'blocked': streamBlocked++; break;
          default: streamNoData++;
        }
      }
      if (rasterBatch.length > 0 && !this.cancelled) cb.onBatchResult!(rasterBatch, progressNow());
    };

    while (!this.cancelled) {
      while (this.paused && !this.cancelled) await new Promise(r => setTimeout(r, 100));
      if (this.cancelled) break;

      const workerChunks = getNextChunks(numW);
      if (workerChunks.length === 0) break;

      const settled = await Promise.allSettled(workerChunks.map((c, j) => this.pool!.calc(j % numW, c, calcConfig)));
      if (this.cancelled) break;

      settled.forEach((s, j) => {
        done += workerChunks[j].length;
        if (s.status === 'fulfilled') {
          emit(s.value);
        } else {
          // A failed batch is shown as "no data", never silently dropped.
          console.error('Batch calculation error:', s.reason);
          streamFailed += workerChunks[j].length;
          emit(workerChunks[j].map(p => ({ lat: p.lat, lon: p.lon, status: 'nodata' as LosStatus, clear: null, fresnelClear: null, hasData: false })));
        }
      });

      const prog = progressNow();
      cb.onProgress?.(prog);
      if (!streaming) cb.onPartialResult?.(allResults, prog);
    }

    this.pool?.terminate();
    this.pool = null;

    if (!this.cancelled) {
      const durationMs = Date.now() - start;
      cb.onProgress?.({
        phase: 'finalizing',
        tilesLoaded: tileData.size, tilesTotal: tileKeys.length,
        tilesFailed: tileKeys.length - tileData.size,
        pointsProcessed: done, pointsTotal: done,
        percent: 100, estimatedTimeRemaining: 0, startTime: start
      });

      if (streaming) {
        await cb.onComplete?.({
          mode: 'streaming',
          summary: {
            totalProcessed: done,
            clear: streamClear,
            fresnel: streamFresnel,
            marginal: streamMarginal,
            blocked: streamBlocked,
            noData: streamNoData,
            failed: streamFailed,
            durationMs,
          },
        });
      } else {
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
    if (!(rate > 0)) return null;
    return Math.max(0, Math.round((total - done) / rate / 1000));
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
