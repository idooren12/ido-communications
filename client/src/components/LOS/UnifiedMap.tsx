import { useRef, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import * as maplibregl from '../../utils/los/maplibre';
import { ISRAEL_DEFAULT_ZOOM, ELEVATION_RANGES, TERRAIN_CONFIG } from '../../utils/los/constants';
import { useIsMobile, useElevation } from '../../utils/los/hooks';
import { calculateViewportMinMax } from '../../utils/los/elevation';
import { updateElevationLUT, getTintTilesTemplate } from '../../utils/los/elevtintProtocol';
import { useLOSState } from '../../contexts/LOSContext';
import ElevationLegend from './ElevationLegend';
import styles from './UnifiedMap.module.css';
import { createLOSMap, addAppLayers, watchDSMBounds } from './map/mapSetup';
import { useMapSearch } from './map/useMapSearch';
import { useMeasure } from './map/useMeasure';
import { useElevationPolygon } from './map/useElevationPolygon';
import { usePreviewLayers } from './map/usePreviewLayers';
import { useResultLayers } from './map/useResultLayers';
import { usePreviewRaster } from './map/usePreviewRaster';
import SearchBox from './map/SearchBox';
import MeasurePanel from './map/MeasurePanel';

type ScaleMode = 'fixed' | 'viewport';

/**
 * The LOS map. Creates the MapLibre instance and the display settings (basemap,
 * elevation tint, boundaries); everything drawn on the map lives in ./map/use*.ts.
 */
export default function UnifiedMap() {
  const { t } = useTranslation();
  const { state, mapRef, updateMapState, getVisibleResults, mapClickHandler } = useLOSState();
  const mapContainer = useRef<HTMLDivElement>(null);
  const mapInitializedRef = useRef(false);

  const [mapLoaded, setMapLoaded] = useState(false);
  const [basemap, setBasemap] = useState<'map' | 'satellite'>(state.mapState.basemap);
  const [elevationTintVisible, setElevationTintVisible] = useState(state.mapState.elevationTintVisible);
  const [elevationOpacity, setElevationOpacity] = useState(state.mapState.elevationOpacity);
  const [scaleMode, setScaleMode] = useState<ScaleMode>('fixed');
  const [showBoundaries, setShowBoundaries] = useState(true);
  const [cursorPosition, setCursorPosition] = useState<{ lng: number; lat: number } | null>(null);
  const [zoom, setZoom] = useState(ISRAEL_DEFAULT_ZOOM);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [elevRange, setElevRange] = useState({ min: ELEVATION_RANGES.fixed.min, max: ELEVATION_RANGES.fixed.max });

  const isMobile = useIsMobile();
  const { elevation, loading: elevationLoading } = useElevation(cursorPosition, zoom, TERRAIN_CONFIG.url, TERRAIN_CONFIG.encoding);

  const search = useMapSearch();
  const measure = useMeasure(mapLoaded);
  const elevPolygon = useElevationPolygon({ setElevRange, setScaleMode });
  usePreviewLayers(mapLoaded);
  useResultLayers(mapLoaded);
  usePreviewRaster(mapLoaded);

  // Sync basemap with context (but don't trigger re-render of map)
  useEffect(() => {
    updateMapState({ basemap });
  }, [basemap, updateMapState]);

  useEffect(() => {
    updateMapState({ elevationTintVisible, elevationOpacity });
  }, [elevationTintVisible, elevationOpacity, updateMapState]);

  // Initialize map - ONLY ONCE
  useEffect(() => {
    if (!mapContainer.current || mapInitializedRef.current) return;
    mapInitializedRef.current = true;

    const mapInstance = createLOSMap(mapContainer.current);
    const stopWatchingDSM = watchDSMBounds(mapInstance);

    mapInstance.on('load', () => {
      addAppLayers(mapInstance);
      setMapLoaded(true);
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
      stopWatchingDSM();
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
    if (mapRef.current.getLayer('elevation-tint-layer')) {
      mapRef.current.setLayoutProperty('elevation-tint-layer', 'visibility', v);
      mapRef.current.setPaintProperty('elevation-tint-layer', 'raster-opacity', elevationOpacity);
    }
    if (mapRef.current.getLayer('hillshade-layer')) mapRef.current.setLayoutProperty('hillshade-layer', 'visibility', v);
  }, [elevationTintVisible, elevationOpacity, mapLoaded, mapRef]);

  // Update boundaries visibility
  useEffect(() => {
    if (!mapRef.current || !mapLoaded) return;
    if (mapRef.current.getLayer('boundaries-layer')) mapRef.current.setLayoutProperty('boundaries-layer', 'visibility', showBoundaries ? 'visible' : 'none');
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
      setElevRange({ min: ELEVATION_RANGES.fixed.min, max: ELEVATION_RANGES.fixed.max });
      setTimeout(safeSetTiles, 100);
      return;
    }
    const update = async () => {
      if (!mapRef.current) return;
      const b = mapRef.current.getBounds();
      const result = await calculateViewportMinMax({ west: b.getWest(), south: b.getSouth(), east: b.getEast(), north: b.getNorth() }, Math.floor(mapRef.current.getZoom()), TERRAIN_CONFIG.url, TERRAIN_CONFIG.encoding);
      if (result) {
        updateElevationLUT(result.min, result.max);
        setElevRange({ min: result.min, max: result.max });
        safeSetTiles();
      }
    };
    const timeout = setTimeout(update, 100);
    mapRef.current.on('moveend', update);
    return () => { clearTimeout(timeout); mapRef.current?.off('moveend', update); };
  }, [scaleMode, mapLoaded, mapRef]);

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
              {elevationTintVisible && <><div className={styles.settingRow}><span className={styles.settingLabel}>{t('los.map.scale')}</span><div className={styles.settingBtns}><button className={`${styles.settingBtn} ${styles.small} ${scaleMode==='fixed'?styles.active:''}`} onClick={()=>setScaleMode('fixed')}>{t('los.map.fixed')}</button><button className={`${styles.settingBtn} ${styles.small} ${scaleMode==='viewport'?styles.active:''}`} onClick={()=>setScaleMode('viewport')}>{t('los.map.display')}</button></div></div><div className={styles.settingRow}><span className={styles.settingLabel}>{t('los.map.opacity')}</span><input type="range" min="0.1" max="1" step="0.05" value={elevationOpacity} onChange={e=>setElevationOpacity(parseFloat(e.target.value))} className={styles.opacitySlider}/></div><div className={styles.settingRow}><span className={styles.settingLabel}>{t('los.map.polygon')}</span>{elevPolygon.drawing ? <button className={`${styles.toggleBtn} ${styles.active}`} onClick={elevPolygon.stopDrawing}>{t('los.map.elevDrawing')}</button> : elevPolygon.hasPolygon ? <button className={styles.toggleBtn} onClick={elevPolygon.clear}>{t('los.map.clearElevPolygon')}</button> : <button className={styles.toggleBtn} onClick={elevPolygon.startDrawing}>{t('los.map.drawElevPolygon')}</button>}</div>{elevPolygon.drawing && <div className={styles.measureHint}>{t('los.map.elevPolygonHint')}</div>}{elevPolygon.loading && <div className={styles.measureHint}>{t('common.loading')}</div>}</>}
            </div>
            <div className={styles.settingDivider}/>
            <div className={styles.settingGroup}><div className={styles.settingRow}><span className={styles.settingLabel}>{t('los.map.boundaries')}</span><button className={`${styles.toggleBtn} ${showBoundaries?styles.active:''}`} onClick={()=>setShowBoundaries(!showBoundaries)}>{showBoundaries?t('los.map.active'):t('los.map.inactive')}</button></div></div>
          </div>}
        </div>
        <MeasurePanel measure={measure} />
      </div>
      <ElevationLegend minElevation={elevRange.min} maxElevation={elevRange.max} visible={elevationTintVisible} />
      <div className={styles.bottomBar}>
        <SearchBox search={search} />
        <div className={styles.infoSection}>
          {cursorPosition ? <><div className={styles.infoItem}><span className={styles.infoLabel}>{t('los.map.position')}</span><span className={styles.infoValue} dir="ltr">{cursorPosition.lat.toFixed(5)}, {cursorPosition.lng.toFixed(5)}</span></div><div className={styles.infoDivider}/><div className={styles.infoItem}><span className={styles.infoLabel}>{t('los.map.elevation')}</span><span className={`${styles.infoValue} ${styles.elevation}`}>{elevationLoading ? <span className={styles.loadingDots}>{t('los.map.loadingElev')}</span> : elevation !== null ? `${Math.round(elevation)} ${t('los.map.metersShort')}` : '—'}</span></div></> : <div className={styles.infoPlaceholder}>{t('los.map.moveMouseHint')}</div>}
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
