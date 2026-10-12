import * as maplibregl from '../../../utils/los/maplibre';
import { ISRAEL_CENTER, ISRAEL_DEFAULT_ZOOM, ELEVATION_RANGES, TERRAIN_CONFIG, BASEMAP_SOURCES } from '../../../utils/los/constants';
import { registerElevtintProtocol, getTintTilesTemplate } from '../../../utils/los/elevtintProtocol';

const BOUNDARIES_URL = 'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_110m_admin_0_boundary_lines_land.geojson';

/** Create the LOS map with the basemaps (dark, satellite, labels). */
export function createLOSMap(container: HTMLElement): maplibregl.Map {
  registerElevtintProtocol({ terrainUrl: TERRAIN_CONFIG.url, minElevation: ELEVATION_RANGES.fixed.min, maxElevation: ELEVATION_RANGES.fixed.max });
  const mapInstance = new maplibregl.Map({
    container,
    style: {
      version: 8,
      sources: { 'carto-dark': BASEMAP_SOURCES.cartoDark, 'esri-satellite': BASEMAP_SOURCES.esriSatellite, 'carto-labels': BASEMAP_SOURCES.cartoLabels },
      layers: [
        { id: 'carto-dark-layer', type: 'raster', source: 'carto-dark', layout: { visibility: 'visible' } },
        { id: 'esri-satellite-layer', type: 'raster', source: 'esri-satellite', layout: { visibility: 'visible' } },
        { id: 'carto-labels-layer', type: 'raster', source: 'carto-labels', layout: { visibility: 'visible' } },
      ],
    },
    center: ISRAEL_CENTER, zoom: ISRAEL_DEFAULT_ZOOM, minZoom: 2, maxZoom: 20,
  });
  mapInstance.addControl(new maplibregl.NavigationControl(), 'top-left');
  return mapInstance;
}

/**
 * Add every source and layer the app draws into (terrain, tint, boundaries, measure,
 * DSM bounds, results, previews). Call once from the map's 'load' event.
 */
