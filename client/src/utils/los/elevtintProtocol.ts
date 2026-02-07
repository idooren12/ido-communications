/**
 * Elevation Tint Protocol for MapLibre
 * Creates colored elevation tiles on-demand using a LUT
 * Improved with smoother gradients and better hillshade effect
 */

import maplibregl from 'maplibre-gl';

// Protocol state
let registered = false;
let currentLUT: Uint8ClampedArray | null = null;
let lutVersion = 0;

// Improved elevation gradient - natural terrain colors
const GRADIENT_STOPS = [
  { elevation: -450, color: '#08306b' },  // Deep blue (Dead Sea)
  { elevation: -300, color: '#08519c' },
  { elevation: -150, color: '#2171b5' },
  { elevation: -50, color: '#4292c6' },
  { elevation: 0, color: '#6baed6' },     // Sea level - light blue
  { elevation: 25, color: '#1a5f3c' },    // Coast - dark green
  { elevation: 100, color: '#2d6a4f' },
  { elevation: 200, color: '#40916c' },
  { elevation: 350, color: '#52b788' },   // Hills - medium green
  { elevation: 500, color: '#74c69d' },
  { elevation: 650, color: '#95d5b2' },   // Higher hills - light green
  { elevation: 800, color: '#b7e4c7' },
  { elevation: 950, color: '#d8f3dc' },   // Transition to brown
  { elevation: 1100, color: '#ddb892' },  // Mountains - tan
  { elevation: 1300, color: '#b08968' },
  { elevation: 1500, color: '#9c6644' },  // High mountains - brown
  { elevation: 1700, color: '#7f5539' },
  { elevation: 1900, color: '#6b4423' },
  { elevation: 2100, color: '#5c3d2e' },  // Peaks
  { elevation: 2300, color: '#8b7355' },  // Rocky peaks
  { elevation: 2500, color: '#d4d4d4' },  // Snow/rock
];

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return result
    ? {
        r: parseInt(result[1], 16),
        g: parseInt(result[2], 16),
        b: parseInt(result[3], 16)
      }
    : { r: 128, g: 128, b: 128 };
}

function interpolateColor(
  c1: { r: number; g: number; b: number },
  c2: { r: number; g: number; b: number },
  t: number
): { r: number; g: number; b: number } {
  // Use smooth interpolation
  const smoothT = t * t * (3 - 2 * t); // Smoothstep
  return {
    r: Math.round(c1.r + (c2.r - c1.r) * smoothT),
    g: Math.round(c1.g + (c2.g - c1.g) * smoothT),
    b: Math.round(c1.b + (c2.b - c1.b) * smoothT),
  };
}

function getColorForElevation(
  elevation: number,
  minElev: number,
  maxElev: number
): { r: number; g: number; b: number } {
  // Map actual elevation to gradient range
  const range = maxElev - minElev;
  if (range === 0) return hexToRgb(GRADIENT_STOPS[Math.floor(GRADIENT_STOPS.length / 2)].color);

  // Direct mapping - use actual elevation for lookup
  const gradientMin = GRADIENT_STOPS[0].elevation;
  const gradientMax = GRADIENT_STOPS[GRADIENT_STOPS.length - 1].elevation;

  // Scale elevation to gradient range
  const scaledElev = gradientMin + ((elevation - minElev) / range) * (gradientMax - gradientMin);

  // Find gradient segment
  for (let i = 0; i < GRADIENT_STOPS.length - 1; i++) {
    const lower = GRADIENT_STOPS[i];
    const upper = GRADIENT_STOPS[i + 1];

    if (scaledElev >= lower.elevation && scaledElev <= upper.elevation) {
      const t = (scaledElev - lower.elevation) / (upper.elevation - lower.elevation);
      const c1 = hexToRgb(lower.color);
      const c2 = hexToRgb(upper.color);
      return interpolateColor(c1, c2, t);
    }
  }

  // Fallback for out of range
  if (scaledElev < gradientMin) return hexToRgb(GRADIENT_STOPS[0].color);
  return hexToRgb(GRADIENT_STOPS[GRADIENT_STOPS.length - 1].color);
}

