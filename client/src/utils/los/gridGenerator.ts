/**
 * Grid Generator — shared source of truth for point generation.
 * Used by both LOSAreaPanel and MassiveCalculationEngine.
 *
 * - Lazy generator yields chunks of points (O(chunkSize) memory)
 * - Integer indices prevent float accumulation drift
 * - computeBounds provides tight bounds without scanning all points
 * - estimateTotalPoints provides mathematical count estimation
 */

import { haversineDistance, initialBearing, metersToDegreesLat, metersToDegreesLon, pointInPolygon, sphericalPolygonArea } from './geo';
import type { GridBounds } from './losAreaRaster';

export interface GridConfig {
  mode: 'sector' | 'polygon';
  origin: { lat: number; lon: number; height: number };
  targetHeight: number;
  minDistance: number;
  maxDistance: number;
  minAzimuth: number;
  maxAzimuth: number;
  resolution: number;
  polygonPoints?: Array<{ lat: number; lon: number }>;
  /** RF frequency in MHz (undefined = optical mode) */
  frequencyMHz?: number;
}

/**
 * Lazy generator — yields chunks of chunkSize points.
 * Uses integer indices (i * step instead of accumulating) for determinism.
 * Same logic as LOSAreaPanel lines 243-302 (Cartesian grid with filtering).
 */
export function* generatePointChunks(
  config: GridConfig,
  chunkSize: number,
): Generator<Array<{ lat: number; lon: number }>> {
  const { origin, resolution } = config;
  const latStep = metersToDegreesLat(resolution);
  const lonStep = metersToDegreesLon(resolution, origin.lat);

  let chunk: Array<{ lat: number; lon: number }> = [];

  if (config.mode === 'polygon' && config.polygonPoints && config.polygonPoints.length >= 3) {
    // Polygon mode: rectangular grid filtered by polygon containment
    const polyPts = config.polygonPoints;
    let minLat = Infinity, maxLat = -Infinity, minLon = Infinity, maxLon = -Infinity;
    for (const p of polyPts) {
      if (p.lat < minLat) minLat = p.lat;
      if (p.lat > maxLat) maxLat = p.lat;
      if (p.lon < minLon) minLon = p.lon;
      if (p.lon > maxLon) maxLon = p.lon;
    }

    // Integer indices to prevent float drift
    const nLatSteps = Math.ceil((maxLat - minLat) / latStep) + 1;
    const nLonSteps = Math.ceil((maxLon - minLon) / lonStep) + 1;

    for (let iLat = 0; iLat < nLatSteps; iLat++) {
      const pLat = minLat + iLat * latStep;
      for (let iLon = 0; iLon < nLonSteps; iLon++) {
        const pLon = minLon + iLon * lonStep;
        if (!pointInPolygon(pLat, pLon, polyPts)) continue;

        chunk.push({ lat: pLat, lon: pLon });
        if (chunk.length >= chunkSize) {
          yield chunk;
          chunk = [];
        }
      }
    }
  } else {
    // Sector mode: rectangular grid filtered by distance and azimuth
    const { minDistance, maxDistance, minAzimuth, maxAzimuth } = config;

    const latMin = origin.lat - metersToDegreesLat(maxDistance);
    const latMax = origin.lat + metersToDegreesLat(maxDistance);
    const lonMin = origin.lon - metersToDegreesLon(maxDistance, origin.lat);
    const lonMax = origin.lon + metersToDegreesLon(maxDistance, origin.lat);

    const normMinAz = ((minAzimuth % 360) + 360) % 360;
    const normMaxAz = ((maxAzimuth % 360) + 360) % 360;
    const azRange = normMinAz <= normMaxAz ? normMaxAz - normMinAz : (360 - normMinAz) + normMaxAz;
    const fullCircle = azRange === 0 || azRange >= 360;

    // Integer indices to prevent float drift
    const nLatSteps = Math.ceil((latMax - latMin) / latStep) + 1;
    const nLonSteps = Math.ceil((lonMax - lonMin) / lonStep) + 1;

    for (let iLat = 0; iLat < nLatSteps; iLat++) {
      const pLat = latMin + iLat * latStep;
      for (let iLon = 0; iLon < nLonSteps; iLon++) {
        const pLon = lonMin + iLon * lonStep;

        const dist = haversineDistance(origin.lat, origin.lon, pLat, pLon);
        if (dist < minDistance || dist > maxDistance) continue;

        if (!fullCircle) {
          const bearing = initialBearing(origin.lat, origin.lon, pLat, pLon);
          const normBearing = ((bearing % 360) + 360) % 360;
          let inRange: boolean;
          if (normMinAz <= normMaxAz) {
            inRange = normBearing >= normMinAz && normBearing <= normMaxAz;
          } else {
            inRange = normBearing >= normMinAz || normBearing <= normMaxAz;
          }
          if (!inRange) continue;
        }

        chunk.push({ lat: pLat, lon: pLon });
        if (chunk.length >= chunkSize) {
          yield chunk;
          chunk = [];
        }
      }
    }
  }

  // Yield remaining points
  if (chunk.length > 0) {
    yield chunk;
  }
}