export function addAppLayers(mapInstance: maplibregl.Map): void {
  mapInstance.addSource('terrain-dem', { type: 'raster-dem', tiles: [TERRAIN_CONFIG.url], tileSize: 256, encoding: 'terrarium' });
  mapInstance.addSource('elevation-tint', { type: 'raster', tiles: [getTintTilesTemplate()], tileSize: 256 });
  mapInstance.addLayer({ id: 'elevation-tint-layer', type: 'raster', source: 'elevation-tint', paint: { 'raster-opacity': 0.7 }, layout: { visibility: 'none' } }, 'carto-labels-layer');
  mapInstance.addLayer({ id: 'hillshade-layer', type: 'hillshade', source: 'terrain-dem', paint: { 'hillshade-exaggeration': 0.4, 'hillshade-shadow-color': 'rgba(0,0,0,0.4)' }, layout: { visibility: 'none' } }, 'elevation-tint-layer');

  // Load boundaries
  fetch(BOUNDARIES_URL)
    .then(r => r.ok ? r.json() : Promise.reject('Failed'))
    .then(data => {
      mapInstance.addSource('boundaries', { type: 'geojson', data });
      mapInstance.addLayer({ id: 'boundaries-layer', type: 'line', source: 'boundaries', paint: { 'line-color': 'rgba(255,255,255,0.3)', 'line-width': 1 } });
    })
    .catch(e => console.warn('Could not load boundaries:', e));

  // Measure layers
  mapInstance.addSource('measure-source', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
  mapInstance.addLayer({ id: 'measure-line', type: 'line', source: 'measure-source', filter: ['==', '$type', 'LineString'], paint: { 'line-color': '#22d3ee', 'line-width': 3, 'line-dasharray': [2, 1] } });
  mapInstance.addLayer({ id: 'measure-fill', type: 'fill', source: 'measure-source', filter: ['==', '$type', 'Polygon'], paint: { 'fill-color': '#22d3ee', 'fill-opacity': 0.15 } });
  mapInstance.addLayer({ id: 'measure-points', type: 'circle', source: 'measure-source', filter: ['==', '$type', 'Point'], paint: { 'circle-radius': 5, 'circle-color': '#22d3ee', 'circle-stroke-width': 2, 'circle-stroke-color': '#fff' } });

  // DSM bounds layer
  mapInstance.addSource('dsm-bounds', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
  mapInstance.addLayer({ id: 'dsm-bounds-fill', type: 'fill', source: 'dsm-bounds', paint: { 'fill-color': '#f59e0b', 'fill-opacity': 0.1 } });
  mapInstance.addLayer({ id: 'dsm-bounds-line', type: 'line', source: 'dsm-bounds', paint: { 'line-color': '#f59e0b', 'line-width': 2, 'line-dasharray': [4, 2] } });

  // Results layers - LOS Lines
  mapInstance.addSource('results-los-lines', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
  mapInstance.addLayer({ id: 'results-los-lines-layer', type: 'line', source: 'results-los-lines', paint: { 'line-color': ['get', 'color'], 'line-width': 3 } });

  // Results layers - LOS Area (raster images added dynamically per result)

  // Results layers - LOS Area sector boundary
  mapInstance.addSource('results-los-area-boundary', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
  mapInstance.addLayer({ id: 'results-los-area-boundary-line', type: 'line', source: 'results-los-area-boundary', paint: {
    'line-color': '#22d3ee',
    'line-width': 2.5,
    'line-opacity': 1
  } });

  // Results layers - Peaks
  mapInstance.addSource('results-peaks', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
  mapInstance.addLayer({ id: 'results-peaks-layer', type: 'circle', source: 'results-peaks', paint: {
    'circle-radius': 8,
    'circle-color': ['get', 'color'],
    'circle-stroke-width': 2,
    'circle-stroke-color': '#fff'
  } });

  // Results layers - Peak Finder search polygon
  mapInstance.addSource('results-peaks-polygon', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
  mapInstance.addLayer({ id: 'results-peaks-polygon-fill', type: 'fill', source: 'results-peaks-polygon', paint: {
    'fill-color': ['get', 'color'],
    'fill-opacity': 0.1
  } });
  mapInstance.addLayer({ id: 'results-peaks-polygon-outline', type: 'line', source: 'results-peaks-polygon', paint: {
    'line-color': ['get', 'color'],
    'line-width': 2,
    'line-dasharray': [4, 2]
  } });

  // Preview layers - for showing points/lines/polygons before calculation
  mapInstance.addSource('preview-source', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
  mapInstance.addLayer({ id: 'preview-polygon-fill', type: 'fill', source: 'preview-source', filter: ['==', '$type', 'Polygon'], paint: { 'fill-color': '#22d3ee', 'fill-opacity': 0.2 } });
  mapInstance.addLayer({ id: 'preview-polygon-line', type: 'line', source: 'preview-source', filter: ['==', '$type', 'Polygon'], paint: { 'line-color': '#00ffff', 'line-width': 3 } });
  mapInstance.addLayer({ id: 'preview-line', type: 'line', source: 'preview-source', filter: ['==', '$type', 'LineString'], paint: { 'line-color': '#22d3ee', 'line-width': 2.5 } });
  mapInstance.addLayer({ id: 'preview-points', type: 'circle', source: 'preview-source', filter: ['==', '$type', 'Point'], paint: { 'circle-radius': 8, 'circle-color': ['coalesce', ['get', 'color'], '#22d3ee'], 'circle-stroke-width': 2, 'circle-stroke-color': '#fff' } });

  // Preview grid cells - raster image added/updated dynamically

  // Load DSM bounds; the caller subscribes to DSM changes (see watchDSMBounds).
  void syncDSMBounds(mapInstance);
}

/** Re-sync the DSM bounds layer whenever custom DSM layers change. Returns an unsubscribe. */
export function watchDSMBounds(mapInstance: maplibregl.Map): () => void {
  let unsubscribe: (() => void) | undefined;
  let cancelled = false;
  import('../../../utils/los/customDSM')
    .then(dsmModule => {
      if (cancelled) return;
      unsubscribe = dsmModule.onLayersChange(() => void syncDSMBounds(mapInstance));
    })
    .catch(() => {});
  return () => {
    cancelled = true;
    unsubscribe?.();
  };
}

/** Keep the 'dsm-bounds' layer in sync with the uploaded custom DSM layers. */
export async function syncDSMBounds(mapInstance: maplibregl.Map): Promise<void> {
  try {
    const dsmModule = await import('../../../utils/los/customDSM');
    const layers = dsmModule.getCustomLayers();
    const features = layers.map(layer => ({
      type: 'Feature' as const,
      properties: { name: layer.name },
      geometry: {
        type: 'Polygon' as const,
        coordinates: [[
          [layer.bounds.west, layer.bounds.south],
          [layer.bounds.east, layer.bounds.south],
          [layer.bounds.east, layer.bounds.north],
          [layer.bounds.west, layer.bounds.north],
          [layer.bounds.west, layer.bounds.south],
        ]],
      },
    }));
    const source = mapInstance.getSource('dsm-bounds') as maplibregl.GeoJSONSource;
    if (source) {
      source.setData({ type: 'FeatureCollection', features });
    }
  } catch { /* DSM module not available */ }
}
