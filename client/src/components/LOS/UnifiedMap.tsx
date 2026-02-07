
import React, { useRef, useEffect, useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import maplibregl from 'maplibre-gl';
import { ISRAEL_CENTER, ISRAEL_DEFAULT_ZOOM, ELEVATION_RANGES, TERRAIN_CONFIG, BASEMAP_SOURCES } from '../../utils/los/constants';
import { haversineDistance, initialBearing, sphericalPolygonArea, formatDistance, formatArea, destinationPoint, metersToDegreesLat, metersToDegreesLon, type LatLon } from '../../utils/los/geo';
import { useIsMobile, useElevation } from '../../utils/los/hooks';
import { sampleElevationAtLngLat, calculateViewportMinMax } from '../../utils/los/elevation';
import { registerElevtintProtocol, updateElevationLUT, getTintTilesTemplate } from '../../utils/los/elevtintProtocol';
import { useLOSState, isLOSLineResult, isLOSAreaResult, isPeakFinderResult } from '../../contexts/LOSContext';
import { gridToImageUrl } from '../../utils/los/losAreaRaster';
import type { GeocodingResult } from '../../utils/los/geocoding';
import styles from './UnifiedMap.module.css';

type MeasureMode = 'none' | 'distance' | 'area';
type ScaleMode = 'fixed' | 'viewport';

export default function UnifiedMap() {
  const { t } = useTranslation();
  const { state, mapRef, updateMapState, getVisibleResults, mapClickHandler, previewPoints, setPreviewPoints, previewPolygon, previewLine, previewSector, previewPeaks, previewGridCells, removeResult, previewDragHandler, editResultInPanel } = useLOSState();
  const mapContainer = useRef<HTMLDivElement>(null);
  const searchMarkerRef = useRef<{ marker: maplibregl.Marker; popup: maplibregl.Popup } | null>(null);
  const resultMarkersRef = useRef<Map<string, maplibregl.Marker[]>>(new Map());
  const previewMarkersRef = useRef<maplibregl.Marker[]>([]);
  const mapInitializedRef = useRef(false);
  const searchSectionRef = useRef<HTMLDivElement>(null);
  const resultRasterIdsRef = useRef<Set<string>>(new Set());
  const previewRasterActiveRef = useRef(false);

  const [mapLoaded, setMapLoaded] = useState(false);
  const [basemap, setBasemap] = useState<'map' | 'satellite'>(state.mapState.basemap);
  const [elevationTintVisible, setElevationTintVisible] = useState(state.mapState.elevationTintVisible);
  const [elevationOpacity, setElevationOpacity] = useState(state.mapState.elevationOpacity);
  const [scaleMode, setScaleMode] = useState<ScaleMode>('fixed');
  const [showBoundaries, setShowBoundaries] = useState(true);
  const [cursorPosition, setCursorPosition] = useState<{ lng: number; lat: number } | null>(null);
  const [zoom, setZoom] = useState(ISRAEL_DEFAULT_ZOOM);
  const [settingsOpen, setSettingsOpen] = useState(false);

  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<GeocodingResult[]>([]);
  const [showSearchResults, setShowSearchResults] = useState(false);

  const [measureMode, setMeasureMode] = useState<MeasureMode>('none');
  const [measurePoints, setMeasurePoints] = useState<LatLon[]>([]);
  const [measureFinished, setMeasureFinished] = useState(false);

  const isMobile = useIsMobile();
  const { elevation, loading: elevationLoading } = useElevation(cursorPosition, zoom, TERRAIN_CONFIG.url, TERRAIN_CONFIG.encoding);

  // Sync basemap with context (but don't trigger re-render of map)
  useEffect(() => {
    updateMapState({ basemap });
  }, [basemap, updateMapState]);

  useEffect(() => {
    updateMapState({ elevationTintVisible, elevationOpacity });
  }, [elevationTintVisible, elevationOpacity, updateMapState]);

  // Click-outside to close search results
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (searchSectionRef.current && !searchSectionRef.current.contains(e.target as Node)) {
        setShowSearchResults(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const handleSearch = useCallback(async (query: string) => {
    if (!query.trim()) { setSearchResults([]); return; }
    const coordMatch = query.match(/^\s*(-?\d+\.?\d*)\s*[,\s]\s*(-?\d+\.?\d*)\s*$/);
    if (coordMatch) {
      const lat = parseFloat(coordMatch[1]), lon = parseFloat(coordMatch[2]);
      if (lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180) {
        setSearchResults([{ lat, lon, displayName: `${lat.toFixed(5)}, ${lon.toFixed(5)}`, type: 'coordinates' }]);
        setShowSearchResults(true);
        return;
      }
    }
    try {
      const params = new URLSearchParams({ q: query, format: 'json', limit: '5', countrycodes: 'il', viewbox: '34.0,29.0,36.0,34.0', bounded: '1', 'accept-language': 'he,en' });
      const response = await fetch(`https://nominatim.openstreetmap.org/search?${params}`, { headers: { 'User-Agent': 'IsraelElevationMap/5.0' } });
      if (response.ok) {
        const results = await response.json();
        setSearchResults(results.map((r: any) => ({ lat: parseFloat(r.lat), lon: parseFloat(r.lon), displayName: r.display_name, type: 'place' })));
        setShowSearchResults(true);
      }
    } catch (e) { console.error('Search error:', e); }
  }, []);

  const handleSearchResultClick = useCallback(async (result: GeocodingResult) => {
    if (!mapRef.current) return;
    setShowSearchResults(false);
    setSearchQuery(result.displayName.split(',')[0]);
    mapRef.current.flyTo({ center: [result.lon, result.lat], zoom: 14, duration: 1500 });
    if (searchMarkerRef.current) { searchMarkerRef.current.marker.remove(); searchMarkerRef.current.popup.remove(); }
    const elev = await sampleElevationAtLngLat(result.lon, result.lat, 12, TERRAIN_CONFIG.url, TERRAIN_CONFIG.encoding);
    const el = document.createElement('div'); el.className = styles.searchMarker;
    const popup = new maplibregl.Popup({ offset: 25 }).setHTML(`<div style="direction:rtl;padding:4px;"><div style="font-weight:600;">${result.displayName.split(',').slice(0,2).join(', ')}</div><div style="font-size:12px;color:#888;">${result.lat.toFixed(5)}, ${result.lon.toFixed(5)}<br/><span style="color:#22d3ee;">גובה: ${elev !== null ? Math.round(elev) + " מ'" : 'לא זמין'}</span></div></div>`);
    const marker = new maplibregl.Marker({ element: el }).setLngLat([result.lon, result.lat]).setPopup(popup).addTo(mapRef.current);
    popup.addTo(mapRef.current);
    searchMarkerRef.current = { marker, popup };
    setTimeout(() => popup.remove(), 5000);
  }, [mapRef]);

  // Helper to update DSM bounds on map
  const updateDSMBounds = useCallback(async (mapInstance: maplibregl.Map) => {
    try {
      const dsmModule = await import('../../utils/los/customDSM');
      const layers = dsmModule.getCustomLayers();
      const features = layers.map((layer: any) => ({
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
          ]]
        }
      }));
      const source = mapInstance.getSource('dsm-bounds') as maplibregl.GeoJSONSource;
      if (source) {
        source.setData({ type: 'FeatureCollection', features });
      }
    } catch (e) { /* DSM module not available */ }
  }, []);

  // Initialize map - ONLY ONCE
  useEffect(() => {
    if (!mapContainer.current || mapInitializedRef.current) return;
    mapInitializedRef.current = true;

    registerElevtintProtocol({ terrainUrl: TERRAIN_CONFIG.url, minElevation: ELEVATION_RANGES.fixed.min, maxElevation: ELEVATION_RANGES.fixed.max });
    const mapInstance = new maplibregl.Map({
      container: mapContainer.current,
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

    mapInstance.on('load', () => {
      setMapLoaded(true);
      mapInstance.addSource('terrain-dem', { type: 'raster-dem', tiles: [TERRAIN_CONFIG.url], tileSize: 256, encoding: 'terrarium' });
      mapInstance.addSource('elevation-tint', { type: 'raster', tiles: [getTintTilesTemplate()], tileSize: 256 });
      mapInstance.addLayer({ id: 'elevation-tint-layer', type: 'raster', source: 'elevation-tint', paint: { 'raster-opacity': 0.7 }, layout: { visibility: 'none' } }, 'carto-labels-layer');
      mapInstance.addLayer({ id: 'hillshade-layer', type: 'hillshade', source: 'terrain-dem', paint: { 'hillshade-exaggeration': 0.4, 'hillshade-shadow-color': 'rgba(0,0,0,0.4)' }, layout: { visibility: 'none' } }, 'elevation-tint-layer');

      // Load boundaries
      fetch('https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_110m_admin_0_boundary_lines_land.geojson')
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

      // Load DSM bounds and subscribe to changes
      updateDSMBounds(mapInstance);
      import('../../utils/los/customDSM').then(dsmModule => {
        dsmModule.onLayersChange(() => updateDSMBounds(mapInstance));
      }).catch(() => {});
    });

    // Click handler that dispatches to handler from context
    mapInstance.on('click', (e) => {
      if (mapClickHandler.current) {
        mapClickHandler.current({ lngLat: { lat: e.lngLat.lat, lng: e.lngLat.lng } });
      }
    });

    const handleMove = (e: maplibregl.MapMouseEvent | maplibregl.MapTouchEvent) => setCursorPosition({ lng: e.lngLat.lng, lat: e.lngLat.lat });
    mapInstance.on('mousemove', handleMove);
    mapInstance.on('touchmove', handleMove);
    mapInstance.on('moveend', () => {
      setZoom(mapInstance.getZoom());
      if (isMobile) { const c = mapInstance.getCenter(); setCursorPosition({ lng: c.lng, lat: c.lat }); }
      // Note: We intentionally don't update context here to avoid re-initialization
    });
    mapInstance.on('mouseout', () => { if (!isMobile) setCursorPosition(null); });

    mapRef.current = mapInstance;
    return () => {
      mapInstance.remove();
      mapRef.current = null;
      mapInitializedRef.current = false;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Update basemap visibility
  useEffect(() => {
    if (!mapRef.current || !mapLoaded) return;
    // Keep carto-dark always visible as fallback behind satellite (prevents black tiles)
    mapRef.current.setLayoutProperty('carto-dark-layer', 'visibility', 'visible');
    mapRef.current.setLayoutProperty('esri-satellite-layer', 'visibility', basemap === 'satellite' ? 'visible' : 'none');
    mapRef.current.setLayoutProperty('carto-labels-layer', 'visibility', 'visible');
  }, [basemap, mapLoaded, mapRef]);

  // Update elevation tint
  useEffect(() => {
    if (!mapRef.current || !mapLoaded) return;
    const v = elevationTintVisible ? 'visible' : 'none';
    mapRef.current.getLayer('elevation-tint-layer') && mapRef.current.setLayoutProperty('elevation-tint-layer', 'visibility', v);
    mapRef.current.getLayer('elevation-tint-layer') && mapRef.current.setPaintProperty('elevation-tint-layer', 'raster-opacity', elevationOpacity);
    mapRef.current.getLayer('hillshade-layer') && mapRef.current.setLayoutProperty('hillshade-layer', 'visibility', v);
  }, [elevationTintVisible, elevationOpacity, mapLoaded, mapRef]);

  // Update boundaries visibility
  useEffect(() => {
    if (!mapRef.current || !mapLoaded) return;
    mapRef.current.getLayer('boundaries-layer') && mapRef.current.setLayoutProperty('boundaries-layer', 'visibility', showBoundaries ? 'visible' : 'none');
  }, [showBoundaries, mapLoaded, mapRef]);

  // Update scale mode
  useEffect(() => {
    if (!mapRef.current || !mapLoaded) return;

    const safeSetTiles = () => {
      try {
        const source = mapRef.current?.getSource('elevation-tint') as maplibregl.RasterTileSource;
        if (source && typeof source.setTiles === 'function') {
          source.setTiles([getTintTilesTemplate()]);
        }
      } catch (e) {
        console.warn('Could not update tint tiles:', e);
      }
    };

    if (scaleMode === 'fixed') {
      updateElevationLUT(ELEVATION_RANGES.fixed.min, ELEVATION_RANGES.fixed.max);
      setTimeout(safeSetTiles, 100);
      return;
    }
    const update = async () => {
      if (!mapRef.current) return;
      const b = mapRef.current.getBounds();
      const result = await calculateViewportMinMax({ west: b.getWest(), south: b.getSouth(), east: b.getEast(), north: b.getNorth() }, Math.floor(mapRef.current.getZoom()), TERRAIN_CONFIG.url, TERRAIN_CONFIG.encoding);
      if (result) {
        updateElevationLUT(result.min, result.max);
        safeSetTiles();
      }
    };
    const timeout = setTimeout(update, 100);
    mapRef.current.on('moveend', update);
    return () => { clearTimeout(timeout); mapRef.current?.off('moveend', update); };
  }, [scaleMode, mapLoaded, mapRef]);

  // Measure mode handlers
  useEffect(() => {
    if (!mapRef.current || measureMode === 'none' || measureFinished) return;
    const handleClick = (e: maplibregl.MapMouseEvent) => setMeasurePoints(prev => [...prev, { lat: e.lngLat.lat, lon: e.lngLat.lng }]);
    const handleDblClick = (e: maplibregl.MapMouseEvent) => { e.preventDefault(); setMeasureFinished(true); };
    mapRef.current.on('click', handleClick);
    mapRef.current.on('dblclick', handleDblClick);
    mapRef.current.getCanvas().style.cursor = 'crosshair';
    return () => { mapRef.current?.off('click', handleClick); mapRef.current?.off('dblclick', handleDblClick); if (mapRef.current) mapRef.current.getCanvas().style.cursor = ''; };
  }, [measureMode, measureFinished, mapRef]);

  // Update measure visualization
  useEffect(() => {
    if (!mapRef.current || !mapLoaded) return;
    const source = mapRef.current.getSource('measure-source') as maplibregl.GeoJSONSource;
    if (!source) return;
    const features: GeoJSON.Feature[] = [];
    measurePoints.forEach((p, i) => features.push({ type: 'Feature', properties: { index: i }, geometry: { type: 'Point', coordinates: [p.lon, p.lat] } }));
    if (measurePoints.length >= 2) {
      const coords = measurePoints.map(p => [p.lon, p.lat]);
      if (measureMode === 'area' && measurePoints.length >= 3) features.push({ type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [[...coords, coords[0]]] } });
      else features.push({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: coords } });
    }
    source.setData({ type: 'FeatureCollection', features });
  }, [measurePoints, measureMode, mapLoaded, mapRef]);

  // Update preview visualization (points selected by panels before calculation)
  useEffect(() => {
    if (!mapRef.current || !mapLoaded) return;
    const source = mapRef.current.getSource('preview-source') as maplibregl.GeoJSONSource;
    if (!source) return;

    const features: GeoJSON.Feature[] = [];

    // NOTE: We do NOT add preview points as GeoJSON Point features here,
    // because they are rendered as draggable HTML markers (see below).
    // Adding them as a GeoJSON circle layer would block mousedown events
    // needed for MapLibre's marker drag functionality.

    // Add preview line (e.g., LOS line between A and B)
    if (previewLine && previewLine.length >= 2) {
      features.push({
        type: 'Feature',
        properties: {},
        geometry: { type: 'LineString', coordinates: previewLine.map(p => [p.lon, p.lat]) }
      });
    }

    // Add preview polygon (e.g., peak finder area)
    if (previewPolygon && previewPolygon.points.length >= 3) {
      const coords = previewPolygon.points.map(p => [p.lon, p.lat]);
      features.push({
        type: 'Feature',
        properties: { color: previewPolygon.color || '#22d3ee' },
        geometry: { type: 'Polygon', coordinates: [[...coords, coords[0]]] }
      });
      // Also add points for polygon vertices
      previewPolygon.points.forEach((p, i) => {
        features.push({
          type: 'Feature',
          properties: { color: previewPolygon.color || '#22d3ee', label: `${i + 1}` },
          geometry: { type: 'Point', coordinates: [p.lon, p.lat] }
        });
      });
    }

    // Add preview sector (e.g., LOS area scan range)
    if (previewSector) {
      const { origin, minDistance, maxDistance, minAzimuth, maxAzimuth, color = '#22d3ee' } = previewSector;

      // Normalize azimuths
      const normMinAz = ((minAzimuth % 360) + 360) % 360;
      const normMaxAz = ((maxAzimuth % 360) + 360) % 360;
      const azRange = normMinAz <= normMaxAz ? normMaxAz - normMinAz : (360 - normMinAz) + normMaxAz;
      const fullCircle = azRange === 0 || azRange >= 360;

      const angularStep = fullCircle ? 5 : Math.max(2, azRange / 72);
      const effectiveAzRange = fullCircle ? 360 : azRange;

      // Generate outer arc
      const outerArc: [number, number][] = [];
      for (let az = 0; az <= effectiveAzRange; az += angularStep) {
        const bearing = (normMinAz + az) % 360;
        const p = destinationPoint(origin.lat, origin.lon, bearing, maxDistance);
        outerArc.push([p.lon, p.lat]);
      }
      if (!fullCircle) {
        const endOuter = destinationPoint(origin.lat, origin.lon, normMaxAz, maxDistance);
        outerArc.push([endOuter.lon, endOuter.lat]);
      }
      if (fullCircle && outerArc.length > 0) {
        outerArc.push(outerArc[0]);
      }

      // Generate inner arc if minDistance > 0
      const innerArc: [number, number][] = [];
      if (minDistance > 0) {
        for (let az = 0; az <= effectiveAzRange; az += angularStep) {
          const bearing = (normMinAz + az) % 360;
          const p = destinationPoint(origin.lat, origin.lon, bearing, minDistance);
          innerArc.push([p.lon, p.lat]);
        }
        if (!fullCircle) {
          const endInner = destinationPoint(origin.lat, origin.lon, normMaxAz, minDistance);
          innerArc.push([endInner.lon, endInner.lat]);
        }
        if (fullCircle && innerArc.length > 0) {
          innerArc.push(innerArc[0]);
        }
      }

      // Build polygon - the preview-polygon-line layer will draw the dashed border
      if (fullCircle && minDistance > 0) {
        // Donut
        features.push({
          type: 'Feature',
          properties: { color },
          geometry: { type: 'Polygon', coordinates: [outerArc, innerArc] }
        });
      } else if (fullCircle && minDistance === 0) {
        features.push({
          type: 'Feature',
          properties: { color },
          geometry: { type: 'Polygon', coordinates: [outerArc] }
        });
      } else if (minDistance > 0) {
        const reversedInner = [...innerArc].reverse();
        const ring = [...outerArc, ...reversedInner];
        ring.push(ring[0]);
        features.push({
          type: 'Feature',
          properties: { color },
          geometry: { type: 'Polygon', coordinates: [ring] }
        });
      } else {
        const ring: [number, number][] = [[origin.lon, origin.lat], ...outerArc, [origin.lon, origin.lat]];
        features.push({
          type: 'Feature',
          properties: { color },
          geometry: { type: 'Polygon', coordinates: [ring] }
        });
      }
    }

    source.setData({ type: 'FeatureCollection', features });

    // Update preview markers — simple draggable dots
    previewMarkersRef.current.forEach(m => m.remove());
    previewMarkersRef.current = [];

    previewPoints.forEach((p, idx) => {
      const el = document.createElement('div');
      el.className = styles.marker;
      el.style.backgroundColor = p.color || '#22d3ee';
      if (p.label) {
        el.textContent = p.label;
      }

      const marker = new maplibregl.Marker({ element: el, draggable: true, anchor: 'center' })
        .setLngLat([p.lon, p.lat])
        .addTo(mapRef.current!);

      marker.on('dragend', () => {
        const lngLat = marker.getLngLat();
        if (previewDragHandler.current) {
          previewDragHandler.current(idx, lngLat.lat, lngLat.lng);
        }
      });

      previewMarkersRef.current.push(marker);
    });

    // Add preview peak markers
    previewPeaks.forEach(peak => {
      const el = document.createElement('div');
      el.className = styles.peakMarker;
      el.innerHTML = `<span class="${styles.peakRank}">${peak.rank}</span>`;
      el.style.backgroundColor = '#f59e0b';

      const popup = new maplibregl.Popup({ offset: 25 }).setHTML(
        `<div style="direction:rtl;padding:4px;">
          <div style="font-weight:600;">פסגה #${peak.rank}</div>
          <div style="font-size:12px;color:#888;">
            ${peak.lat.toFixed(5)}, ${peak.lon.toFixed(5)}<br/>
            <span style="color:#22d3ee;">גובה: ${Math.round(peak.elevation)} מ'</span>
          </div>
        </div>`
      );

      const marker = new maplibregl.Marker({ element: el })
        .setLngLat([peak.lon, peak.lat])
        .setPopup(popup)
        .addTo(mapRef.current!);
      previewMarkersRef.current.push(marker);
    });

  }, [previewPoints, previewLine, previewPolygon, previewSector, previewPeaks, mapLoaded, mapRef]);

  // Update results layers from context
  useEffect(() => {
    if (!mapRef.current || !mapLoaded) return;

    const visibleResults = getVisibleResults();

    // LOS Lines
    const losLineFeatures: GeoJSON.Feature[] = [];
    visibleResults.filter(isLOSLineResult).forEach(r => {
      losLineFeatures.push({
        type: 'Feature',
        properties: { id: r.id, color: r.color, clear: r.result.clear },
        geometry: {
          type: 'LineString',
          coordinates: [
            [r.params.pointA.lon, r.params.pointA.lat],
            [r.params.pointB.lon, r.params.pointB.lat]
          ]
        }
      });
    });
    const losLinesSource = mapRef.current.getSource('results-los-lines') as maplibregl.GeoJSONSource;
    if (losLinesSource) {
      losLinesSource.setData({ type: 'FeatureCollection', features: losLineFeatures });
    }

    // LOS Area - raster images for results
    const losAreaBoundaryFeatures: GeoJSON.Feature[] = [];
    const newRasterIds = new Set<string>();

    visibleResults.filter(isLOSAreaResult).forEach(r => {
      const { origin, resolution, minDistance, maxDistance, minAzimuth, maxAzimuth } = r.params;
      const sourceId = `result-raster-${r.id}`;
      const layerId = `result-raster-layer-${r.id}`;
      newRasterIds.add(r.id);

      // Render cells to raster image
      const raster = gridToImageUrl(r.result.cells, resolution, origin.lat);

      if (raster) {
        const existingSource = mapRef.current!.getSource(sourceId) as maplibregl.ImageSource;
        if (existingSource) {
          existingSource.updateImage({ url: raster.url, coordinates: raster.coordinates });
        } else {
          mapRef.current!.addSource(sourceId, {
            type: 'image',
            url: raster.url,
            coordinates: raster.coordinates,
          });
          // Insert before boundary layer so boundary lines draw on top
          const beforeLayer = mapRef.current!.getLayer('results-los-area-boundary-line') ? 'results-los-area-boundary-line' : undefined;
          mapRef.current!.addLayer({
            id: layerId,
            type: 'raster',
            source: sourceId,
            paint: { 'raster-opacity': 0.85, 'raster-fade-duration': 0 },
          }, beforeLayer);
        }
      }

      // Generate sector boundary polygon
      const normMinAz = ((minAzimuth % 360) + 360) % 360;
      const normMaxAz = ((maxAzimuth % 360) + 360) % 360;
      const azRange = normMinAz <= normMaxAz ? normMaxAz - normMinAz : (360 - normMinAz) + normMaxAz;
      const fullCircle = azRange === 0 || azRange >= 360;
      const angularStep = fullCircle ? 5 : Math.max(1, azRange / 72);
      const effectiveAzRange = fullCircle ? 360 : azRange;

      const outerArc: [number, number][] = [];
      for (let az = 0; az <= effectiveAzRange; az += angularStep) {
        const bearing = (normMinAz + az) % 360;
        const p = destinationPoint(origin.lat, origin.lon, bearing, maxDistance);
        outerArc.push([p.lon, p.lat]);
      }
      if (!fullCircle) {
        const endOuter = destinationPoint(origin.lat, origin.lon, normMaxAz, maxDistance);
        outerArc.push([endOuter.lon, endOuter.lat]);
      }

      const innerArc: [number, number][] = [];
      if (minDistance > 0) {
        for (let az = effectiveAzRange; az >= 0; az -= angularStep) {
          const bearing = (normMinAz + az) % 360;
          const p = destinationPoint(origin.lat, origin.lon, bearing, minDistance);
          innerArc.push([p.lon, p.lat]);
        }
        const startInner = destinationPoint(origin.lat, origin.lon, normMinAz, minDistance);
        innerArc.push([startInner.lon, startInner.lat]);
      }

      let boundaryRing: [number, number][];
      if (fullCircle && minDistance > 0) {
        const outerRing = [...outerArc]; outerRing.push(outerRing[0]);
        const innerRing: [number, number][] = [];
        for (let az = 0; az <= 360; az += angularStep) {
          const bearing = (normMinAz + az) % 360;
          const p = destinationPoint(origin.lat, origin.lon, bearing, minDistance);
          innerRing.push([p.lon, p.lat]);
        }
        innerRing.push(innerRing[0]);
        losAreaBoundaryFeatures.push({
          type: 'Feature',
          properties: { id: r.id, color: r.color || '#22d3ee' },
          geometry: { type: 'MultiLineString', coordinates: [outerRing, innerRing] }
        });
        boundaryRing = [];
      } else if (fullCircle && minDistance === 0) {
        boundaryRing = [...outerArc]; boundaryRing.push(boundaryRing[0]);
      } else if (minDistance > 0) {
        boundaryRing = [...outerArc, ...innerArc]; boundaryRing.push(boundaryRing[0]);
      } else {
        boundaryRing = [[origin.lon, origin.lat], ...outerArc, [origin.lon, origin.lat]];
      }

      if (boundaryRing.length > 0) {
        losAreaBoundaryFeatures.push({
          type: 'Feature',
          properties: { id: r.id, color: r.color || '#22d3ee' },
          geometry: { type: 'LineString', coordinates: boundaryRing }
        });
      }
    });

    // Remove old raster sources that are no longer in visible results
    for (const oldId of resultRasterIdsRef.current) {
      if (!newRasterIds.has(oldId)) {
        const layerId = `result-raster-layer-${oldId}`;
        const sourceId = `result-raster-${oldId}`;
        if (mapRef.current!.getLayer(layerId)) mapRef.current!.removeLayer(layerId);
        if (mapRef.current!.getSource(sourceId)) mapRef.current!.removeSource(sourceId);
      }
    }
    resultRasterIdsRef.current = newRasterIds;

    const losAreaBoundarySource = mapRef.current.getSource('results-los-area-boundary') as maplibregl.GeoJSONSource;
    if (losAreaBoundarySource) {
      losAreaBoundarySource.setData({ type: 'FeatureCollection', features: losAreaBoundaryFeatures });
    }

    // Peaks
    const peakFeatures: GeoJSON.Feature[] = [];
    visibleResults.filter(isPeakFinderResult).forEach(r => {
      r.result.peaks.forEach(peak => {
        peakFeatures.push({
          type: 'Feature',
          properties: {
            id: r.id,
            color: r.color,
            elevation: peak.elevation,
            rank: peak.rank
          },
          geometry: { type: 'Point', coordinates: [peak.lon, peak.lat] }
        });
      });
    });
    const peaksSource = mapRef.current.getSource('results-peaks') as maplibregl.GeoJSONSource;
    if (peaksSource) {
      peaksSource.setData({ type: 'FeatureCollection', features: peakFeatures });
    }

    // Peak Finder search polygons
    const peakPolygonFeatures: GeoJSON.Feature[] = [];
    visibleResults.filter(isPeakFinderResult).forEach(r => {
      if (r.params.polygon && r.params.polygon.length >= 3) {
        const coords = r.params.polygon.map(p => [p.lon, p.lat]);
        peakPolygonFeatures.push({
          type: 'Feature',
          properties: { id: r.id, color: r.color },
          geometry: { type: 'Polygon', coordinates: [[...coords, coords[0]]] }
        });
      }
    });
    const peakPolygonSource = mapRef.current.getSource('results-peaks-polygon') as maplibregl.GeoJSONSource;
    if (peakPolygonSource) {
      peakPolygonSource.setData({ type: 'FeatureCollection', features: peakPolygonFeatures });
    }

    // Clean up old markers and create new ones for peaks (with labels)
    resultMarkersRef.current.forEach(markers => markers.forEach(m => m.remove()));
    resultMarkersRef.current.clear();

    visibleResults.filter(isPeakFinderResult).forEach(r => {
      const markers: maplibregl.Marker[] = [];
      r.result.peaks.forEach(peak => {
        const el = document.createElement('div');
        el.className = styles.peakMarker;
        el.innerHTML = `<span class="${styles.peakRank}">${peak.rank}</span>`;
        el.style.backgroundColor = r.color;

        const popup = new maplibregl.Popup({ offset: 25 }).setHTML(
          `<div style="direction:rtl;padding:4px;">
            <div style="font-weight:600;">פסגה #${peak.rank}</div>
            <div style="font-size:12px;color:#888;">
              ${peak.lat.toFixed(5)}, ${peak.lon.toFixed(5)}<br/>
              <span style="color:#22d3ee;">גובה: ${Math.round(peak.elevation)} מ'</span>
            </div>
          </div>`
        );

        const marker = new maplibregl.Marker({ element: el })
          .setLngLat([peak.lon, peak.lat])
          .setPopup(popup)
          .addTo(mapRef.current!);
        markers.push(marker);
      });
      resultMarkersRef.current.set(r.id, markers);
    });

    // LOS Line markers — simple dots with popups
    visibleResults.filter(isLOSLineResult).forEach(r => {
      const markers: maplibregl.Marker[] = [];
      const modeText = r.params.mode === 'optical' ? 'אופטי' : 'RF';
      const resultText = r.result.clear ? '✓ קו ראייה פתוח' : '✕ קו ראייה חסום';
      const resultColor = r.result.clear ? '#10b981' : '#f43f5e';

      const buildPointPopup = (label: string, point: 'A' | 'B', lat: number, lon: number, height: number) => `
        <div style="direction:rtl;padding:8px;min-width:180px;">
          <div style="font-weight:600;font-size:13px;color:white;margin-bottom:6px;">נקודה ${label}</div>
          <div style="font-size:11px;color:#aaa;line-height:1.6;">
            <div>קו רוחב: <span style="color:white;font-family:monospace;">${lat.toFixed(6)}</span></div>
            <div>קו אורך: <span style="color:white;font-family:monospace;">${lon.toFixed(6)}</span></div>
            <div>גובה: <span style="color:white;">${height} מ'</span></div>
          </div>
          <hr style="border-color:#333;margin:8px 0;" />
          <div style="font-size:11px;color:#aaa;">
            <div>מצב: ${modeText}${r.params.rfFrequency ? ` (${r.params.rfFrequency})` : ''}</div>
            <div style="color:${resultColor};">${resultText}</div>
          </div>
          <div style="display:flex;gap:6px;margin-top:8px;">
            <button data-action="edit" data-result-id="${r.id}"
              style="flex:1;padding:6px;background:#22d3ee;color:#0a0a0c;border:none;border-radius:6px;font-weight:600;font-size:12px;cursor:pointer;">
              שנה
            </button>
            <button data-action="delete" data-result-id="${r.id}"
              style="padding:6px 10px;background:rgba(244,63,94,0.15);color:#f43f5e;border:1px solid rgba(244,63,94,0.3);border-radius:6px;font-weight:600;font-size:12px;cursor:pointer;">
              מחק
            </button>
          </div>
        </div>`;

      // Point A — labeled dot
      const elA = document.createElement('div');
      elA.className = styles.marker;
      elA.style.backgroundColor = r.color;
      elA.textContent = 'A';
      const popupA = new maplibregl.Popup({ offset: 25, closeButton: true }).setHTML(
        buildPointPopup('A', 'A', r.params.pointA.lat, r.params.pointA.lon, r.params.pointA.height)
      );
      const origPosA: [number, number] = [r.params.pointA.lon, r.params.pointA.lat];
      const markerA = new maplibregl.Marker({ element: elA, draggable: true, anchor: 'center' })
        .setLngLat(origPosA)
        .setPopup(popupA)
        .addTo(mapRef.current!);
      markerA.on('dragend', () => {
        editResultInPanel(r.id);
        markerA.setLngLat(origPosA);
      });
      markers.push(markerA);

      // Point B — labeled dot
      const elB = document.createElement('div');
      elB.className = styles.marker;
      elB.style.backgroundColor = r.color;
      elB.textContent = 'B';
      const popupB = new maplibregl.Popup({ offset: 25, closeButton: true }).setHTML(
        buildPointPopup('B', 'B', r.params.pointB.lat, r.params.pointB.lon, r.params.pointB.height)
      );
      const origPosB: [number, number] = [r.params.pointB.lon, r.params.pointB.lat];
      const markerB = new maplibregl.Marker({ element: elB, draggable: true, anchor: 'center' })
        .setLngLat(origPosB)
        .setPopup(popupB)
        .addTo(mapRef.current!);
      markerB.on('dragend', () => {
        editResultInPanel(r.id);
        markerB.setLngLat(origPosB);
      });
      markers.push(markerB);

      resultMarkersRef.current.set(r.id, markers);
    });

    // LOS Area origin marker — simple dot with popup
    visibleResults.filter(isLOSAreaResult).forEach(r => {
      const markers: maplibregl.Marker[] = [];
      const { origin, targetHeight, minDistance, maxDistance, minAzimuth, maxAzimuth, resolution, mode } = r.params;

      const el = document.createElement('div');
      el.className = styles.marker;
      el.style.backgroundColor = r.color;

      const popup = new maplibregl.Popup({ offset: 25, closeButton: true }).setHTML(
        `<div style="direction:rtl;padding:8px;min-width:180px;">
          <div style="font-weight:600;font-size:13px;color:white;margin-bottom:6px;">נקודת מקור</div>
          <div style="font-size:11px;color:#aaa;line-height:1.6;">
            <div>קו רוחב: <span style="color:white;font-family:monospace;">${origin.lat.toFixed(6)}</span></div>
            <div>קו אורך: <span style="color:white;font-family:monospace;">${origin.lon.toFixed(6)}</span></div>
            <div>גובה: <span style="color:white;">${origin.height} מ'</span></div>
          </div>
          <hr style="border-color:#333;margin:8px 0;" />
          <div style="font-size:11px;color:#aaa;line-height:1.6;">
            <div>גובה יעד: ${targetHeight} מ'</div>
            <div>טווח: ${minDistance}-${maxDistance} מ'</div>
            <div>אזימוט: ${minAzimuth}°-${maxAzimuth}°</div>
            <div>רזולוציה: ${resolution} מ'</div>
            <div>מצב: ${mode === 'optical' ? 'אופטי' : 'RF'}${r.params.rfFrequency ? ` (${r.params.rfFrequency})` : ''}</div>
          </div>
          <div style="display:flex;gap:6px;margin-top:8px;">
            <button data-action="edit" data-result-id="${r.id}"
              style="flex:1;padding:6px;background:#22d3ee;color:#0a0a0c;border:none;border-radius:6px;font-weight:600;font-size:12px;cursor:pointer;">
              שנה
            </button>
            <button data-action="delete" data-result-id="${r.id}"
              style="padding:6px 10px;background:rgba(244,63,94,0.15);color:#f43f5e;border:1px solid rgba(244,63,94,0.3);border-radius:6px;font-weight:600;font-size:12px;cursor:pointer;">
              מחק
            </button>
          </div>
        </div>`
      );

      const origPosOrigin: [number, number] = [origin.lon, origin.lat];
      const marker = new maplibregl.Marker({ element: el, draggable: true })
        .setLngLat(origPosOrigin)
        .setPopup(popup)
        .addTo(mapRef.current!);
      marker.on('dragend', () => {
        editResultInPanel(r.id);
        marker.setLngLat(origPosOrigin);
      });
      markers.push(marker);

      resultMarkersRef.current.set(`${r.id}-origin`, markers);
    });

  }, [state.results, mapLoaded, mapRef, getVisibleResults]);

  // Update preview grid cells (for LOS Area calculation preview) - raster image
  useEffect(() => {
    if (!mapRef.current || !mapLoaded) return;

    const sourceId = 'preview-grid-raster';
    const layerId = 'preview-grid-raster-layer';

    if (previewGridCells.length === 0) {
      // Remove raster if no cells
      if (previewRasterActiveRef.current) {
        if (mapRef.current.getLayer(layerId)) mapRef.current.removeLayer(layerId);
        if (mapRef.current.getSource(sourceId)) mapRef.current.removeSource(sourceId);
        previewRasterActiveRef.current = false;
      }
      return;
    }

    const res = previewSector?.resolution || 100;
    const refLat = previewSector?.origin.lat || 31.5;

    const raster = gridToImageUrl(previewGridCells, res, refLat);
    if (!raster) return;

    const existingSource = mapRef.current.getSource(sourceId) as maplibregl.ImageSource;
    if (existingSource) {
      existingSource.updateImage({ url: raster.url, coordinates: raster.coordinates });
    } else {
      mapRef.current.addSource(sourceId, {
        type: 'image',
        url: raster.url,
        coordinates: raster.coordinates,
      });
      mapRef.current.addLayer({
        id: layerId,
        type: 'raster',
        source: sourceId,
        paint: { 'raster-opacity': 0.85, 'raster-fade-duration': 0 },
      });
      previewRasterActiveRef.current = true;
    }
  }, [previewGridCells, previewSector, mapLoaded, mapRef]);

  // Event handler for popup action buttons (edit, delete)
  useEffect(() => {
    const handlePopupAction = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      const action = target.dataset.action;
      if (!action) return;

      e.preventDefault();
      e.stopPropagation();

      if (action === 'edit' && target.dataset.resultId) {
        editResultInPanel(target.dataset.resultId);
      } else if (action === 'delete' && target.dataset.resultId) {
        removeResult(target.dataset.resultId);
      } else if (action === 'delete-preview' && target.dataset.previewIndex !== undefined) {
        const idx = parseInt(target.dataset.previewIndex, 10);
        if (!isNaN(idx)) {
          if (previewDragHandler.current) {
            previewDragHandler.current(idx, NaN, NaN);
          }
        }
      }
    };

    document.addEventListener('click', handlePopupAction);
    return () => document.removeEventListener('click', handlePopupAction);
  }, [editResultInPanel, removeResult, previewDragHandler]);

  const calcDistance = useCallback(() => { if (measurePoints.length < 2) return 0; let t = 0; for (let i = 1; i < measurePoints.length; i++) t += haversineDistance(measurePoints[i-1].lat, measurePoints[i-1].lon, measurePoints[i].lat, measurePoints[i].lon); return t; }, [measurePoints]);
  const calcBearing = useCallback(() => measurePoints.length < 2 ? 0 : initialBearing(measurePoints[0].lat, measurePoints[0].lon, measurePoints[measurePoints.length-1].lat, measurePoints[measurePoints.length-1].lon), [measurePoints]);
  const calcArea = useCallback(() => measurePoints.length < 3 ? 0 : sphericalPolygonArea(measurePoints), [measurePoints]);
  const clearMeasure = () => { setMeasureMode('none'); setMeasurePoints([]); setMeasureFinished(false); };
  const startMeasure = (mode: MeasureMode) => { setMeasureMode(mode); setMeasurePoints([]); setMeasureFinished(false); };

  return (
    <div className={styles.container}>
      <div ref={mapContainer} className={styles.map} />
      {isMobile && <div className={styles.crosshair}><div className={styles.crosshairDot} /></div>}
      <div className={styles.leftControls}>
        <div className={styles.controlGroup}>
          <button className={`${styles.controlBtn} ${settingsOpen ? styles.active : ''}`} onClick={() => setSettingsOpen(!settingsOpen)} title={t('los.map.settings')}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="3"/><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/></svg></button>
          {settingsOpen && <div className={styles.settingsPanel}>
            <div className={styles.settingGroup}><span className={styles.settingLabel}>{t('los.map.display')}</span><div className={styles.settingBtns}><button className={`${styles.settingBtn} ${basemap==='map'?styles.active:''}`} onClick={()=>setBasemap('map')}>{t('los.map.mapView')}</button><button className={`${styles.settingBtn} ${basemap==='satellite'?styles.active:''}`} onClick={()=>setBasemap('satellite')}>{t('los.map.satellite')}</button></div></div>
            <div className={styles.settingDivider}/>
            <div className={styles.settingGroup}><div className={styles.settingRow}><span className={styles.settingLabel}>{t('los.map.elevationMap')}</span><button className={`${styles.toggleBtn} ${elevationTintVisible?styles.active:''}`} onClick={()=>setElevationTintVisible(!elevationTintVisible)}>{elevationTintVisible?t('los.map.active'):t('los.map.inactive')}</button></div>
              {elevationTintVisible && <><div className={styles.settingRow}><span className={styles.settingLabel}>{t('los.map.scale')}</span><div className={styles.settingBtns}><button className={`${styles.settingBtn} ${styles.small} ${scaleMode==='fixed'?styles.active:''}`} onClick={()=>setScaleMode('fixed')}>{t('los.map.fixed')}</button><button className={`${styles.settingBtn} ${styles.small} ${scaleMode==='viewport'?styles.active:''}`} onClick={()=>setScaleMode('viewport')}>{t('los.map.display')}</button></div></div><div className={styles.settingRow}><span className={styles.settingLabel}>{t('los.map.opacity')}</span><input type="range" min="0.1" max="1" step="0.05" value={elevationOpacity} onChange={e=>setElevationOpacity(parseFloat(e.target.value))} className={styles.opacitySlider}/></div></>}
            </div>
            <div className={styles.settingDivider}/>
            <div className={styles.settingGroup}><div className={styles.settingRow}><span className={styles.settingLabel}>{t('los.map.boundaries')}</span><button className={`${styles.toggleBtn} ${showBoundaries?styles.active:''}`} onClick={()=>setShowBoundaries(!showBoundaries)}>{showBoundaries?t('los.map.active'):t('los.map.inactive')}</button></div></div>
          </div>}
        </div>
        <div className={styles.controlGroup}>
          <button className={`${styles.controlBtn} ${measureMode!=='none'?styles.active:''}`} onClick={()=>measureMode==='none'?startMeasure('distance'):clearMeasure()} title={t('los.map.measurements')}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M22 2L2 22M16 2h6v6M2 16v6h6"/></svg></button>
          {measureMode !== 'none' && <div className={styles.measurePanel}>
            <div className={styles.measureTabs}><button className={measureMode==='distance'?styles.active:''} onClick={()=>startMeasure('distance')}>{t('los.map.distance')}</button><button className={measureMode==='area'?styles.active:''} onClick={()=>startMeasure('area')}>{t('los.map.area')}</button></div>
            {measurePoints.length > 0 && <div className={styles.measureResults}>
              <div className={styles.measureRow}><span className={styles.measureLabel}>{t('los.map.distance')}:</span><span className={styles.measureValue}>{formatDistance(calcDistance())}</span></div>
              {measureMode === 'distance' && measurePoints.length >= 2 && <div className={styles.measureRow}><span className={styles.measureLabel}>{t('los.map.azimuth')}:</span><span className={styles.measureValue}>{calcBearing().toFixed(1)}°</span></div>}
              {measureMode === 'area' && measurePoints.length >= 3 && <div className={styles.measureRow}><span className={styles.measureLabel}>{t('los.map.area')}:</span><span className={styles.measureValue}>{formatArea(calcArea())}</span></div>}
              <button onClick={clearMeasure} className={styles.clearBtn}>{t('los.map.clear')}</button>
            </div>}
            {measurePoints.length === 0 && <div className={styles.measureHint}>{t('los.map.clickMapHint')}<br/>{t('los.map.doubleClickFinish')}</div>}
          </div>}
        </div>
      </div>
      <div className={styles.bottomBar}>
        <div className={styles.searchSection} ref={searchSectionRef}>
          <div className={styles.searchInputWrapper}>
            <input type="text" className={styles.searchInput} placeholder={t('los.map.searchPlaceholder')} value={searchQuery} onChange={e=>setSearchQuery(e.target.value)} onKeyDown={e=>{if(e.key==='Enter')handleSearch(searchQuery);if(e.key==='Escape')setShowSearchResults(false);}} onFocus={()=>searchResults.length>0&&setShowSearchResults(true)}/>
            <button className={styles.searchBtn} onClick={()=>handleSearch(searchQuery)}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/></svg></button>
          </div>
          {showSearchResults && searchResults.length > 0 && <div className={styles.searchResults}>{searchResults.map((r,i)=><button key={i} className={styles.searchResultItem} onClick={()=>handleSearchResultClick(r)}>{r.displayName.split(',').slice(0,2).join(', ')}</button>)}</div>}
        </div>
        <div className={styles.infoSection}>
          {cursorPosition ? <><div className={styles.infoItem}><span className={styles.infoLabel}>{t('los.map.position')}</span><span className={styles.infoValue} dir="ltr">{cursorPosition.lat.toFixed(5)}, {cursorPosition.lng.toFixed(5)}</span></div><div className={styles.infoDivider}/><div className={styles.infoItem}><span className={styles.infoLabel}>{t('los.map.elevation')}</span><span className={`${styles.infoValue} ${styles.elevation}`}>{elevationLoading ? <span className={styles.loadingDots}>{t('los.map.loadingElev')}</span> : elevation !== null ? `${Math.round(elevation)} מ'` : '—'}</span></div></> : <div className={styles.infoPlaceholder}>{t('los.map.moveMouseHint')}</div>}
        </div>
        <div className={styles.resultsCount}>
          {state.results.length > 0 && (
            <span className={styles.resultsCountBadge}>
              {getVisibleResults().length}/{state.results.length} {t('los.map.resultsCount')}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
