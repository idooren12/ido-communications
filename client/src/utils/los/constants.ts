/**
 * Application constants
 */

// Map defaults
export const ISRAEL_CENTER: [number, number] = [35.0, 31.5];
export const ISRAEL_DEFAULT_ZOOM = 7.5;
export const ISRAEL_BOUNDS: [[number, number], [number, number]] = [
  [34.0, 29.0], // SW
  [36.0, 34.0], // NE
];

// Elevation ranges
export const ELEVATION_RANGES = {
  // Israel/fixed range for consistent coloring
  fixed: {
    min: -450,
    max: 2000,
    label: '\u05E7\u05D1\u05D5\u05E2',
  },
  // Actual Israel elevations
  israel: {
    min: -430,  // Dead Sea
    max: 2224,  // Mount Hermon
  },
  // Global range
  global: {
    min: -11034, // Mariana Trench
    max: 8848,   // Mount Everest
  },
};

// Backwards compatibility
export const NATIONWIDE_MIN_ELEVATION = ELEVATION_RANGES.fixed.min;
export const NATIONWIDE_MAX_ELEVATION = ELEVATION_RANGES.fixed.max;

// Elevation gradient for visualization
export const ELEVATION_GRADIENT_STOPS = [
  { elevation: -450, color: '#1e3a5f' },
  { elevation: -200, color: '#1e4976' },
  { elevation: 0, color: '#2d5a7b' },
  { elevation: 100, color: '#3d8b6e' },
  { elevation: 300, color: '#7cb342' },
  { elevation: 500, color: '#9ccc65' },
  { elevation: 700, color: '#c0ca33' },
  { elevation: 900, color: '#ffb300' },
  { elevation: 1100, color: '#fb8c00' },
  { elevation: 1400, color: '#e65100' },
  { elevation: 1700, color: '#d50000' },
  { elevation: 2000, color: '#ff1744' },
];

// Atmospheric refraction K-factors for LOS calculations
export const K_FACTORS = {
  standard: 1.33,   // 4/3 Earth radius, standard atmosphere
  minimum: 0.67,    // Super-refraction (unusual)
  maximum: 4.0,     // Sub-refraction (unusual)
  none: 1.0,        // No refraction correction
};

// Terrain data source configuration
export const TERRAIN_CONFIG = {
  url: 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png',
  encoding: 'terrarium' as const,
  tileSize: 256,
  minZoom: 0,
  maxZoom: 15,
  attribution: '\u00A9 Copernicus GLO-30 DSM',
};

// Basemap sources
export const BASEMAP_SOURCES = {
  cartoDark: {
    type: 'raster' as const,
    tiles: [
      'https://a.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}@2x.png',
      'https://b.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}@2x.png',
    ],
    tileSize: 256,
    attribution: '\u00A9 CARTO \u00A9 OpenStreetMap',
  },
  cartoLabels: {
    type: 'raster' as const,
    tiles: ['https://a.basemaps.cartocdn.com/dark_only_labels/{z}/{x}/{y}@2x.png'],
    tileSize: 256,
  },
  esriSatellite: {
    type: 'raster' as const,
    tiles: [
      'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
      'https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    ],
    tileSize: 256,
    maxzoom: 19,
    attribution: '\u00A9 Esri, Maxar, Earthstar Geographics',
  },
};

// Geocoding configuration
export const GEOCODING_CONFIG = {
  nominatimUrl: 'https://nominatim.openstreetmap.org/search',
  viewbox: '34.0,29.0,36.0,34.0', // Israel
  defaultCountryCodes: 'il',
  rateLimit: 1000, // ms between requests
  userAgent: 'IsraelElevationMap/4.0',
};

// Attribution texts
export const ATTRIBUTIONS = {
  basemap: '\u00A9 <a href="https://carto.com/">CARTO</a> \u00A9 <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
  satellite: '\u00A9 <a href="https://www.esri.com/">Esri</a>, Maxar, Earthstar Geographics',
  elevation: '\u00A9 Copernicus GLO-30 DSM',
  boundaries: '\u00A9 Natural Earth',
};