/**
 * Build a Look-Up Table for fast elevation->color mapping
 */
function buildColorLUT(minElev: number, maxElev: number): Uint8ClampedArray {
  const size = 65536; // 16-bit range
  const lut = new Uint8ClampedArray(size * 4);

  for (let i = 0; i < size; i++) {
    const elevation = i - 32768; // Terrarium offset
    const color = getColorForElevation(elevation, minElev, maxElev);
    lut[i * 4] = color.r;
    lut[i * 4 + 1] = color.g;
    lut[i * 4 + 2] = color.b;
    lut[i * 4 + 3] = 255;
  }

  return lut;
}

/**
 * Update the LUT with new elevation range
 */
export function updateElevationLUT(minElev: number, maxElev: number): number {
  currentLUT = buildColorLUT(minElev, maxElev);
  lutVersion++;
  return lutVersion;
}

/**
 * Get current LUT version
 */
export function getLUTVersion(): number {
  return lutVersion;
}

/**
 * Build the tile URL with version for cache busting
 */
export function buildTintTileUrl(z: number, x: number, y: number): string {
  return `elevtint://${z}/${x}/${y}?v=${lutVersion}`;
}

/**
 * Get the tiles URL template for MapLibre source
 */
export function getTintTilesTemplate(): string {
  return `elevtint://{z}/{x}/{y}?v=${lutVersion}`;
}

interface ElevtintOptions {
  terrainUrl: string;
  minElevation?: number;
  maxElevation?: number;
  onError?: (error: Error, tile: { z: number; x: number; y: number }) => void;
  debug?: boolean;
  hillshade?: boolean; // Enable simple hillshade effect
}

/**
 * Register the elevtint protocol with MapLibre
 */
export function registerElevtintProtocol(options: ElevtintOptions): void {
  if (registered) {
    updateElevationLUT(options.minElevation ?? -450, options.maxElevation ?? 2000);
    return;
  }

  const {
    terrainUrl,
    minElevation = -450,
    maxElevation = 2000,
    onError,
    debug = false,
    hillshade = true
  } = options;

  currentLUT = buildColorLUT(minElevation, maxElevation);

  maplibregl.addProtocol('elevtint', async (params) => {
    const match = params.url.match(/elevtint:\/\/(\d+)\/(\d+)\/(\d+)/);
    if (!match) {
      if (debug) console.warn('[elevtint] Invalid URL:', params.url);
      return { data: new ArrayBuffer(0) };
    }

    const [, zStr, xStr, yStr] = match;
    const z = parseInt(zStr, 10);
    const x = parseInt(xStr, 10);
    const y = parseInt(yStr, 10);

    const maxTile = Math.pow(2, z);
    if (x < 0 || x >= maxTile || y < 0 || y >= maxTile) {
      if (debug) console.warn('[elevtint] Invalid tile coords:', { z, x, y });
      return { data: new ArrayBuffer(0) };
    }

    try {
      const tileUrl = terrainUrl
        .replace('{z}', String(z))
        .replace('{x}', String(x))
        .replace('{y}', String(y));

      const blob = await processTerrainTile(tileUrl, currentLUT!, hillshade);
      const buffer = await blob.arrayBuffer();

      if (debug) console.log('[elevtint] Processed tile:', { z, x, y, size: buffer.byteLength });

      return { data: buffer };
    } catch (error) {
      if (debug) console.error('[elevtint] Error processing tile:', { z, x, y }, error);
      onError?.(error as Error, { z, x, y });
      return { data: new ArrayBuffer(0) };
    }
  });

  registered = true;
}

/**
 * Process a terrain tile into a colored tile with optional hillshade
 */
