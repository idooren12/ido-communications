/**
 * Custom DSM Upload System
 * Allows uploading local elevation data to override the default terrain
 * Supports: GeoTIFF, ASC (ESRI ASCII Grid), RES, IMG, HGT (SRTM)
 */

import i18n from '../../i18n/config';
import { itmToWgs84, wgs84ToItm } from './core/itm';

// Types
export interface DSMBounds {
  west: number;
  south: number;
  east: number;
  north: number;
}

export interface CustomDSMLayer {
  id: string;
  name: string;
  bounds: DSMBounds;
  resolution: number; // meters per pixel
  width: number;
  height: number;
  data: Float32Array;
  noDataValue: number;
  minElevation: number;
  maxElevation: number;
  createdAt: Date;
  isITM?: boolean; // Flag if original data is in ITM
  originalBounds?: DSMBounds; // Original ITM bounds for sampling
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
 * Check if a point is within any custom DSM layer
 */
export function getCustomElevation(lat: number, lon: number): number | null {
  for (const layer of customLayers.values()) {
    if (isPointInBounds(lat, lon, layer.bounds)) {
      const elev = sampleFromLayer(layer, lat, lon);
      if (elev !== null && elev !== layer.noDataValue) {
        return elev;
      }
    }
  }
  return null;
}

function isPointInBounds(lat: number, lon: number, bounds: DSMBounds): boolean {
  return lat >= bounds.south && lat <= bounds.north &&
         lon >= bounds.west && lon <= bounds.east;
}

function sampleFromLayer(layer: CustomDSMLayer, lat: number, lon: number): number | null {
  const { bounds, width, height, data, noDataValue, isITM, originalBounds } = layer;

  let x: number, y: number;

  if (isITM && originalBounds) {
    // Convert WGS84 lat/lon to ITM east/north
    const itm = wgs84ToItm(lat, lon);

    // Calculate pixel coordinates using original ITM bounds
    const xRatio = (itm.east - originalBounds.west) / (originalBounds.east - originalBounds.west);
    const yRatio = (originalBounds.north - itm.north) / (originalBounds.north - originalBounds.south);

    x = Math.floor(xRatio * width);
    y = Math.floor(yRatio * height);

  } else {
    // Standard WGS84 coordinates
    const xRatio = (lon - bounds.west) / (bounds.east - bounds.west);
    const yRatio = (bounds.north - lat) / (bounds.north - bounds.south);

    x = Math.floor(xRatio * width);
    y = Math.floor(yRatio * height);
  }

  if (x < 0 || x >= width || y < 0 || y >= height) {
    return null;
  }

  const idx = y * width + x;
  const value = data[idx];

  return (value === noDataValue || !isFinite(value)) ? null : value;
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
        return await parseIMG(file);
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
// File Format Parsers
// ============================================================================

/**
 * Parse ESRI ASCII Grid (.asc)
 */
async function parseASCII(file: File): Promise<DSMParseResult> {
  const text = await file.text();
  const lines = text.split('\n').map(l => l.trim()).filter(l => l);

  // Parse header
  const header: Record<string, number> = {};
  let dataStartLine = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const match = line.match(/^(\w+)\s+(-?[\d.]+)/i);
    if (match) {
      header[match[1].toLowerCase()] = parseFloat(match[2]);
      dataStartLine = i + 1;
    } else {
      break;
    }
  }

  const ncols = header['ncols'];
  const nrows = header['nrows'];
  const xllcorner = header['xllcorner'] ?? header['xllcenter'];
  const yllcorner = header['yllcorner'] ?? header['yllcenter'];
  const cellsize = header['cellsize'];
  const nodata = header['nodata_value'] ?? -9999;

  if (!ncols || !nrows || xllcorner === undefined || yllcorner === undefined || !cellsize) {
    return { success: false, error: i18n.t('los.dsm.errors.ascMissingHeader') };
  }

  // Parse data
  const data = new Float32Array(ncols * nrows);
  let minElev = Infinity, maxElev = -Infinity;
  let idx = 0;

  for (let i = dataStartLine; i < lines.length && idx < data.length; i++) {
    const values = lines[i].split(/\s+/).map(parseFloat);
    for (const v of values) {
      if (idx < data.length) {
        data[idx] = v;
        if (v !== nodata) {
          minElev = Math.min(minElev, v);
          maxElev = Math.max(maxElev, v);
        }
        idx++;
      }
    }
  }

  const layer: CustomDSMLayer = {
    id: `dsm_${Date.now()}`,
    name: file.name,
    bounds: {
      west: xllcorner,
      south: yllcorner,
      east: xllcorner + ncols * cellsize,
      north: yllcorner + nrows * cellsize,
    },
    resolution: cellsize,
    width: ncols,
    height: nrows,
    data,
    noDataValue: nodata,
    minElevation: minElev,
    maxElevation: maxElev,
    createdAt: new Date(),
  };

  return { success: true, layer };
}

/**
 * Parse RES format (common in Israel)
 * RES is typically a simple binary or text grid format
 */
async function parseRES(file: File): Promise<DSMParseResult> {
  // Try text format first
  const text = await file.text();
  const firstLine = text.split('\n')[0].trim();

  // Check if it's text-based (similar to ASC)
  if (/^[a-zA-Z]/.test(firstLine)) {
    // Text format - parse like ASC
    return parseASCII(file);
  }

  // Binary format - try to parse as raw elevation data
  const buffer = await file.arrayBuffer();

  // Try to detect format from header
  const view = new DataView(buffer);

  // Common RES header structure (varies by source):
  // First 256 bytes often contain metadata
  // Look for common patterns

  let ncols = 0, nrows = 0;
  let xll = 0, yll = 0;
  let cellsize = 0;
  let dataOffset = 0;
  const nodata = -9999;

  // Try reading as header with ints at start
  try {
    // Some RES files have: ncols, nrows, xll, yll, cellsize as first values
    ncols = view.getInt32(0, true);
    nrows = view.getInt32(4, true);

    // Sanity check
    if (ncols > 0 && ncols < 100000 && nrows > 0 && nrows < 100000) {
      xll = view.getFloat64(8, true);
      yll = view.getFloat64(16, true);
      cellsize = view.getFloat64(24, true);
      dataOffset = 32;

      // Check if cellsize makes sense (between 0.0001 and 1000)
      if (cellsize <= 0 || cellsize > 1000) {
        // Try alternative header format
        cellsize = view.getFloat32(24, true);
        dataOffset = 28;
      }
    } else {
      // Try without header - assume square grid
      const totalFloats = (buffer.byteLength) / 4;
      const side = Math.sqrt(totalFloats);
      if (Number.isInteger(side)) {
        ncols = nrows = side;
        cellsize = 1; // Unknown
        dataOffset = 0;
      } else {
        return { success: false, error: i18n.t('los.dsm.errors.resUnknownFormat') };
      }
    }
  } catch {
    return { success: false, error: i18n.t('los.dsm.errors.resHeaderError') };
  }

  // Read elevation data
  const data = new Float32Array(ncols * nrows);
  let minElev = Infinity, maxElev = -Infinity;

  for (let i = 0; i < data.length; i++) {
    const byteOffset = dataOffset + i * 4;
    if (byteOffset + 4 <= buffer.byteLength) {
      const v = view.getFloat32(byteOffset, true);
      data[i] = v;
      if (v !== nodata && isFinite(v)) {
        minElev = Math.min(minElev, v);
        maxElev = Math.max(maxElev, v);
      }
    }
  }

  // If no bounds detected, prompt user or use defaults
  if (xll === 0 && yll === 0) {
    // Use Israel center as default - user should adjust
    xll = 34.5;
    yll = 31.0;
    cellsize = 0.0001; // ~10m at this latitude
  }

  const layer: CustomDSMLayer = {
    id: `dsm_${Date.now()}`,
    name: file.name,
    bounds: {
      west: xll,
      south: yll,
      east: xll + ncols * cellsize,
      north: yll + nrows * cellsize,
    },
    resolution: cellsize * 111000, // Approximate meters
    width: ncols,
    height: nrows,
    data,
    noDataValue: nodata,
    minElevation: minElev,
    maxElevation: maxElev,
    createdAt: new Date(),
  };

  return { success: true, layer };
}

/**
 * Parse SRTM HGT format
 */
async function parseHGT(file: File): Promise<DSMParseResult> {
  const buffer = await file.arrayBuffer();

  // HGT files are named like N31E034.hgt
  // Size determines resolution:
  // - 1201x1201 = 3 arc-second (SRTM3)
  // - 3601x3601 = 1 arc-second (SRTM1)

  const size = buffer.byteLength / 2; // 16-bit signed integers
  let dim: number;
  let cellsize: number;

  if (size === 1201 * 1201) {
    dim = 1201;
    cellsize = 1 / 1200; // 3 arc-second
  } else if (size === 3601 * 3601) {
    dim = 3601;
    cellsize = 1 / 3600; // 1 arc-second
  } else {
    return { success: false, error: i18n.t('los.dsm.errors.hgtInvalidSize', { size }) };
  }

  // Parse filename for coordinates
  const match = file.name.match(/([NS])(\d+)([EW])(\d+)/i);
  if (!match) {
    return { success: false, error: i18n.t('los.dsm.errors.hgtNoCoordinates') };
  }

  let lat = parseInt(match[2]);
  let lon = parseInt(match[4]);
  if (match[1].toUpperCase() === 'S') lat = -lat;
  if (match[3].toUpperCase() === 'W') lon = -lon;

  // Read data (big-endian 16-bit signed)
  const view = new DataView(buffer);
  const data = new Float32Array(dim * dim);
  let minElev = Infinity, maxElev = -Infinity;

  for (let i = 0; i < dim * dim; i++) {
    const v = view.getInt16(i * 2, false); // Big-endian
    data[i] = v === -32768 ? -9999 : v; // NoData
    if (v !== -32768) {
      minElev = Math.min(minElev, v);
      maxElev = Math.max(maxElev, v);
    }
  }

  const layer: CustomDSMLayer = {
    id: `dsm_${Date.now()}`,
    name: file.name,
    bounds: {
      west: lon,
      south: lat,
      east: lon + 1,
      north: lat + 1,
    },
    resolution: cellsize * 111000,
    width: dim,
    height: dim,
    data,
    noDataValue: -9999,
    minElevation: minElev,
    maxElevation: maxElev,
    createdAt: new Date(),
  };

  return { success: true, layer };
}

/**
 * Check if coordinates look like ITM (Israel Transverse Mercator) or ICS (Old Israeli Grid)
 * ITM: East ~100,000-300,000, North ~350,000-800,000
 * ICS: East ~100,000-270,000, North ~50,000-350,000
 */
function isITMCoordinates(west: number, south: number, east: number, north: number): boolean {
  const minVal = Math.min(west, south, east, north);
  const maxVal = Math.max(west, south, east, north);

  // Must be large numbers (not degrees)
  if (minVal > 1000 && maxVal > 50000) {
    console.log('Detected projected coordinates (ITM or ICS) based on magnitude');
    return true;
  }

  return false;
}

/**
 * Determine if coordinates are ICS (Old Israeli Grid) or ITM (New Israeli Grid)
 * ICS North values are typically < 400,000
 * ITM North values are typically > 500,000
 */
function isOldIsraeliGrid(north: number): boolean {
  return north < 400000;
}

/**
 * Convert ICS (Israel Cassini Soldner / Old Israeli Grid) to WGS84
 * EPSG:28193 -> EPSG:4326
 */
function icsToWgs84(easting: number, northing: number): { lat: number; lon: number } {
  // First convert ICS to ITM, then ITM to WGS84
  // ICS to ITM transformation (approximate)
  const itmEasting = easting + 50000;  // Approximate shift
  const itmNorthing = northing + 500000; // Approximate shift

  return itmToWgs84(itmEasting, itmNorthing);
}

/**
 * Parse GeoTIFF using geotiff.js library
 */
async function parseGeoTIFF(file: File): Promise<DSMParseResult> {
  try {
    // Dynamic import of geotiff library
    const GeoTIFF = await import('geotiff');

    const arrayBuffer = await file.arrayBuffer();
    const tiff = await GeoTIFF.fromArrayBuffer(arrayBuffer);
    const image = await tiff.getImage();

    const width = image.getWidth();
    const height = image.getHeight();
    const [raster] = (await image.readRasters()) as unknown as ArrayLike<number>[];

    // Get geospatial info
    const bbox = image.getBoundingBox(); // [west, south, east, north]
    console.log('Original GeoTIFF bbox:', bbox);

    let bounds: DSMBounds;
    let resolution: number;

    // Check if coordinates are in ITM (Israel Transverse Mercator)
    let isITM = false;
    let originalBounds: DSMBounds | undefined;

    if (isITMCoordinates(bbox[0], bbox[1], bbox[2], bbox[3])) {
      isITM = true;
      originalBounds = {
        west: bbox[0],
        south: bbox[1],
        east: bbox[2],
        north: bbox[3],
      };

      // Detect if this is ICS (Old Israeli Grid) or ITM (New Israeli Grid)
      const isICS = isOldIsraeliGrid(bbox[1]) || isOldIsraeliGrid(bbox[3]);

      let sw, ne;
      if (isICS) {
        console.log('Detected ICS (Old Israeli Grid) coordinates, converting to WGS84...');
        sw = icsToWgs84(bbox[0], bbox[1]);
        ne = icsToWgs84(bbox[2], bbox[3]);
      } else {
        console.log('Detected ITM coordinates, converting to WGS84...');
        sw = itmToWgs84(bbox[0], bbox[1]);
        ne = itmToWgs84(bbox[2], bbox[3]);
      }

      console.log('SW corner:', bbox[0], bbox[1], '-> (WGS84):', sw);
      console.log('NE corner:', bbox[2], bbox[3], '-> (WGS84):', ne);

      bounds = {
        west: sw.lon,
        south: sw.lat,
        east: ne.lon,
        north: ne.lat,
      };
      // Resolution in ITM is in meters directly
      resolution = (bbox[2] - bbox[0]) / width;
    } else {
      bounds = {
        west: bbox[0],
        south: bbox[1],
        east: bbox[2],
        north: bbox[3],
      };
      // Calculate resolution in meters (approximate)
      const lonSpan = bbox[2] - bbox[0];
      const avgLat = (bbox[1] + bbox[3]) / 2;
      const metersPerDegreeLon = 111320 * Math.cos(avgLat * Math.PI / 180);
      resolution = (lonSpan / width) * metersPerDegreeLon;
    }

    console.log('DSM bounds (WGS84):', bounds);
    console.log('DSM resolution:', resolution, 'm/pixel');

    // Get noData value - try async method first, then sync, then default
    let noData = -9999;
    try {
      const gdalNoData = image.getGDALNoData();
      if (gdalNoData !== null && Number.isFinite(gdalNoData)) {
        noData = gdalNoData;
      }
    } catch {
      // Keep the default noData value
    }

    // Convert to Float32Array
    const data = new Float32Array(raster.length);
    let minElev = Infinity, maxElev = -Infinity;

    for (let i = 0; i < raster.length; i++) {
      const v = raster[i] as number;
      data[i] = v;
      if (v !== noData && isFinite(v) && v > -1000 && v < 10000) {
        minElev = Math.min(minElev, v);
        maxElev = Math.max(maxElev, v);
      }
    }

    const layer: CustomDSMLayer = {
      id: `dsm_${Date.now()}`,
      name: file.name,
      bounds,
      resolution,
      width,
      height,
      data,
      noDataValue: noData,
      minElevation: minElev === Infinity ? 0 : minElev,
      maxElevation: maxElev === -Infinity ? 100 : maxElev,
      createdAt: new Date(),
      isITM,
      originalBounds,
    };

    return { success: true, layer };
  } catch (e) {
    console.error('GeoTIFF parse error:', e);
    return {
      success: false,
      error: i18n.t('los.dsm.errors.geotiffError', { message: (e as Error).message })
    };
  }
}

/**
 * Parse Erdas Imagine IMG format (basic)
 */
async function parseIMG(_file: File): Promise<DSMParseResult> {
  // IMG format is complex - recommend conversion
  return {
    success: false,
    error: i18n.t('los.dsm.errors.imgUnsupported')
  };
}

