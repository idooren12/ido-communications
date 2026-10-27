/**
 * Custom DSM Upload System
 * Uploaded elevation rasters override the default terrain in every LOS calculation.
 * Supports: GeoTIFF, ASC (ESRI ASCII Grid), RES (binary/text grid with a georeferenced header), HGT (SRTM).
 *
 * Coordinate systems: WGS84 geographic, ITM (EPSG:2039), the old Israeli grid ICS (EPSG:28193,
 * with or without the leading 1,000,000 of the northing) and WGS84 / UTM north zones. All
 * transformations include the datum shift (see core/projections.ts).
 * - GeoTIFF: the CRS comes from the file's GeoKeys; only when there are none is it guessed
 *   from the coordinate ranges. An unknown CRS is refused rather than placed somewhere wrong.
 * - ASC / RES: no CRS in the file, so it is guessed from the ranges.
 */

import i18n from '../../i18n/config';
import { crsFromEpsg, guessProjectedCrs, toWgs84, type CrsCode } from './core/projections';
import { sampleDemLayer, type DemLayer } from './core/terrain';

// Types
export interface DSMBounds {
  west: number;
  south: number;
  east: number;
  north: number;
}

export interface CustomDSMLayer extends DemLayer {
  id: string;
  name: string;
  /** WGS84 box containing the whole raster. */
  bounds: DSMBounds;
  resolution: number; // metres per pixel
  width: number;
  height: number;
  data: Float32Array;
  noDataValue: number;
  minElevation: number;
  maxElevation: number;
  createdAt: Date;
}

export interface DSMParseResult {
  success: boolean;
  layer?: CustomDSMLayer;
  error?: string;
}

// Storage for custom DSM layers
const customLayers: Map<string, CustomDSMLayer> = new Map();

// Event listeners for layer changes
type LayerChangeCallback = (layers: CustomDSMLayer[]) => void;
const changeListeners: Set<LayerChangeCallback> = new Set();

/**
 * Subscribe to layer changes
 */
export function onLayersChange(callback: LayerChangeCallback): () => void {
  changeListeners.add(callback);
  return () => changeListeners.delete(callback);
}

function notifyChange() {
  const layers = Array.from(customLayers.values());
  changeListeners.forEach(cb => cb(layers));
}

/**
 * Get all custom layers
 */
export function getCustomLayers(): CustomDSMLayer[] {
  return Array.from(customLayers.values());
}

/**
 * Get layer by ID
 */
export function getCustomLayer(id: string): CustomDSMLayer | undefined {
  return customLayers.get(id);
}

/**
 * Remove a custom layer
 */
export function removeCustomLayer(id: string): boolean {
  const result = customLayers.delete(id);
  if (result) notifyChange();
  return result;
}

/**
 * Clear all custom layers
 */
export function clearCustomLayers(): void {
  customLayers.clear();
  notifyChange();
}

/**
 * Elevation from the custom layers at a point (bilinear, same lookup as the LOS model), or null.
 */
export function getCustomElevation(lat: number, lon: number): number | null {
  for (const layer of customLayers.values()) {
    const elev = sampleDemLayer(layer, lon, lat);
    if (elev !== null) return elev;
  }
  return null;
}

/**
 * Parse uploaded file and create DSM layer
 */
export async function parseUploadedDSM(file: File): Promise<DSMParseResult> {
  const ext = file.name.split('.').pop()?.toLowerCase();

  try {
    switch (ext) {
      case 'tif':
      case 'tiff':
        return await parseGeoTIFF(file);
      case 'asc':
        return await parseASCII(file);
      case 'res':
        return await parseRES(file);
      case 'hgt':
        return await parseHGT(file);
      case 'img':
        return parseIMG();
      default:
        return { success: false, error: i18n.t('los.dsm.errors.unsupportedFormat', { ext }) };
    }
  } catch (e) {
    console.error('DSM parse error:', e);
    return { success: false, error: i18n.t('los.dsm.errors.readError', { message: (e as Error).message }) };
  }
}

/**
 * Add parsed layer to storage
 */
export function addCustomLayer(layer: CustomDSMLayer): void {
  customLayers.set(layer.id, layer);
  notifyChange();
}

// ============================================================================
// Georeferencing
// ============================================================================