/**
 * Compute tight geographic bounds for the grid.
 * O(1) for sector (samples cardinal directions + azimuth endpoints).
 * O(n) for polygon (n = number of polygon vertices).
 */
export function computeBounds(config: GridConfig): GridBounds {
  const { origin, resolution } = config;
  const halfLat = metersToDegreesLat(resolution) / 2;
  const halfLon = metersToDegreesLon(resolution, origin.lat) / 2;

  if (config.mode === 'polygon' && config.polygonPoints && config.polygonPoints.length >= 3) {
    let minLat = Infinity, maxLat = -Infinity, minLon = Infinity, maxLon = -Infinity;
    for (const p of config.polygonPoints) {
      if (p.lat < minLat) minLat = p.lat;
      if (p.lat > maxLat) maxLat = p.lat;
      if (p.lon < minLon) minLon = p.lon;
      if (p.lon > maxLon) maxLon = p.lon;
    }
    return {
      west: minLon - halfLon,
      south: minLat - halfLat,
      east: maxLon + halfLon,
      north: maxLat + halfLat,
    };
  }

  // Sector mode: bounding box based on maxDistance
  const { maxDistance } = config;
  const latExtent = metersToDegreesLat(maxDistance);
  const lonExtent = metersToDegreesLon(maxDistance, origin.lat);

  return {
    west: origin.lon - lonExtent - halfLon,
    south: origin.lat - latExtent - halfLat,
    east: origin.lon + lonExtent + halfLon,
    north: origin.lat + latExtent + halfLat,
  };
}

/**
 * Estimate total points mathematically (without generating them).
 * Same formula as LOSAreaPanel's estimatedPointCount useMemo.
 */
export function estimateTotalPoints(config: GridConfig): number {
  const cellArea = config.resolution * config.resolution;

  if (config.mode === 'polygon' && config.polygonPoints && config.polygonPoints.length >= 3) {
    const area = sphericalPolygonArea(config.polygonPoints);
    return Math.ceil(area / cellArea);
  }

  const { minDistance, maxDistance, minAzimuth, maxAzimuth } = config;
  const normMinAz = ((minAzimuth % 360) + 360) % 360;
  const normMaxAz = ((maxAzimuth % 360) + 360) % 360;
  const azRange = normMinAz <= normMaxAz ? normMaxAz - normMinAz : (360 - normMinAz) + normMaxAz;
  const fullCircle = azRange === 0 || azRange >= 360;
  const sectorFraction = fullCircle ? 1 : azRange / 360;
  const areaSquareMeters = Math.PI * (maxDistance * maxDistance - minDistance * minDistance) * sectorFraction;
  return Math.ceil(areaSquareMeters / cellArea);
}

/**
 * Compute zoom level based on max distance (same as current LOSAreaPanel logic).
 */
export function computeZoom(config: GridConfig): number {
  const maxD = config.mode === 'polygon' && config.polygonPoints && config.polygonPoints.length >= 3
    ? (() => {
        let minLat = Infinity, maxLat = -Infinity, minLon = Infinity, maxLon = -Infinity;
        for (const p of config.polygonPoints) {
          if (p.lat < minLat) minLat = p.lat;
          if (p.lat > maxLat) maxLat = p.lat;
          if (p.lon < minLon) minLon = p.lon;
          if (p.lon > maxLon) maxLon = p.lon;
        }
        return haversineDistance(minLat, minLon, maxLat, maxLon);
      })()
    : config.maxDistance;

  return maxD > 100000 ? 10 : maxD > 50000 ? 11 : maxD > 10000 ? 12 : 13;
}
