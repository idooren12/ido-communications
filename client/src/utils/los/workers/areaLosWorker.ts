/**
 * Web Worker for the area (coverage) tool. Runs the same evaluateLOS as the line
 * tool, from the observer to every grid point it is given.
 */
/// <reference lib="webworker" />

import { TerrainSampler, type DemLayer } from '../core/terrain';
import { evaluateLOS, hasLineOfSight, type LosStatus } from '../core/losCore';

export interface AreaWorkerTiles {
  zoom: number;
  tiles: Record<string, ArrayBuffer>;
  layers?: DemLayer[];
}

export interface AreaWorkerCalc {
  points: Array<{ lat: number; lon: number }>;
  origin: { lat: number; lon: number; height: number };
  targetHeight: number;
  freqMHz?: number;
}

export interface AreaPointResult {
  lat: number;
  lon: number;
  status: LosStatus;
  clear: boolean | null;
  fresnelClear: boolean | null | undefined;
  hasData: boolean;
  minClearance: number | null;
}

let sampler: TerrainSampler | null = null;

export function setTerrain(payload: AreaWorkerTiles): number {
  const tiles = new Map<string, Uint8ClampedArray>();
  for (const [key, buf] of Object.entries(payload.tiles)) tiles.set(key, new Uint8ClampedArray(buf));
  sampler = new TerrainSampler(payload.zoom, tiles, payload.layers ?? []);
  return tiles.size;
}

export function calcPoints(payload: AreaWorkerCalc, s: TerrainSampler | null = sampler): AreaPointResult[] {
  if (!s) throw new Error('Terrain not loaded');
  const { origin, targetHeight, freqMHz } = payload;
  return payload.points.map(p => {
    const r = evaluateLOS(s, origin, { lat: p.lat, lon: p.lon, height: targetHeight }, { frequencyMHz: freqMHz });
    const hasData = r.status !== 'nodata';
    return {
      lat: p.lat,
      lon: p.lon,
      status: r.status,
      clear: hasData ? hasLineOfSight(r.status) : null,
      fresnelClear: hasData ? (freqMHz ? r.status === 'clear' : undefined) : null,
      hasData,
      minClearance: r.minClearance,
    };
  });
}

// Only wire up the message handler inside a real worker (the module is also imported by tests).
const scope = globalThis as unknown as DedicatedWorkerGlobalScope;
if (typeof WorkerGlobalScope !== 'undefined' && globalThis instanceof WorkerGlobalScope) {
  scope.onmessage = (e: MessageEvent) => {
    const { id, type, payload } = e.data;
    try {
      if (type === 'setTiles') {
        scope.postMessage({ id, type: 'ready', payload: { tileCount: setTerrain(payload) } });
      } else if (type === 'calc') {
        scope.postMessage({ id, type: 'done', payload: calcPoints(payload) });
      }
    } catch (err) {
      scope.postMessage({ id, type: 'error', payload: err instanceof Error ? err.message : String(err) });
    }
  };
}
