/**
 * Worker Pool Manager
 * Manages a pool of Web Workers for parallel calculations
 */

export interface WorkerTask<T = any, R = any> {
  id: string;
  type: string;
  payload: T;
  resolve: (result: R) => void;
  reject: (error: Error) => void;
  onProgress?: (progress: { current: number; total: number }) => void;
}

export interface WorkerPoolOptions {
  maxWorkers?: number;
}

// Worker code as a blob URL (self-contained)
function createWorkerBlob(): string {
  const workerCode = `
// LOS Calculation Web Worker - Inline Version

const SPEED_OF_LIGHT = 299792458;
const EARTH_RADIUS = 6371000;
const K_STANDARD = 1.33;
const DEFAULT_TILES_URL = 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png';

const tileCache = new Map();
const pendingTiles = new Map();
const MAX_CACHE_SIZE = 2000;

async function loadTile(tileX, tileY, zoom, tilesUrl) {
  const cacheKey = zoom + '/' + tileX + '/' + tileY;
  if (tileCache.has(cacheKey)) return tileCache.get(cacheKey);
  if (pendingTiles.has(cacheKey)) return pendingTiles.get(cacheKey);

  const loadPromise = (async () => {
    try {
      const url = tilesUrl.replace('{z}', zoom).replace('{x}', tileX).replace('{y}', tileY);
      const response = await fetch(url);
      if (!response.ok) return null;
      const blob = await response.blob();
      const bitmap = await createImageBitmap(blob);
      const canvas = new OffscreenCanvas(256, 256);
      const ctx = canvas.getContext('2d');
      ctx.drawImage(bitmap, 0, 0);
      const imageData = ctx.getImageData(0, 0, 256, 256);
      if (tileCache.size >= MAX_CACHE_SIZE) {
        const firstKey = tileCache.keys().next().value;
        tileCache.delete(firstKey);
      }
      tileCache.set(cacheKey, imageData);
      return imageData;
    } catch (e) { return null; }
  })();

  pendingTiles.set(cacheKey, loadPromise);
  const result = await loadPromise;
  pendingTiles.delete(cacheKey);
  return result;
}

function lngLatToTileCoords(lng, lat, zoom) {
  const n = Math.pow(2, zoom);
  const latRad = (lat * Math.PI) / 180;
  const tileX = Math.floor(((lng + 180) / 360) * n);
  const tileY = Math.floor((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2 * n);
  const pixelX = Math.floor((((lng + 180) / 360) * n - tileX) * 256);
  const pixelY = Math.floor(((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2 * n - tileY) * 256);
  return { tileX, tileY, pixelX: Math.min(255, Math.max(0, pixelX)), pixelY: Math.min(255, Math.max(0, pixelY)) };
}

function decodeTerrarium(r, g, b) { return (r * 256 + g + b / 256) - 32768; }

async function batchSampleElevations(points, zoom, tilesUrl) {
  const tileGroups = new Map();
  points.forEach((point, index) => {
    const { tileX, tileY, pixelX, pixelY } = lngLatToTileCoords(point.lng, point.lat, zoom);
    const key = tileX + '/' + tileY;
    if (!tileGroups.has(key)) tileGroups.set(key, []);
    tileGroups.get(key).push({ index, pixelX, pixelY });
  });

  const results = new Array(points.length).fill(null);
  await Promise.all(Array.from(tileGroups.entries()).map(async ([key, samples]) => {
    const [tileX, tileY] = key.split('/').map(Number);
    const imageData = await loadTile(tileX, tileY, zoom, tilesUrl);
    if (!imageData) return;
    for (const { index, pixelX, pixelY } of samples) {
      const idx = (pixelY * 256 + pixelX) * 4;
      if (imageData.data[idx + 3] > 0) {
        results[index] = decodeTerrarium(imageData.data[idx], imageData.data[idx + 1], imageData.data[idx + 2]);
      }
    }
  }));
  return results;
}

function haversineDistance(lat1, lon1, lat2, lon2) {
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
  return EARTH_RADIUS * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function initialBearing(lat1, lon1, lat2, lon2) {
  const \u03C61 = lat1 * Math.PI / 180, \u03C62 = lat2 * Math.PI / 180, \u0394\u03BB = (lon2 - lon1) * Math.PI / 180;
  const y = Math.sin(\u0394\u03BB) * Math.cos(\u03C62);
  const x = Math.cos(\u03C61) * Math.sin(\u03C62) - Math.sin(\u03C61) * Math.cos(\u03C62) * Math.cos(\u0394\u03BB);
  return ((Math.atan2(y, x) * 180 / Math.PI) + 360) % 360;
}

function interpolateGreatCircle(p1, p2, fraction) {
  if (fraction === 0) return p1;
  if (fraction === 1) return p2;
  const \u03C61 = p1.lat * Math.PI / 180, \u03BB1 = p1.lon * Math.PI / 180;
  const \u03C62 = p2.lat * Math.PI / 180, \u03BB2 = p2.lon * Math.PI / 180;
  const \u0394\u03C6 = \u03C62 - \u03C61, \u0394\u03BB = \u03BB2 - \u03BB1;
  const a = Math.sin(\u0394\u03C6 / 2) ** 2 + Math.cos(\u03C61) * Math.cos(\u03C62) * Math.sin(\u0394\u03BB / 2) ** 2;
  const \u03B4 = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  if (\u03B4 === 0) return p1;
  const A = Math.sin((1 - fraction) * \u03B4) / Math.sin(\u03B4);
  const B = Math.sin(fraction * \u03B4) / Math.sin(\u03B4);
  const x = A * Math.cos(\u03C61) * Math.cos(\u03BB1) + B * Math.cos(\u03C62) * Math.cos(\u03BB2);
  const y = A * Math.cos(\u03C61) * Math.sin(\u03BB1) + B * Math.cos(\u03C62) * Math.sin(\u03BB2);
  const z = A * Math.sin(\u03C61) + B * Math.sin(\u03C62);
  return { lat: Math.atan2(z, Math.sqrt(x ** 2 + y ** 2)) * 180 / Math.PI, lon: Math.atan2(y, x) * 180 / Math.PI };
}

function calculateFresnelRadius(d1, d2, wavelength) {
  const totalDistance = d1 + d2;
  if (totalDistance === 0) return 0;
  return Math.sqrt((wavelength * d1 * d2) / totalDistance);
}

function calculateOptimalZoom(distanceMeters) {
  if (distanceMeters > 100000) return 10;
  if (distanceMeters > 50000) return 11;
  if (distanceMeters > 10000) return 12;
  return 13;
}

async function calculateLOS(task) {
  const { pointA, pointB, options = {} } = task;
  const { earthRadius = EARTH_RADIUS, refractionK = K_STANDARD, sampleStepMeters = 30, minSamples = 10, maxSamples = 10000, frequencyMHz, fresnelZonePercent = 60, tilesUrl = DEFAULT_TILES_URL, zoom: zoomOverride } = options;

  const totalDistance = haversineDistance(pointA.lat, pointA.lon, pointB.lat, pointB.lon);
  const bearing = initialBearing(pointA.lat, pointA.lon, pointB.lat, pointB.lon);
  const calculatedSamples = Math.ceil(totalDistance / sampleStepMeters);
  const numSamples = Math.max(minSamples, Math.min(maxSamples, calculatedSamples));
  const wavelength = frequencyMHz ? SPEED_OF_LIGHT / (frequencyMHz * 1000000) : undefined;

  const samplePoints = [];
  for (let i = 0; i <= numSamples; i++) {
    const fraction = i / numSamples;
    const point = interpolateGreatCircle({ lat: pointA.lat, lon: pointA.lon }, { lat: pointB.lat, lon: pointB.lon }, fraction);
    samplePoints.push({ lat: point.lat, lon: point.lon, distance: totalDistance * fraction, fraction });
  }

  const zoom = zoomOverride || calculateOptimalZoom(totalDistance);
  const elevations = await batchSampleElevations(samplePoints.map(p => ({ lng: p.lon, lat: p.lat })), zoom, tilesUrl);

  const startGroundElev = elevations[0] ?? 0;
  const endGroundElev = elevations[elevations.length - 1] ?? 0;
  const startHeight = startGroundElev + pointA.antennaHeight;
  const endHeight = endGroundElev + pointB.antennaHeight;

  const profile = [];
  let minClearance = null, minClearanceDistance = 0, minFresnelClearance = null, obstruction = undefined, nullSamples = 0;

  for (let i = 0; i < samplePoints.length; i++) {
    const { lat, lon, distance, fraction } = samplePoints[i];
    const groundElevation = elevations[i];
    if (groundElevation === null) nullSamples++;

    const d1 = distance, d2 = totalDistance - distance;
    const curvatureDrop = (d1 * d2) / (2 * earthRadius * refractionK);
    const losHeight = startHeight + (endHeight - startHeight) * fraction - curvatureDrop;
    const clearance = groundElevation !== null ? losHeight - groundElevation : null;

    let fresnelRadius, fresnelClearance;
    if (wavelength && d1 > 0 && d2 > 0) {
      fresnelRadius = calculateFresnelRadius(d1, d2, wavelength);
      if (clearance !== null) {
        const requiredClearance = fresnelRadius * (fresnelZonePercent / 100);
        fresnelClearance = clearance - requiredClearance;
        if (minFresnelClearance === null || fresnelClearance < minFresnelClearance) minFresnelClearance = fresnelClearance;
      }
    }

    profile.push({ lat, lon, distance, groundElevation, losHeight, clearance, fresnelRadius, fresnelClearance });

    if (clearance !== null && (minClearance === null || clearance < minClearance)) {
      minClearance = clearance;
      minClearanceDistance = distance;
      if (clearance < 0 && (!obstruction || -clearance > obstruction.blockageAmount)) {
        obstruction = { lat, lon, distance, elevation: groundElevation, blockageAmount: -clearance, fresnelIntrusion: fresnelRadius ? Math.min(100, (-clearance / fresnelRadius) * 100) : undefined };
      }
    }
  }

  // Enhanced confidence calculation
  const validElevations = elevations.filter(e => e !== null);
  const dataCompleteness = validElevations.length / elevations.length;

  // Calculate variance
  let elevationVariance = 0;
  if (validElevations.length > 1) {
    const mean = validElevations.reduce((a, b) => a + b, 0) / validElevations.length;
    const squaredDiffs = validElevations.map(v => Math.pow(v - mean, 2));
    elevationVariance = Math.sqrt(squaredDiffs.reduce((a, b) => a + b, 0) / validElevations.length);
  }

  // Count suspicious jumps
  const stepDist = totalDistance / numSamples;
  const maxChange = 500 * (stepDist / 30);
  let suspiciousJumps = 0;
  let prevVal = null;
  for (const elev of elevations) {
    if (elev !== null) {
      if (prevVal !== null && Math.abs(elev - prevVal) > maxChange) suspiciousJumps++;
      prevVal = elev;
    }
  }

  const confidenceDetails = { dataCompleteness, elevationVariance, suspiciousJumps, interpolatedPoints: nullSamples };

  const nullRatio = nullSamples / samplePoints.length;
  const confidence = (nullRatio < 0.05 && suspiciousJumps === 0) ? 'high' : (nullRatio < 0.15 && suspiciousJumps < samplePoints.length * 0.02) ? 'medium' : 'low';

  // Validation
  const warnings = [];
  const errors = [];
  if (totalDistance > 200000) warnings.push('\u05DE\u05E8\u05D7\u05E7 \u05D2\u05D3\u05D5\u05DC \u05DE-200 \u05E7"\u05DE');
  if (dataCompleteness < 0.5) warnings.push('\u05E0\u05EA\u05D5\u05E0\u05D9\u05DD \u05D7\u05DC\u05E7\u05D9\u05D9\u05DD (' + Math.round(dataCompleteness * 100) + '%)');
  const validation = { valid: errors.length === 0, warnings, errors };

  const clear = obstruction === undefined && (minClearance === null || minClearance >= 0);
  const fresnelClear = wavelength ? (minFresnelClearance === null || minFresnelClearance >= 0) : undefined;

  return { clear, fresnelClear, totalDistance, bearing, minClearance, minClearanceDistance, minFresnelClearance, profile, obstruction, confidence, confidenceDetails, nullSamples, totalSamples: samplePoints.length, frequencyMHz, validation };
}

self.onmessage = async (e) => {
  const { id, type, payload } = e.data;
  try {
    if (type === 'calculateLOS') {
      const result = await calculateLOS(payload);
      self.postMessage({ id, type: 'result', payload: result });
    } else if (type === 'batchLOS') {
      const tasks = payload;
      const results = [];
      for (let i = 0; i < tasks.length; i++) {
        const result = await calculateLOS(tasks[i]);
        results.push(result);
        self.postMessage({ id, type: 'progress', payload: { current: i + 1, total: tasks.length } });
      }
      self.postMessage({ id, type: 'result', payload: results });
    }
  } catch (error) {
    self.postMessage({ id, type: 'error', payload: error.message });
  }
};

self.postMessage({ type: 'ready' });
  `;

  const blob = new Blob([workerCode], { type: 'application/javascript' });
  return URL.createObjectURL(blob);
}

