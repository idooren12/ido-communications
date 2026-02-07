import React, { useRef, useEffect, useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import maplibregl from 'maplibre-gl';
import { ISRAEL_CENTER, ISRAEL_DEFAULT_ZOOM, ELEVATION_RANGES, TERRAIN_CONFIG, BASEMAP_SOURCES } from '../../utils/los/constants';
import { haversineDistance, initialBearing, sphericalPolygonArea, formatDistance, formatArea, type LatLon } from '../../utils/los/geo';
import { useIsMobile, useElevation } from '../../utils/los/hooks';
import { sampleElevationAtLngLat, calculateViewportMinMax } from '../../utils/los/elevation';
import { registerElevtintProtocol, updateElevationLUT, getTintTilesTemplate } from '../../utils/los/elevtintProtocol';
import type { GeocodingResult } from '../../utils/los/geocoding';
import styles from './ElevationMap.module.css';

type MeasureMode = 'none' | 'distance' | 'area';
type ScaleMode = 'fixed' | 'viewport';

export default function ElevationMap() {
  const { t } = useTranslation();
  const mapContainer = useRef<HTMLDivElement>(null);
  const map = useRef<maplibregl.Map | null>(null);
  const searchMarkerRef = useRef<{ marker: maplibregl.Marker; popup: maplibregl.Popup } | null>(null);

  const [mapLoaded, setMapLoaded] = useState(false);
  const [basemap, setBasemap] = useState<'map' | 'satellite'>('satellite');
  const [elevationTintVisible, setElevationTintVisible] = useState(false);
  const [elevationOpacity, setElevationOpacity] = useState(0.7);
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
    if (!map.current) return;
    setShowSearchResults(false);
    setSearchQuery(result.displayName.split(',')[0]);
    map.current.flyTo({ center: [result.lon, result.lat], zoom: 14, duration: 1500 });
    if (searchMarkerRef.current) { searchMarkerRef.current.marker.remove(); searchMarkerRef.current.popup.remove(); }
    const elev = await sampleElevationAtLngLat(result.lon, result.lat, 12, TERRAIN_CONFIG.url, TERRAIN_CONFIG.encoding);
    const el = document.createElement('div'); el.className = styles.searchMarker;
    const elevLabel = t('los.map.elevation');
    const elevValue = elev !== null ? `${Math.round(elev)} ${t('los.map.metersShort')}` : t('los.map.notAvailable');
    const popup = new maplibregl.Popup({ offset: 25 }).setHTML(`<div style="direction:rtl;padding:4px;"><div style="font-weight:600;">${result.displayName.split(',').slice(0,2).join(', ')}</div><div style="font-size:12px;color:#888;">${result.lat.toFixed(5)}, ${result.lon.toFixed(5)}<br/><span style="color:#22d3ee;">${elevLabel}: ${elevValue}</span></div></div>`);
    const marker = new maplibregl.Marker({ element: el }).setLngLat([result.lon, result.lat]).setPopup(popup).addTo(map.current);
    popup.addTo(map.current);
    searchMarkerRef.current = { marker, popup };
    setTimeout(() => popup.remove(), 5000);
  }, [t]);

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

  useEffect(() => {
    if (!mapContainer.current || map.current) return;
    registerElevtintProtocol({ terrainUrl: TERRAIN_CONFIG.url, minElevation: ELEVATION_RANGES.fixed.min, maxElevation: ELEVATION_RANGES.fixed.max });
    const mapInstance = new maplibregl.Map({
      container: mapContainer.current,
      style: {
        version: 8,
        sources: { 'carto-dark': BASEMAP_SOURCES.cartoDark, 'esri-satellite': BASEMAP_SOURCES.esriSatellite, 'carto-labels': BASEMAP_SOURCES.cartoLabels },
        layers: [
          { id: 'carto-dark-layer', type: 'raster', source: 'carto-dark', layout: { visibility: 'none' } },
          { id: 'esri-satellite-layer', type: 'raster', source: 'esri-satellite', layout: { visibility: 'visible' } },
          { id: 'carto-labels-layer', type: 'raster', source: 'carto-labels', layout: { visibility: 'visible' } },
        ],
      },
      center: ISRAEL_CENTER, zoom: ISRAEL_DEFAULT_ZOOM, minZoom: 5, maxZoom: 16,
    });
    mapInstance.addControl(new maplibregl.NavigationControl(), 'top-left');
    mapInstance.on('load', () => {
      setMapLoaded(true);
      mapInstance.addSource('terrain-dem', { type: 'raster-dem', tiles: [TERRAIN_CONFIG.url], tileSize: 256, encoding: 'terrarium' });
      mapInstance.addSource('elevation-tint', { type: 'raster', tiles: [getTintTilesTemplate()], tileSize: 256 });
      mapInstance.addLayer({ id: 'elevation-tint-layer', type: 'raster', source: 'elevation-tint', paint: { 'raster-opacity': 0.7 }, layout: { visibility: 'none' } }, 'carto-labels-layer');
      mapInstance.addLayer({ id: 'hillshade-layer', type: 'hillshade', source: 'terrain-dem', paint: { 'hillshade-exaggeration': 0.4, 'hillshade-shadow-color': 'rgba(0,0,0,0.4)' }, layout: { visibility: 'none' } }, 'elevation-tint-layer');

      // Load boundaries with error handling - use smaller 110m resolution
      fetch('https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_110m_admin_0_boundary_lines_land.geojson')
        .then(r => r.ok ? r.json() : Promise.reject('Failed'))
        .then(data => {
          mapInstance.addSource('boundaries', { type: 'geojson', data });
          mapInstance.addLayer({ id: 'boundaries-layer', type: 'line', source: 'boundaries', paint: { 'line-color': 'rgba(255,255,255,0.3)', 'line-width': 1 } });
        })
        .catch(e => console.warn('Could not load boundaries:', e));

      mapInstance.addSource('measure-source', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
      mapInstance.addLayer({ id: 'measure-line', type: 'line', source: 'measure-source', filter: ['==', '$type', 'LineString'], paint: { 'line-color': '#22d3ee', 'line-width': 3, 'line-dasharray': [2, 1] } });
      mapInstance.addLayer({ id: 'measure-fill', type: 'fill', source: 'measure-source', filter: ['==', '$type', 'Polygon'], paint: { 'fill-color': '#22d3ee', 'fill-opacity': 0.15 } });
      mapInstance.addLayer({ id: 'measure-points', type: 'circle', source: 'measure-source', filter: ['==', '$type', 'Point'], paint: { 'circle-radius': 5, 'circle-color': '#22d3ee', 'circle-stroke-width': 2, 'circle-stroke-color': '#fff' } });

      // DSM bounds layer
      mapInstance.addSource('dsm-bounds', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
      mapInstance.addLayer({ id: 'dsm-bounds-fill', type: 'fill', source: 'dsm-bounds', paint: { 'fill-color': '#f59e0b', 'fill-opacity': 0.1 } });
      mapInstance.addLayer({ id: 'dsm-bounds-line', type: 'line', source: 'dsm-bounds', paint: { 'line-color': '#f59e0b', 'line-width': 2, 'line-dasharray': [4, 2] } });

      // Load DSM bounds and subscribe to changes
      updateDSMBounds(mapInstance);
      import('../../utils/los/customDSM').then(dsmModule => {
        dsmModule.onLayersChange(() => updateDSMBounds(mapInstance));
      }).catch(() => {});
    });
    const handleMove = (e: maplibregl.MapMouseEvent | maplibregl.MapTouchEvent) => setCursorPosition({ lng: e.lngLat.lng, lat: e.lngLat.lat });
    mapInstance.on('mousemove', handleMove);
    mapInstance.on('touchmove', handleMove);
    mapInstance.on('moveend', () => { setZoom(mapInstance.getZoom()); if (isMobile) { const c = mapInstance.getCenter(); setCursorPosition({ lng: c.lng, lat: c.lat }); } });
    mapInstance.on('mouseout', () => { if (!isMobile) setCursorPosition(null); });
    map.current = mapInstance;
    return () => { mapInstance.remove(); map.current = null; };
  }, [isMobile, updateDSMBounds]);

  useEffect(() => {
    if (!map.current || !mapLoaded) return;
    map.current.setLayoutProperty('carto-dark-layer', 'visibility', basemap === 'map' ? 'visible' : 'none');
    map.current.setLayoutProperty('esri-satellite-layer', 'visibility', basemap === 'satellite' ? 'visible' : 'none');
    map.current.setLayoutProperty('carto-labels-layer', 'visibility', 'visible');
  }, [basemap, mapLoaded]);

  useEffect(() => {
    if (!map.current || !mapLoaded) return;
    const v = elevationTintVisible ? 'visible' : 'none';
    map.current.getLayer('elevation-tint-layer') && map.current.setLayoutProperty('elevation-tint-layer', 'visibility', v);
    map.current.getLayer('elevation-tint-layer') && map.current.setPaintProperty('elevation-tint-layer', 'raster-opacity', elevationOpacity);
    map.current.getLayer('hillshade-layer') && map.current.setLayoutProperty('hillshade-layer', 'visibility', v);
  }, [elevationTintVisible, elevationOpacity, mapLoaded]);

  useEffect(() => {
    if (!map.current || !mapLoaded) return;
    map.current.getLayer('boundaries-layer') && map.current.setLayoutProperty('boundaries-layer', 'visibility', showBoundaries ? 'visible' : 'none');
  }, [showBoundaries, mapLoaded]);

  useEffect(() => {
    if (!map.current || !mapLoaded) return;

    const safeSetTiles = () => {
      try {
        const source = map.current?.getSource('elevation-tint') as maplibregl.RasterTileSource;
        if (source && typeof source.setTiles === 'function') {
          source.setTiles([getTintTilesTemplate()]);
        }
      } catch (e) {
        console.warn('Could not update tint tiles:', e);
      }
    };

    if (scaleMode === 'fixed') {
      updateElevationLUT(ELEVATION_RANGES.fixed.min, ELEVATION_RANGES.fixed.max);
      // Delay to ensure source is ready
      setTimeout(safeSetTiles, 100);
      return;
    }
    const update = async () => {
      if (!map.current) return;
      const b = map.current.getBounds();
      const result = await calculateViewportMinMax({ west: b.getWest(), south: b.getSouth(), east: b.getEast(), north: b.getNorth() }, Math.floor(map.current.getZoom()), TERRAIN_CONFIG.url, TERRAIN_CONFIG.encoding);
      if (result) {
        updateElevationLUT(result.min, result.max);
        safeSetTiles();
      }
    };
    // Delay initial update
    const timeout = setTimeout(update, 100);
    map.current.on('moveend', update);
    return () => { clearTimeout(timeout); map.current?.off('moveend', update); };
  }, [scaleMode, mapLoaded]);

  useEffect(() => {
    if (!map.current || measureMode === 'none' || measureFinished) return;
    const handleClick = (e: maplibregl.MapMouseEvent) => setMeasurePoints(prev => [...prev, { lat: e.lngLat.lat, lon: e.lngLat.lng }]);
    const handleDblClick = (e: maplibregl.MapMouseEvent) => { e.preventDefault(); setMeasureFinished(true); };
    map.current.on('click', handleClick);
    map.current.on('dblclick', handleDblClick);
    map.current.getCanvas().style.cursor = 'crosshair';
    return () => { map.current?.off('click', handleClick); map.current?.off('dblclick', handleDblClick); if (map.current) map.current.getCanvas().style.cursor = ''; };
  }, [measureMode, measureFinished]);

  useEffect(() => {
    if (!map.current || !mapLoaded) return;
    const source = map.current.getSource('measure-source') as maplibregl.GeoJSONSource;
    if (!source) return;
    const features: GeoJSON.Feature[] = [];
    measurePoints.forEach((p, i) => features.push({ type: 'Feature', properties: { index: i }, geometry: { type: 'Point', coordinates: [p.lon, p.lat] } }));
    if (measurePoints.length >= 2) {
      const coords = measurePoints.map(p => [p.lon, p.lat]);
      if (measureMode === 'area' && measurePoints.length >= 3) features.push({ type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [[...coords, coords[0]]] } });
      else features.push({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: coords } });
    }
    source.setData({ type: 'FeatureCollection', features });
  }, [measurePoints, measureMode, mapLoaded]);

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
              {elevationTintVisible && <><div className={styles.settingRow}><span className={styles.settingLabel}>{t('los.map.scale')}</span><div className={styles.settingBtns}><button className={`${styles.settingBtn} ${styles.small} ${scaleMode==='fixed'?styles.active:''}`} onClick={()=>setScaleMode('fixed')}>{t('los.map.fixed')}</button><button className={`${styles.settingBtn} ${styles.small} ${scaleMode==='viewport'?styles.active:''}`} onClick={()=>setScaleMode('viewport')}>{t('los.map.viewport')}</button></div></div><div className={styles.settingRow}><span className={styles.settingLabel}>{t('los.map.opacity')}</span><input type="range" min="0.1" max="1" step="0.05" value={elevationOpacity} onChange={e=>setElevationOpacity(parseFloat(e.target.value))} className={styles.opacitySlider}/></div></>}
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
        <div className={styles.searchSection}>
          <div className={styles.searchInputWrapper}>
            <input type="text" className={styles.searchInput} placeholder={t('los.map.searchPlaceholder')} value={searchQuery} onChange={e=>setSearchQuery(e.target.value)} onKeyDown={e=>e.key==='Enter'&&handleSearch(searchQuery)} onFocus={()=>searchResults.length>0&&setShowSearchResults(true)}/>
            <button className={styles.searchBtn} onClick={()=>handleSearch(searchQuery)}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/></svg></button>
          </div>
          {showSearchResults && searchResults.length > 0 && <div className={styles.searchResults}>{searchResults.map((r,i)=><button key={i} className={styles.searchResultItem} onClick={()=>handleSearchResultClick(r)}>{r.displayName.split(',').slice(0,2).join(', ')}</button>)}</div>}
        </div>
        <div className={styles.infoSection}>
          {cursorPosition ? <><div className={styles.infoItem}><span className={styles.infoLabel}>{t('los.map.position')}</span><span className={styles.infoValue} dir="ltr">{cursorPosition.lat.toFixed(5)}, {cursorPosition.lng.toFixed(5)}</span></div><div className={styles.infoDivider}/><div className={styles.infoItem}><span className={styles.infoLabel}>{t('los.map.elevation')}</span><span className={`${styles.infoValue} ${styles.elevation}`}>{elevationLoading ? <span className={styles.loadingDots}>{t('los.map.loadingElev')}</span> : elevation !== null ? `${Math.round(elevation)} ${t('los.map.metersShort')}` : '—'}</span></div></> : <div className={styles.infoPlaceholder}>{t('los.map.moveMouseHint')}</div>}
        </div>
      </div>
    </div>
  );
}