async function processTerrainTile(
  tileUrl: string,
  lut: Uint8ClampedArray,
  applyHillshade: boolean = true
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';

    const timeout = setTimeout(() => {
      reject(new Error('Tile load timeout'));
    }, 15000);

    img.onload = () => {
      clearTimeout(timeout);

      try {
        const canvas = document.createElement('canvas');
        const size = 256;
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext('2d', { willReadFrequently: true });

        if (!ctx) {
          reject(new Error('Could not get canvas context'));
          return;
        }

        ctx.drawImage(img, 0, 0);
        const imageData = ctx.getImageData(0, 0, size, size);
        const data = imageData.data;

        // First pass: decode elevations and apply colors
        const elevations = new Float32Array(size * size);

        for (let i = 0; i < data.length; i += 4) {
          const pixelIdx = i / 4;
          const r = data[i];
          const g = data[i + 1];
          const b = data[i + 2];
          const a = data[i + 3];

          if (a === 0) {
            elevations[pixelIdx] = NaN;
            continue;
          }

          // Decode Terrarium elevation
          const elevation = (r * 256 + g + b / 256) - 32768;
          elevations[pixelIdx] = elevation;

          // Clamp to LUT range
          const lutIdx = Math.max(0, Math.min(65535, Math.round(elevation) + 32768));

          // Apply color from LUT
          data[i] = lut[lutIdx * 4];
          data[i + 1] = lut[lutIdx * 4 + 1];
          data[i + 2] = lut[lutIdx * 4 + 2];
          data[i + 3] = 255;
        }

        // Second pass: apply hillshade if enabled
        if (applyHillshade) {
          const azimuth = 315 * Math.PI / 180;  // Light from NW
          const altitude = 45 * Math.PI / 180;   // 45 degree angle
          const zFactor = 1.5; // Exaggeration

          for (let y = 1; y < size - 1; y++) {
            for (let x = 1; x < size - 1; x++) {
              const idx = y * size + x;
              const i = idx * 4;

              const e = elevations[idx];
              if (isNaN(e)) continue;

              // Get neighboring elevations
              const eN = elevations[(y - 1) * size + x] || e;
              const eS = elevations[(y + 1) * size + x] || e;
              const eE = elevations[y * size + (x + 1)] || e;
              const eW = elevations[y * size + (x - 1)] || e;

              // Calculate slope
              const dzdx = ((eE - eW) / 2) * zFactor;
              const dzdy = ((eN - eS) / 2) * zFactor;

              const slope = Math.atan(Math.sqrt(dzdx * dzdx + dzdy * dzdy));
              const aspect = Math.atan2(dzdy, -dzdx);

              // Calculate illumination
              let shade = Math.cos(altitude) * Math.cos(slope) +
                          Math.sin(altitude) * Math.sin(slope) * Math.cos(azimuth - aspect);

              // Normalize and apply
              shade = Math.max(0.3, Math.min(1.2, shade * 0.5 + 0.7));

              data[i] = Math.min(255, Math.round(data[i] * shade));
              data[i + 1] = Math.min(255, Math.round(data[i + 1] * shade));
              data[i + 2] = Math.min(255, Math.round(data[i + 2] * shade));
            }
          }
        }

        ctx.putImageData(imageData, 0, 0);

        canvas.toBlob((blob) => {
          if (blob) {
            resolve(blob);
          } else {
            reject(new Error('Could not create blob'));
          }
        }, 'image/png');
      } catch (err) {
        reject(err);
      }
    };

    img.onerror = () => {
      clearTimeout(timeout);
      reject(new Error(`Failed to load tile: ${tileUrl}`));
    };

    img.src = tileUrl;
  });
}

/**
 * Unregister the protocol
 */
export function unregisterElevtintProtocol(): void {
  if (!registered) return;

  try {
    maplibregl.removeProtocol('elevtint');
  } catch (e) {
    // Protocol might not exist
  }

  registered = false;
  currentLUT = null;
}

/**
 * Check if protocol is registered
 */
export function isElevtintRegistered(): boolean {
  return registered;
}