export class WorkerPool {
  private workers: Worker[] = [];
  private availableWorkers: Worker[] = [];
  private taskQueue: WorkerTask[] = [];
  private activeTasks: Map<string, WorkerTask> = new Map();
  private maxWorkers: number;
  private initialized: boolean = false;
  private initPromise: Promise<void> | null = null;
  private workerBlobUrl: string | null = null;

  constructor(options: WorkerPoolOptions = {}) {
    this.maxWorkers = options.maxWorkers || Math.min(navigator.hardwareConcurrency || 4, 8);
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;
    if (this.initPromise) return this.initPromise;

    this.initPromise = new Promise<void>((resolve) => {
      this.workerBlobUrl = createWorkerBlob();
      let readyCount = 0;

      for (let i = 0; i < this.maxWorkers; i++) {
        const worker = new Worker(this.workerBlobUrl);

        worker.onmessage = (e) => {
          if (e.data.type === 'ready') {
            readyCount++;
            this.availableWorkers.push(worker);
            if (readyCount === this.maxWorkers) {
              this.initialized = true;
              resolve();
            }
          } else {
            this.handleWorkerMessage(worker, e);
          }
        };

        worker.onerror = (e) => console.error('Worker error:', e);
        this.workers.push(worker);
      }
    });

    return this.initPromise;
  }