const looksGeographic = (w: number, s: number, e: number, n: number) =>
  Math.abs(w) <= 180 && Math.abs(e) <= 180 && Math.abs(s) <= 90 && Math.abs(n) <= 90;

/** CRS of a raster from its edge coordinates when the file does not say. */
export function detectCrs(edges: DSMBounds): { crs: CrsCode; northOffset: number } | null {
  if (looksGeographic(edges.west, edges.south, edges.east, edges.north)) return { crs: 'EPSG:4326', northOffset: 0 };
  return guessProjectedCrs(edges.west, edges.south, edges.east, edges.north);
}

/** WGS84 box containing a raster whose edges are given in `crs` (boundary sampled, not just corners). */
export function wgs84BoundsOf(crs: CrsCode, edges: DSMBounds, northOffset = 0): DSMBounds {
  if (crs === 'EPSG:4326') return { ...edges };
  let west = Infinity, south = Infinity, east = -Infinity, north = -Infinity;
  const N = 8;
  for (let i = 0; i <= N; i++) {
    for (const [fx, fy] of [[i / N, 0], [i / N, 1], [0, i / N], [1, i / N]]) {
      const x = edges.west + (edges.east - edges.west) * fx;
      const y = edges.south + (edges.north - edges.south) * fy + northOffset;
      const g = toWgs84(crs, x, y);
      west = Math.min(west, g.lon); east = Math.max(east, g.lon);
      south = Math.min(south, g.lat); north = Math.max(north, g.lat);
    }
  }
  return { west, south, east, north };
}

