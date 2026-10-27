/**
 * Grid Generator — single source of truth for the area tool's grid.
 *
 * The grid is regular in latitude/longitude, with steps equal to `resolution` metres at the
 * grid's reference latitude (WGS84 metres-per-degree). `gridLayout` describes it exactly
 * (origin, steps, row/column counts); the point generator, the bounds and the raster all
 * derive from that one layout, so every grid point lands on its own raster pixel.
 *
 * - Lazy generator yields chunks of points (O(chunkSize) memory)
 * - Integer indices prevent float accumulation drift
 */

import { haversineDistance, initialBearing, metersToDegreesLat, metersToDegreesLon, pointInPolygon, sphericalPolygonArea } from './geo';
import type { GridBounds } from './losAreaRaster';
import { boundsOf, chooseAreaZoom } from './core/terrain';

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

/** Exact description of the grid: point (iLat, iLon) is at (latMin + iLat*latStep, lonMin + iLon*lonStep). */
export interface GridLayout {
  latMin: number;
  lonMin: number;
  latStep: number;
  lonStep: number;
  nLat: number;
  nLon: number;
}

const isPolygon = (config: GridConfig) => config.mode === 'polygon' && !!config.polygonPoints && config.polygonPoints.length >= 3;

export function gridLayout(config: GridConfig): GridLayout {
  const { origin, resolution } = config;
  if (isPolygon(config)) {
    const b = boundsOf(config.polygonPoints!);
    const refLat = (b.south + b.north) / 2;
    const latStep = metersToDegreesLat(resolution, refLat);
    const lonStep = metersToDegreesLon(resolution, refLat);
    return {
      latMin: b.south, lonMin: b.west, latStep, lonStep,
      nLat: Math.floor((b.north - b.south) / latStep + 1e-9) + 1,
      nLon: Math.floor((b.east - b.west) / lonStep + 1e-9) + 1,
    };
  }
  // Sector: centred on the observer, so the observer is itself a grid node.
  const latStep = metersToDegreesLat(resolution, origin.lat);
  const lonStep = metersToDegreesLon(resolution, origin.lat);
  const m = Math.max(0, Math.ceil(config.maxDistance / resolution));
  return {
    latMin: origin.lat - m * latStep, lonMin: origin.lon - m * lonStep, latStep, lonStep,
    nLat: 2 * m + 1, nLon: 2 * m + 1,
  };
}

/** Raster edges of the grid: half a step outside the outermost grid nodes. */
export function layoutBounds(l: GridLayout): GridBounds {
  return {
    west: l.lonMin - l.lonStep / 2,
    south: l.latMin - l.latStep / 2,
    east: l.lonMin + (l.nLon - 0.5) * l.lonStep,
    north: l.latMin + (l.nLat - 0.5) * l.latStep,
  };
}

function sectorFilter(config: GridConfig) {
  const { origin, minDistance, maxDistance, minAzimuth, maxAzimuth } = config;
  const normMinAz = ((minAzimuth % 360) + 360) % 360;
  const normMaxAz = ((maxAzimuth % 360) + 360) % 360;
  const azRange = normMinAz <= normMaxAz ? normMaxAz - normMinAz : (360 - normMinAz) + normMaxAz;
  const fullCircle = azRange === 0 || azRange >= 360 || Math.abs(maxAzimuth - minAzimuth) >= 360;
  return (lat: number, lon: number) => {
    const dist = haversineDistance(origin.lat, origin.lon, lat, lon);
    if (dist < minDistance || dist > maxDistance) return false;
    if (fullCircle) return true;
    const b = ((initialBearing(origin.lat, origin.lon, lat, lon) % 360) + 360) % 360;
    return normMinAz <= normMaxAz ? b >= normMinAz && b <= normMaxAz : b >= normMinAz || b <= normMaxAz;
  };
}

/**
 * Lazy generator — yields chunks of chunkSize points, row by row from the south.
 */
export function* generatePointChunks(
  config: GridConfig,
  chunkSize: number,
): Generator<Array<{ lat: number; lon: number }>> {
  const l = gridLayout(config);
  const keep = isPolygon(config)
    ? (lat: number, lon: number) => pointInPolygon(lat, lon, config.polygonPoints!)
    : sectorFilter(config);

  let chunk: Array<{ lat: number; lon: number }> = [];
  for (let iLat = 0; iLat < l.nLat; iLat++) {
    const lat = l.latMin + iLat * l.latStep;
    for (let iLon = 0; iLon < l.nLon; iLon++) {
      const lon = l.lonMin + iLon * l.lonStep;
      if (!keep(lat, lon)) continue;
      chunk.push({ lat, lon });
      if (chunk.length >= chunkSize) {
        yield chunk;
        chunk = [];
      }
    }
  }
  if (chunk.length > 0) yield chunk;
}

/** Raster bounds of the grid (exactly aligned with the grid nodes). */
export function computeBounds(config: GridConfig): GridBounds {
  return layoutBounds(gridLayout(config));
}

/**
 * Estimate total points mathematically (without generating them).
 */
export function estimateTotalPoints(config: GridConfig): number {
  const cellArea = config.resolution * config.resolution;
  if (isPolygon(config)) {
    return Math.ceil(sphericalPolygonArea(config.polygonPoints!) / cellArea);
  }
  const { minDistance, maxDistance, minAzimuth, maxAzimuth } = config;
  const normMinAz = ((minAzimuth % 360) + 360) % 360;
  const normMaxAz = ((maxAzimuth % 360) + 360) % 360;
  const azRange = normMinAz <= normMaxAz ? normMaxAz - normMinAz : (360 - normMinAz) + normMaxAz;
  const fullCircle = azRange === 0 || azRange >= 360 || Math.abs(maxAzimuth - minAzimuth) >= 360;
  const sectorFraction = fullCircle ? 1 : azRange / 360;
  const areaSquareMeters = Math.PI * (maxDistance * maxDistance - minDistance * minDistance) * sectorFraction;
  return Math.ceil(areaSquareMeters / cellArea);
}

/** Everything the rays touch: the grid and the observer (the observer may be outside a polygon). */
export function terrainBounds(config: GridConfig): GridBounds {
  const g = computeBounds(config);
  return boundsOf([{ lat: g.south, lon: g.west }, { lat: g.north, lon: g.east }, config.origin]);
}

/**
 * DEM zoom for the area: the finest zoom whose tiles over everything the rays touch fit the
 * memory budget (zoom 12 up to a radius of ~80 km).
 */
export function computeZoom(config: GridConfig): number {
  return chooseAreaZoom(terrainBounds(config));
}