  private handleWorkerMessage(worker: Worker, e: MessageEvent): void {
    const { id, type, payload } = e.data;
    const task = this.activeTasks.get(id);
    if (!task) return;

    switch (type) {
      case 'result':
        task.resolve(payload);
        this.activeTasks.delete(id);
        this.availableWorkers.push(worker);
        this.processQueue();
        break;
      case 'error':
        task.reject(new Error(payload));
        this.activeTasks.delete(id);
        this.availableWorkers.push(worker);
        this.processQueue();
        break;
      case 'progress':
        task.onProgress?.(payload);
        break;
    }
  }

  private processQueue(): void {
    while (this.taskQueue.length > 0 && this.availableWorkers.length > 0) {
      const task = this.taskQueue.shift()!;
      const worker = this.availableWorkers.pop()!;
      this.activeTasks.set(task.id, task);
      worker.postMessage({ id: task.id, type: task.type, payload: task.payload });
    }
  }

  async execute<T, R>(type: string, payload: T, onProgress?: (progress: { current: number; total: number }) => void): Promise<R> {
    await this.initialize();
    return new Promise<R>((resolve, reject) => {
      const task: WorkerTask<T, R> = {
        id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        type, payload, resolve, reject, onProgress,
      };
      this.taskQueue.push(task);
      this.processQueue();
    });
  }

