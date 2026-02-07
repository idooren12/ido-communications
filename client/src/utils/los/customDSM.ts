/**
 * Custom DSM Upload System
 * Allows uploading local elevation data to override the default terrain
 * Supports: GeoTIFF, ASC (ESRI ASCII Grid), RES, IMG, HGT (SRTM)
 */

import { TERRAIN_CONFIG } from './constants';

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

    // Debug log (only occasionally to avoid spam)
    if (Math.random() < 0.01) {
      console.log(`Sample: WGS84(${lat.toFixed(5)}, ${lon.toFixed(5)}) -> ITM(${itm.east.toFixed(1)}, ${itm.north.toFixed(1)}) -> pixel(${x}, ${y}) -> elev: ${data[y * width + x]}`);
    }
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
        return { success: false, error: `\u05E1\u05D5\u05D2 \u05E7\u05D5\u05D1\u05E5 \u05DC\u05D0 \u05E0\u05EA\u05DE\u05DA: ${ext}` };
    }
  } catch (e) {
    console.error('DSM parse error:', e);
    return { success: false, error: `\u05E9\u05D2\u05D9\u05D0\u05D4 \u05D1\u05E7\u05E8\u05D9\u05D0\u05EA \u05D4\u05E7\u05D5\u05D1\u05E5: ${(e as Error).message}` };
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
    return { success: false, error: '\u05D7\u05E1\u05E8\u05D9\u05DD \u05E9\u05D3\u05D5\u05EA \u05D1\u05DB\u05D5\u05EA\u05E8\u05EA \u05E7\u05D5\u05D1\u05E5 ASC' };
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
  let nodata = -9999;

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
        return { success: false, error: '\u05DC\u05D0 \u05E0\u05D9\u05EA\u05DF \u05DC\u05D6\u05D4\u05D5\u05EA \u05E4\u05D5\u05E8\u05DE\u05D8 \u05E7\u05D5\u05D1\u05E5 RES' };
      }
    }
  } catch (e) {
    return { success: false, error: '\u05E9\u05D2\u05D9\u05D0\u05D4 \u05D1\u05E7\u05E8\u05D9\u05D0\u05EA \u05DB\u05D5\u05EA\u05E8\u05EA RES' };
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
    return { success: false, error: `\u05D2\u05D5\u05D3\u05DC \u05E7\u05D5\u05D1\u05E5 HGT \u05DC\u05D0 \u05EA\u05E7\u05D9\u05DF: ${size} values` };
  }

  // Parse filename for coordinates
  const match = file.name.match(/([NS])(\d+)([EW])(\d+)/i);
  if (!match) {
    return { success: false, error: '\u05DC\u05D0 \u05E0\u05D9\u05EA\u05DF \u05DC\u05D7\u05DC\u05E5 \u05E7\u05D5\u05D0\u05D5\u05E8\u05D3\u05D9\u05E0\u05D8\u05D5\u05EA \u05DE\u05E9\u05DD \u05D4\u05E7\u05D5\u05D1\u05E5' };
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
 * Convert WGS84 to ICS (Old Israeli Grid)
 */
function wgs84ToIcs(lat: number, lon: number): { east: number; north: number } {
  const itm = wgs84ToItm(lat, lon);
  return {
    east: itm.east - 50000,
    north: itm.north - 500000
  };
}

/**
 * Convert ITM (Israel Transverse Mercator) to WGS84
 * EPSG:2039 -> EPSG:4326
 */
function itmToWgs84(easting: number, northing: number): { lat: number; lon: number } {
  // ITM parameters (EPSG:2039)
  const E0 = 219529.584; // False easting
  const N0 = 626907.390; // False northing
  const k0 = 1.0000067;  // Scale factor
  const lat0 = 31.7343936111111; // Origin latitude in degrees
  const lon0 = 35.2045169444444; // Central meridian in degrees

  // GRS80 ellipsoid
  const a = 6378137.0;
  const f = 1 / 298.257222101;
  const e2 = 2*f - f*f;
  const ei2 = e2 / (1 - e2);
  const e1 = (1 - Math.sqrt(1 - e2)) / (1 + Math.sqrt(1 - e2));

  // Calculate M0 (meridional arc at origin latitude)
  const lat0Rad = lat0 * Math.PI / 180;
  const M0 = a * (
    (1 - e2/4 - 3*e2*e2/64 - 5*e2*e2*e2/256) * lat0Rad
    - (3*e2/8 + 3*e2*e2/32 + 45*e2*e2*e2/1024) * Math.sin(2*lat0Rad)
    + (15*e2*e2/256 + 45*e2*e2*e2/1024) * Math.sin(4*lat0Rad)
    - (35*e2*e2*e2/3072) * Math.sin(6*lat0Rad)
  );

  // Remove false origin
  const x = easting - E0;
  const y = northing - N0;

  // Footprint latitude - add M0 to account for origin latitude
  const M = M0 + y / k0;
  const mu = M / (a * (1 - e2/4 - 3*e2*e2/64 - 5*e2*e2*e2/256));

  const fp = mu
    + (3*e1/2 - 27*e1*e1*e1/32) * Math.sin(2*mu)
    + (21*e1*e1/16 - 55*e1*e1*e1*e1/32) * Math.sin(4*mu)
    + (151*e1*e1*e1/96) * Math.sin(6*mu)
    + (1097*e1*e1*e1*e1/512) * Math.sin(8*mu);

  // Calculate latitude and longitude
  const cosFp = Math.cos(fp);
  const sinFp = Math.sin(fp);
  const tanFp = Math.tan(fp);

  const N1 = a / Math.sqrt(1 - e2 * sinFp * sinFp);
  const R1 = a * (1 - e2) / Math.pow(1 - e2 * sinFp * sinFp, 1.5);
  const T1 = tanFp * tanFp;
  const C1 = ei2 * cosFp * cosFp;
  const D = x / (N1 * k0);

  const lat = fp - (N1 * tanFp / R1) * (
    D*D/2
    - (5 + 3*T1 + 10*C1 - 4*C1*C1 - 9*ei2) * Math.pow(D, 4)/24
    + (61 + 90*T1 + 298*C1 + 45*T1*T1 - 252*ei2 - 3*C1*C1) * Math.pow(D, 6)/720
  );

  const lon = (lon0 * Math.PI / 180) + (
    D
    - (1 + 2*T1 + C1) * Math.pow(D, 3)/6
    + (5 - 2*C1 + 28*T1 - 3*C1*C1 + 8*ei2 + 24*T1*T1) * Math.pow(D, 5)/120
  ) / cosFp;

  const result = {
    lat: lat * 180 / Math.PI,
    lon: lon * 180 / Math.PI
  };

  console.log(`ITM(${easting.toFixed(2)}, ${northing.toFixed(2)}) -> WGS84(${result.lat.toFixed(6)}, ${result.lon.toFixed(6)})`);

  return result;
}

/**
 * Convert WGS84 to ITM (Israel Transverse Mercator)
 * EPSG:4326 -> EPSG:2039
 */
function wgs84ToItm(lat: number, lon: number): { east: number; north: number } {
  const E0 = 219529.584;
  const N0 = 626907.390;
  const k0 = 1.0000067;
  const lat0 = 31.7343936111111; // Origin latitude in degrees
  const lon0 = 35.2045169444444; // Central meridian in degrees

  const a = 6378137.0;
  const f = 1 / 298.257222101;
  const e2 = 2 * f - f * f;
  const ei2 = e2 / (1 - e2);

  const lat0Rad = lat0 * Math.PI / 180;
  const lon0Rad = lon0 * Math.PI / 180;
  const latRad = lat * Math.PI / 180;
  const lonRad = lon * Math.PI / 180;

  const sinLat = Math.sin(latRad);
  const cosLat = Math.cos(latRad);
  const tanLat = Math.tan(latRad);

  const N = a / Math.sqrt(1 - e2 * sinLat * sinLat);
  const T = tanLat * tanLat;
  const C = ei2 * cosLat * cosLat;
  const A = (lonRad - lon0Rad) * cosLat;

  // Calculate M (meridional arc from equator to lat)
  const M = a * (
    (1 - e2/4 - 3*e2*e2/64 - 5*e2*e2*e2/256) * latRad
    - (3*e2/8 + 3*e2*e2/32 + 45*e2*e2*e2/1024) * Math.sin(2*latRad)
    + (15*e2*e2/256 + 45*e2*e2*e2/1024) * Math.sin(4*latRad)
    - (35*e2*e2*e2/3072) * Math.sin(6*latRad)
  );

  // Calculate M0 (meridional arc from equator to lat0)
  const M0 = a * (
    (1 - e2/4 - 3*e2*e2/64 - 5*e2*e2*e2/256) * lat0Rad
    - (3*e2/8 + 3*e2*e2/32 + 45*e2*e2*e2/1024) * Math.sin(2*lat0Rad)
    + (15*e2*e2/256 + 45*e2*e2*e2/1024) * Math.sin(4*lat0Rad)
    - (35*e2*e2*e2/3072) * Math.sin(6*lat0Rad)
  );

  const east = E0 + k0 * N * (
    A
    + (1 - T + C) * Math.pow(A, 3)/6
    + (5 - 18*T + T*T + 72*C - 58*ei2) * Math.pow(A, 5)/120
  );

  // Subtract M0 to get distance from origin latitude, not equator
  const north = N0 + k0 * (
    (M - M0) + N * tanLat * (
      A*A/2
      + (5 - T + 9*C + 4*C*C) * Math.pow(A, 4)/24
      + (61 - 58*T + T*T + 600*C - 330*ei2) * Math.pow(A, 6)/720
    )
  );

  return { east, north };
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
    const [raster] = await image.readRasters();

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
      // Try to get GDAL metadata
      const gdalNoData = image.getFileDirectory().GDAL_NODATA;
      if (gdalNoData !== undefined) {
        noData = parseFloat(gdalNoData);
      }
    } catch (e) {
      // If that fails, just use default
      console.log('Using default noData value');
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
      error: `\u05E9\u05D2\u05D9\u05D0\u05D4 \u05D1\u05E7\u05E8\u05D9\u05D0\u05EA GeoTIFF: ${(e as Error).message}`
    };
  }
}