/** Build a layer from raster data and its edges in `crs`. */
export function makeLayer(args: {
  name: string;
  width: number;
  height: number;
  data: Float32Array;
  noDataValue: number;
  crs: CrsCode;
  edges: DSMBounds;
  northOffset?: number;
}): CustomDSMLayer {
  const { name, width, height, data, noDataValue, crs, edges } = args;
  const northOffset = args.northOffset ?? 0;
  const bounds = wgs84BoundsOf(crs, edges, northOffset);
  const midLat = (bounds.north + bounds.south) / 2;
  const resolution = crs === 'EPSG:4326'
    ? ((edges.east - edges.west) / width) * 111320 * Math.cos((midLat * Math.PI) / 180)
    : (edges.east - edges.west) / width;

  let minElev = Infinity, maxElev = -Infinity;
  for (let i = 0; i < data.length; i++) {
    const v = data[i];
    if (v !== noDataValue && Number.isFinite(v) && v > -1000 && v < 10000) {
      if (v < minElev) minElev = v;
      if (v > maxElev) maxElev = v;
    }
  }

  return {
    id: `dsm_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    name,
    bounds,
    resolution: Math.round(resolution * 100) / 100,
    width,
    height,
    data,
    noDataValue,
    minElevation: minElev === Infinity ? 0 : minElev,
    maxElevation: maxElev === -Infinity ? 0 : maxElev,
    createdAt: new Date(),
    crs: crs === 'EPSG:4326' ? undefined : crs,
    projBounds: crs === 'EPSG:4326' ? undefined : { ...edges },
    northOffset: northOffset || undefined,
  };
}

// ============================================================================
// File Format Parsers
// ============================================================================

/**
 * Parse ESRI ASCII Grid (.asc)
 */
export async function parseASCII(file: File | { name: string; text(): Promise<string> }): Promise<DSMParseResult> {
  const text = await file.text();
  return parseASCIIText(file.name, text);
}

export function parseASCIIText(name: string, text: string): DSMParseResult {
  const lines = text.split(/\r?\n/).map(l => l.trim()).filter(l => l);

  const header: Record<string, number> = {};
  let dataStartLine = 0;
  for (let i = 0; i < lines.length; i++) {
    const match = lines[i].match(/^([a-zA-Z_]+)\s+(-?[\d.eE+-]+)$/);
    if (!match) break;
    header[match[1].toLowerCase()] = parseFloat(match[2]);
    dataStartLine = i + 1;
  }

  const ncols = header['ncols'];
  const nrows = header['nrows'];
  const cellsize = header['cellsize'];
  const nodata = header['nodata_value'] ?? -9999;
  // xllcenter / yllcenter refer to the centre of the lower-left cell, not its corner.
  const xll = header['xllcorner'] ?? (header['xllcenter'] !== undefined ? header['xllcenter'] - cellsize / 2 : undefined);
  const yll = header['yllcorner'] ?? (header['yllcenter'] !== undefined ? header['yllcenter'] - cellsize / 2 : undefined);

  if (!ncols || !nrows || xll === undefined || yll === undefined || !cellsize || Number.isNaN(xll) || Number.isNaN(yll)) {
    return { success: false, error: i18n.t('los.dsm.errors.ascMissingHeader') };
  }

  const data = new Float32Array(ncols * nrows).fill(nodata);
  let idx = 0;
  for (let i = dataStartLine; i < lines.length && idx < data.length; i++) {
    for (const tok of lines[i].split(/\s+/)) {
      if (idx >= data.length) break;
      const v = parseFloat(tok);
      data[idx++] = Number.isFinite(v) ? v : nodata;
    }
  }

  const edges = { west: xll, south: yll, east: xll + ncols * cellsize, north: yll + nrows * cellsize };
  const detected = detectCrs(edges);
  if (!detected) return { success: false, error: i18n.t('los.dsm.errors.unknownCrs') };
  return { success: true, layer: makeLayer({ name, width: ncols, height: nrows, data, noDataValue: nodata, crs: detected.crs, edges, northOffset: detected.northOffset }) };
}

/**
 * Parse RES format. Text RES files are read like ASC; binary ones need a header with
 * ncols, nrows (int32), xll, yll, cellsize (float64). Files without georeferencing are refused
 * (they used to be placed silently at 34.5E 31.0N).
 */
async function parseRES(file: File): Promise<DSMParseResult> {
  const text = await file.text();
  const firstLine = text.split('\n')[0].trim();
  if (/^[a-zA-Z]/.test(firstLine)) return parseASCIIText(file.name, text);

  const buffer = await file.arrayBuffer();
  const view = new DataView(buffer);
  if (buffer.byteLength < 40) return { success: false, error: i18n.t('los.dsm.errors.resUnknownFormat') };

  const ncols = view.getInt32(0, true);
  const nrows = view.getInt32(4, true);
  if (!(ncols > 0 && ncols < 100000 && nrows > 0 && nrows < 100000)) {
    return { success: false, error: i18n.t('los.dsm.errors.resNoGeoref') };
  }
  const xll = view.getFloat64(8, true);
  const yll = view.getFloat64(16, true);
  let cellsize = view.getFloat64(24, true);
  let dataOffset = 32;
  if (!(cellsize > 0 && cellsize <= 1000)) {
    cellsize = view.getFloat32(24, true);
    dataOffset = 28;
  }
  if (!(cellsize > 0 && cellsize <= 1000) || !Number.isFinite(xll) || !Number.isFinite(yll) || (xll === 0 && yll === 0)) {
    return { success: false, error: i18n.t('los.dsm.errors.resNoGeoref') };
  }
  if (dataOffset + ncols * nrows * 4 > buffer.byteLength) {
    return { success: false, error: i18n.t('los.dsm.errors.resUnknownFormat') };
  }

  const nodata = -9999;
  const data = new Float32Array(ncols * nrows);
  for (let i = 0; i < data.length; i++) data[i] = view.getFloat32(dataOffset + i * 4, true);

  const edges = { west: xll, south: yll, east: xll + ncols * cellsize, north: yll + nrows * cellsize };
  const detected = detectCrs(edges);
  if (!detected) return { success: false, error: i18n.t('los.dsm.errors.unknownCrs') };
  return { success: true, layer: makeLayer({ name: file.name, width: ncols, height: nrows, data, noDataValue: nodata, crs: detected.crs, edges, northOffset: detected.northOffset }) };
}

/**
 * Parse SRTM HGT format.
 * 1201x1201 (3") or 3601x3601 (1") big-endian int16 samples; the samples sit on whole
 * arc-second positions including both edges, so the pixel edges extend half a cell beyond
 * the integer-degree tile.
 */
async function parseHGT(file: File): Promise<DSMParseResult> {
  const buffer = await file.arrayBuffer();
  const size = buffer.byteLength / 2;
  let dim: number;
  if (size === 1201 * 1201) dim = 1201;
  else if (size === 3601 * 3601) dim = 3601;
  else return { success: false, error: i18n.t('los.dsm.errors.hgtInvalidSize', { size }) };
  const cellsize = 1 / (dim - 1);

  const match = file.name.match(/([NS])(\d+)([EW])(\d+)/i);
  if (!match) return { success: false, error: i18n.t('los.dsm.errors.hgtNoCoordinates') };
  let lat = parseInt(match[2]);
  let lon = parseInt(match[4]);
  if (match[1].toUpperCase() === 'S') lat = -lat;
  if (match[3].toUpperCase() === 'W') lon = -lon;

  const view = new DataView(buffer);
  const data = new Float32Array(dim * dim);
  for (let i = 0; i < dim * dim; i++) {
    const v = view.getInt16(i * 2, false);
    data[i] = v === -32768 ? -9999 : v;
  }

  const half = cellsize / 2;
  const edges = { west: lon - half, south: lat - half, east: lon + 1 + half, north: lat + 1 + half };
  return { success: true, layer: makeLayer({ name: file.name, width: dim, height: dim, data, noDataValue: -9999, crs: 'EPSG:4326', edges }) };
}

// GeoKey values
const RASTER_PIXEL_IS_POINT = 2;
const USER_DEFINED = 32767;

/**
 * Parse GeoTIFF using geotiff.js
 */
async function parseGeoTIFF(file: File): Promise<DSMParseResult> {
  try {
    const GeoTIFF = await import('geotiff');
    const tiff = await GeoTIFF.fromArrayBuffer(await file.arrayBuffer());
    const image = await tiff.getImage();

    const width = image.getWidth();
    const height = image.getHeight();
    const [raster] = (await image.readRasters({ samples: [0] })) as unknown as ArrayLike<number>[];

    const geoKeys = (image.getGeoKeys() ?? {}) as Record<string, number | undefined>;
    const [resX, resY] = image.getResolution();
    let [west, south, east, north] = image.getBoundingBox();
    // PixelIsPoint: the tie point is a pixel centre; move the edges out by half a pixel.
    if (geoKeys.GTRasterTypeGeoKey === RASTER_PIXEL_IS_POINT) {
      const hx = Math.abs(resX) / 2, hy = Math.abs(resY) / 2;
      west -= hx; east -= hx; north += hy; south += hy;
    }
    const edges = { west, south, east, north };

    // CRS from the file; guessed from the ranges only when the file has no CRS at all.
    let crs: CrsCode | null = null;
    let northOffset = 0;
    const projected = geoKeys.ProjectedCSTypeGeoKey;
    const geographic = geoKeys.GeographicTypeGeoKey;
    if (projected && projected !== USER_DEFINED) {
      crs = crsFromEpsg(projected);
      if (!crs) return { success: false, error: i18n.t('los.dsm.errors.unsupportedCrs', { code: `EPSG:${projected}` }) };
    } else if (!projected && geographic && geographic !== USER_DEFINED) {
      crs = crsFromEpsg(geographic);
      if (!crs) return { success: false, error: i18n.t('los.dsm.errors.unsupportedCrs', { code: `EPSG:${geographic}` }) };
    } else {
      const detected = detectCrs(edges);
      if (!detected) return { success: false, error: i18n.t('los.dsm.errors.unknownCrs') };
      crs = detected.crs;
      northOffset = detected.northOffset;
    }

    // Rows run north to south; a south-up raster (positive Y resolution) is flipped.
    const data = new Float32Array(width * height);
    const southUp = resY > 0;
    for (let row = 0; row < height; row++) {
      const src = (southUp ? height - 1 - row : row) * width;
      for (let col = 0; col < width; col++) data[row * width + col] = raster[src + col] as number;
    }

    let noData = -9999;
    try {
      const gdalNoData = image.getGDALNoData();
      if (gdalNoData !== null && Number.isFinite(gdalNoData)) noData = gdalNoData;
    } catch {
      // Keep the default noData value
    }

    return { success: true, layer: makeLayer({ name: file.name, width, height, data, noDataValue: noData, crs, edges, northOffset }) };
  } catch (e) {
    console.error('GeoTIFF parse error:', e);
    return { success: false, error: i18n.t('los.dsm.errors.geotiffError', { message: (e as Error).message }) };
  }
}

/**
 * Erdas Imagine IMG: not supported (convert with QGIS/GDAL).
 */
function parseIMG(): DSMParseResult {
  return { success: false, error: i18n.t('los.dsm.errors.imgUnsupported') };
}