  async executeAll<T, R>(type: string, payloads: T[], onProgress?: (completed: number, total: number) => void): Promise<R[]> {
    await this.initialize();
    let completed = 0;
    return Promise.all(payloads.map(payload =>
      this.execute<T, R>(type, payload).then(result => {
        completed++;
        onProgress?.(completed, payloads.length);
        return result;
      })
    ));
  }

  getStats() {
    return {
      total: this.workers.length,
      available: this.availableWorkers.length,
      busy: this.activeTasks.size,
      queued: this.taskQueue.length,
    };
  }

  terminate(): void {
    this.workers.forEach(w => w.terminate());
    if (this.workerBlobUrl) URL.revokeObjectURL(this.workerBlobUrl);
    this.workers = [];
    this.availableWorkers = [];
    this.taskQueue = [];
    this.activeTasks.clear();
    this.initialized = false;
    this.initPromise = null;
  }
}

// Singleton pool
let losWorkerPool: WorkerPool | null = null;

export function getLOSWorkerPool(): WorkerPool {
  if (!losWorkerPool) {
    losWorkerPool = new WorkerPool();
  }
  return losWorkerPool;
}

export async function calculateLOSAsync(
  pointA: { lat: number; lon: number; antennaHeight: number },
  pointB: { lat: number; lon: number; antennaHeight: number },
  options?: { frequencyMHz?: number; refractionK?: number; sampleStepMeters?: number }
): Promise<any> {
  const pool = getLOSWorkerPool();
  return pool.execute('calculateLOS', { pointA, pointB, options });
}

export async function calculateBatchLOSAsync(
  tasks: Array<{
    pointA: { lat: number; lon: number; antennaHeight: number };
    pointB: { lat: number; lon: number; antennaHeight: number };
    options?: any;
  }>,
  onProgress?: (completed: number, total: number) => void
): Promise<any[]> {
  const pool = getLOSWorkerPool();
  return pool.executeAll('calculateLOS', tasks, onProgress);
}