/**
 * Parse Erdas Imagine IMG format (basic)
 */
async function parseIMG(file: File): Promise<DSMParseResult> {
  // IMG format is complex - recommend conversion
  return {
    success: false,
    error: '\u05E4\u05D5\u05E8\u05DE\u05D8 IMG \u05DE\u05D5\u05E8\u05DB\u05D1. \u05DE\u05D5\u05DE\u05DC\u05E5 \u05DC\u05D4\u05DE\u05D9\u05E8 \u05DC-ASC \u05D0\u05D5 GeoTIFF \u05D1\u05D0\u05DE\u05E6\u05E2\u05D5\u05EA QGIS/GDAL.'
  };
}

// ============================================================================
// Integration with elevation sampling
// ============================================================================

/**
 * Enhanced elevation sampling that checks custom layers first
 */
export async function sampleElevationWithCustom(
  lng: number,
  lat: number,
  zoom: number,
  terrainUrl: string,
  encoding: 'terrarium' | 'mapbox'
): Promise<number | null> {
  // Check custom layers first
  const customElev = getCustomElevation(lat, lng);
  if (customElev !== null) {
    return customElev;
  }

  // Fall back to terrain tiles
  // This would call the original sampleElevationAtLngLat
  return null; // Let caller handle fallback
}
