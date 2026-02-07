import React, { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import maplibregl from 'maplibre-gl';
import { calculateLOS, type LOSPoint, RF_FREQUENCIES } from '../../utils/los/los';
import { calculateBatchLOSAsync } from '../../utils/los/workers/workerPool';
import { haversineDistance, destinationPoint, metersToDegreesLat, metersToDegreesLon } from '../../utils/los/geo';
import { ISRAEL_CENTER, TERRAIN_CONFIG, BASEMAP_SOURCES } from '../../utils/los/constants';
import styles from './LOSAreaCalculator.module.css';

interface GridCell { lat: number; lon: number; clear: boolean | null; fresnelClear?: boolean | null; }
interface Props { initialState?: any; onStateChange?: (state: any) => void; }

type CalculationMode = 'optical' | 'rf';

export default function LOSAreaCalculator({ initialState, onStateChange }: Props) {
  const { t } = useTranslation();
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const originMarkerRef = useRef<maplibregl.Marker | null>(null);
  const cancelRef = useRef(false);
  const pickingOriginRef = useRef(false);

  const [mapLoaded, setMapLoaded] = useState(false);
  const [basemap, setBasemap] = useState<'map' | 'satellite'>('map');
  const [pickingOrigin, setPickingOrigin] = useState(false);

  const [lat, setLat] = useState(initialState?.lat || '');
  const [lon, setLon] = useState(initialState?.lon || '');
  const [height, setHeight] = useState(initialState?.height || '10');
  const [targetHeight, setTargetHeight] = useState(initialState?.targetHeight || '2');
  const [distanceUnit, setDistanceUnit] = useState<'m' | 'km'>('m');
  const [minDistance, setMinDistance] = useState(initialState?.minDistance || '100');
  const [maxDistance, setMaxDistance] = useState(initialState?.maxDistance || '5000');
  const [minAzimuth, setMinAzimuth] = useState(initialState?.minAzimuth || '0');
  const [maxAzimuth, setMaxAzimuth] = useState(initialState?.maxAzimuth || '360');
  const [resolution, setResolution] = useState(initialState?.resolution || '100');

  const [calcMode, setCalcMode] = useState<CalculationMode>('optical');
  const [rfFrequency, setRfFrequency] = useState<string>('2.4GHz');

  const [gridCells, setGridCells] = useState<GridCell[]>([]);
  const [progress, setProgress] = useState(0);
  const [calculating, setCalculating] = useState(false);
  const [calcTime, setCalcTime] = useState<number | null>(null);

  useEffect(() => { pickingOriginRef.current = pickingOrigin; }, [pickingOrigin]);
  useEffect(() => { onStateChange?.({ lat, lon, height, targetHeight, minDistance, maxDistance, minAzimuth, maxAzimuth, resolution }); }, [lat, lon, height, targetHeight, minDistance, maxDistance, minAzimuth, maxAzimuth, resolution, onStateChange]);
  useEffect(() => { setGridCells([]); setCalcTime(null); }, [lat, lon, height, targetHeight, minDistance, maxDistance, minAzimuth, maxAzimuth, resolution, calcMode, rfFrequency]);

  const toMeters = useCallback((val: string) => { const n = parseFloat(val) || 0; return distanceUnit === 'km' ? n * 1000 : n; }, [distanceUnit]);

  const origin = useMemo(() => {
    const la = parseFloat(lat), lo = parseFloat(lon);
    return isNaN(la) || isNaN(lo) ? null : { lat: la, lon: lo };
  }, [lat, lon]);

  const estimatedPointCount = useMemo(() => {
    if (!origin) return 0;
    const minD = toMeters(minDistance), maxD = toMeters(maxDistance), res = parseFloat(resolution) || 100;
    const minAz = parseFloat(minAzimuth) || 0, maxAz = parseFloat(maxAzimuth) || 360;
    const avgDist = (minD + maxD) / 2;
    const radialSteps = Math.ceil((maxD - minD) / res);
    const normMinAz = ((minAz % 360) + 360) % 360;
    const normMaxAz = ((maxAz % 360) + 360) % 360;
    const azRange = normMinAz <= normMaxAz ? normMaxAz - normMinAz : (360 - normMinAz) + normMaxAz;
    const circumference = 2 * Math.PI * avgDist;
    const angularRes = Math.max(1, (res / circumference) * 360);
    const angularSteps = Math.ceil((azRange || 360) / angularRes);
    return radialSteps * angularSteps;
  }, [origin, minDistance, maxDistance, resolution, minAzimuth, maxAzimuth, toMeters]);

  const handleMapClick = useCallback((e: maplibregl.MapMouseEvent) => {
    if (pickingOriginRef.current) {
      setLat(e.lngLat.lat.toFixed(6));
      setLon(e.lngLat.lng.toFixed(6));
      setPickingOrigin(false);
      setGridCells([]);
    }
  }, []);

  const createDraggableMarker = useCallback((latVal: number, lonVal: number): maplibregl.Marker => {
    const el = document.createElement('div');
    el.className = styles.markerOrigin;
    el.innerHTML = `<svg width="20" height="20" viewBox="0 0 24 24" fill="#3b82f6"><circle cx="12" cy="12" r="8" stroke="white" stroke-width="2"/></svg>`;
    const marker = new maplibregl.Marker({ element: el, draggable: true }).setLngLat([lonVal, latVal]);
    marker.on('dragend', () => { const ll = marker.getLngLat(); setLat(ll.lat.toFixed(6)); setLon(ll.lng.toFixed(6)); setGridCells([]); });
    return marker;
  }, []);

  // Map initialization
  useEffect(() => {
    if (!mapContainerRef.current || mapRef.current) return;
    const map = new maplibregl.Map({
      container: mapContainerRef.current,
      style: {
        version: 8,
        sources: {
          'carto-dark': { ...BASEMAP_SOURCES.cartoDark, maxzoom: 20 },
          'esri-satellite': { ...BASEMAP_SOURCES.esriSatellite, maxzoom: 19 },
          'carto-labels': { ...BASEMAP_SOURCES.cartoLabels, maxzoom: 20 }
        },
        layers: [
          { id: 'carto-dark-layer', type: 'raster', source: 'carto-dark', layout: { visibility: 'visible' } },
          { id: 'esri-satellite-layer', type: 'raster', source: 'esri-satellite', layout: { visibility: 'none' } },
          { id: 'carto-labels-layer', type: 'raster', source: 'carto-labels', layout: { visibility: 'none' } }
        ]
      },
      center: ISRAEL_CENTER,
      zoom: 8,
      minZoom: 0.5,
      maxZoom: 22,
    });
    map.addControl(new maplibregl.NavigationControl(), 'top-left');
    map.on('load', () => {
      setMapLoaded(true);
      map.addSource('coverage', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
      map.addLayer({
        id: 'coverage-layer',
        type: 'fill',
        source: 'coverage',
        paint: {
          'fill-color': [
            'case',
            ['==', ['get', 'status'], 'clear'], '#10b981',
            ['==', ['get', 'status'], 'fresnel'], '#f59e0b',
            '#f43f5e'
          ],
          'fill-opacity': 0.7
        }
      });

      // DSM bounds layer
      map.addSource('dsm-bounds', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
      map.addLayer({ id: 'dsm-bounds-fill', type: 'fill', source: 'dsm-bounds', paint: { 'fill-color': '#f59e0b', 'fill-opacity': 0.1 } });
      map.addLayer({ id: 'dsm-bounds-line', type: 'line', source: 'dsm-bounds', paint: { 'line-color': '#f59e0b', 'line-width': 2, 'line-dasharray': [4, 2] } });

      // Load DSM bounds
      import('../../utils/los/customDSM').then(dsmModule => {
        const updateBounds = () => {
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
          (map.getSource('dsm-bounds') as maplibregl.GeoJSONSource)?.setData({ type: 'FeatureCollection', features });
        };
        updateBounds();
        dsmModule.onLayersChange(updateBounds);
      }).catch(() => {});
    });
    map.on('click', handleMapClick);
    mapRef.current = map;
    return () => { map.off('click', handleMapClick); map.remove(); mapRef.current = null; };
  }, [handleMapClick]);

  useEffect(() => { if (mapRef.current) mapRef.current.getCanvas().style.cursor = pickingOrigin ? 'crosshair' : ''; }, [pickingOrigin]);

  // Update basemap
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoaded) return;
    map.setLayoutProperty('carto-dark-layer', 'visibility', basemap === 'map' ? 'visible' : 'none');
    map.setLayoutProperty('esri-satellite-layer', 'visibility', basemap === 'satellite' ? 'visible' : 'none');
    map.setLayoutProperty('carto-labels-layer', 'visibility', basemap === 'satellite' ? 'visible' : 'none');
  }, [basemap, mapLoaded]);

  // Update origin marker
  useEffect(() => {
    if (!mapRef.current || !mapLoaded) return;
    if (origin) {
      if (originMarkerRef.current) {
        originMarkerRef.current.setLngLat([origin.lon, origin.lat]);
      } else {
        originMarkerRef.current = createDraggableMarker(origin.lat, origin.lon);
        originMarkerRef.current.addTo(mapRef.current);
        mapRef.current.flyTo({ center: [origin.lon, origin.lat], zoom: 12 });
      }
    } else if (originMarkerRef.current) {
      originMarkerRef.current.remove();
      originMarkerRef.current = null;
    }
  }, [origin, mapLoaded, createDraggableMarker]);

  // Update coverage layer
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoaded || gridCells.length === 0) return;

    const res = parseFloat(resolution) || 100;
    const features = gridCells
      .filter(c => c.clear !== null)
      .map(cell => {
        const dLat = metersToDegreesLat(res / 2);
        const dLon = metersToDegreesLon(res / 2, cell.lat);
        let status = cell.clear ? 'clear' : 'blocked';
        if (cell.clear && calcMode === 'rf' && cell.fresnelClear === false) status = 'fresnel';
        return {
          type: 'Feature' as const,
          geometry: {
            type: 'Polygon' as const,
            coordinates: [[
              [cell.lon - dLon, cell.lat - dLat],
              [cell.lon + dLon, cell.lat - dLat],
              [cell.lon + dLon, cell.lat + dLat],
              [cell.lon - dLon, cell.lat + dLat],
              [cell.lon - dLon, cell.lat - dLat],
            ]],
          },
          properties: { status },
        };
      });

    (map.getSource('coverage') as maplibregl.GeoJSONSource)?.setData({ type: 'FeatureCollection', features });
  }, [gridCells, mapLoaded, resolution, calcMode]);

  // Calculate coverage
  const handleCalculate = async () => {
    if (!origin) return;
    cancelRef.current = false;
    setCalculating(true);
    setProgress(0);
    setGridCells([]);
    const startTime = performance.now();

    const minD = toMeters(minDistance), maxD = toMeters(maxDistance), res = parseFloat(resolution) || 100;
    const minAz = parseFloat(minAzimuth) || 0, maxAz = parseFloat(maxAzimuth) || 360;
    const originPoint: LOSPoint = { lat: origin.lat, lon: origin.lon, antennaHeight: parseFloat(height) || 10 };

    // Generate all target points with wrap-around azimuth support
    const points: { lat: number; lon: number }[] = [];
    for (let d = Math.max(res, minD); d <= maxD; d += res) {
      const circumference = 2 * Math.PI * d;
      const angularRes = Math.max(0.5, (res / circumference) * 360);

      // Normalize azimuths to 0-360 range
      const normMinAz = ((minAz % 360) + 360) % 360;
      const normMaxAz = ((maxAz % 360) + 360) % 360;

      if (normMinAz === normMaxAz || (normMinAz === 0 && normMaxAz === 360)) {
        // Full circle
        for (let az = 0; az < 360; az += angularRes) {
          const p = destinationPoint(origin.lat, origin.lon, az, d);
          points.push(p);
        }
      } else if (normMinAz < normMaxAz) {
        // Normal range (e.g., 45° to 135°)
        for (let az = normMinAz; az <= normMaxAz; az += angularRes) {
          const p = destinationPoint(origin.lat, origin.lon, az, d);
          points.push(p);
        }
      } else {
        // Wrap-around range (e.g., 270° to 90°)
        for (let az = normMinAz; az < 360; az += angularRes) {
          const p = destinationPoint(origin.lat, origin.lon, az, d);
          points.push(p);
        }
        for (let az = 0; az <= normMaxAz; az += angularRes) {
          const p = destinationPoint(origin.lat, origin.lon, az, d);
          points.push(p);
        }
      }
    }

    const options: any = {};
    if (calcMode === 'rf') {
      options.frequencyMHz = RF_FREQUENCIES[rfFrequency as keyof typeof RF_FREQUENCIES];
    }

    // Use Worker Pool for parallel calculation
    const tasks = points.map(point => ({
      pointA: originPoint,
      pointB: { lat: point.lat, lon: point.lon, antennaHeight: parseFloat(targetHeight) || 2 },
      options,
    }));

    try {
      const results = await calculateBatchLOSAsync(tasks, (completed, total) => {
        if (!cancelRef.current) {
          setProgress(Math.round(completed / total * 100));
        }
      });

      if (!cancelRef.current) {
        const finalResults: GridCell[] = results.map((r: any, i: number) => ({
          lat: points[i].lat,
          lon: points[i].lon,
          clear: r?.clear ?? null,
          fresnelClear: r?.fresnelClear,
        }));
        setGridCells(finalResults);
      }
    } catch (e) {
      console.error('Worker calculation failed:', e);
    }

    setCalcTime(performance.now() - startTime);
    setCalculating(false);
  };

  const handleCancel = () => { cancelRef.current = true; setCalculating(false); };

  const stats = useMemo(() => {
    const withData = gridCells.filter(c => c.clear !== null);
    const noData = gridCells.length - withData.length;
    const clear = withData.filter(c => c.clear === true).length;
    const blocked = withData.filter(c => c.clear === false).length;
    const fresnelClear = withData.filter(c => c.clear === true && c.fresnelClear === true).length;
    const fresnelBlocked = withData.filter(c => c.clear === true && c.fresnelClear === false).length;

    return {
      totalCells: gridCells.length,
      withData: withData.length,
      noData,
      clear,
      blocked,
      percent: withData.length > 0 ? Math.round(clear / withData.length * 100) : 0,
      fresnelClear,
      fresnelBlocked,
      fresnelPercent: withData.length > 0 ? Math.round(fresnelClear / withData.length * 100) : 0,
    };
  }, [gridCells]);

  return (
    <div className={styles.container}>
      <div className={styles.mapSection}>
        <div ref={mapContainerRef} className={styles.map} />
        <div className={styles.mapControls}>
          <button className={`${styles.mapBtn} ${basemap === 'map' ? styles.active : ''}`} onClick={() => setBasemap('map')}>{t('los.map.mapView')}</button>
          <button className={`${styles.mapBtn} ${basemap === 'satellite' ? styles.active : ''}`} onClick={() => setBasemap('satellite')}>{t('los.map.satellite')}</button>
        </div>
        {pickingOrigin && <div className={styles.pickHint}>{t('los.losArea.clickMapPickPoint')}</div>}
        <div className={styles.legend}>
          <div className={styles.legendItem}><div className={`${styles.legendDot} ${styles.clear}`} /><span>{t('los.losArea.clear')}</span></div>
          <div className={styles.legendItem}><div className={`${styles.legendDot} ${styles.blocked}`} /><span>{t('los.losArea.blocked')}</span></div>
        </div>
      </div>

      <div className={styles.panel}>
        <div className={styles.panelContent}>
          <div className={styles.modeToggle}>
            <button className={`${styles.modeBtn} ${calcMode === 'optical' ? styles.active : ''}`} onClick={() => setCalcMode('optical')}>👁️ {t('los.losArea.optical')}</button>
            <button className={`${styles.modeBtn} ${calcMode === 'rf' ? styles.active : ''}`} onClick={() => setCalcMode('rf')}>📡 {t('los.losArea.rf')}</button>
          </div>
          {calcMode === 'rf' && <div className={styles.rfSettings}><label>{t('los.losArea.frequency')}</label><select value={rfFrequency} onChange={(e) => setRfFrequency(e.target.value)} className={styles.freqSelect}>{Object.keys(RF_FREQUENCIES).map(f => <option key={f} value={f}>{f}</option>)}</select></div>}

          <div className={styles.pointCard}>
            <div className={styles.pointHeader}><span className={styles.pointLabel}><span className={`${styles.pointDot} ${styles.pointA}`} />{t('los.losArea.origin')}</span><button className={`${styles.pickBtn} ${pickingOrigin ? styles.active : ''}`} onClick={() => setPickingOrigin(!pickingOrigin)}>{pickingOrigin ? '✕' : '📍'}</button></div>
            <div className={styles.coordsGrid}>
              <div className={styles.inputGroup}><span className={styles.inputLabel}>lat</span><input type="text" value={lat} onChange={e => setLat(e.target.value)} className={styles.input} placeholder="32.0853" /></div>
              <div className={styles.inputGroup}><span className={styles.inputLabel}>lon</span><input type="text" value={lon} onChange={e => setLon(e.target.value)} className={styles.input} placeholder="34.7818" /></div>
            </div>
            <div className={styles.heightRow}><label>{t('los.losArea.heightMeters')}</label><input type="number" value={height} onChange={e => setHeight(e.target.value)} className={styles.heightInput} /></div>
            {origin && <div className={styles.dragHint}>💡 {t('los.losArea.dragOnMap')}</div>}
          </div>

          <div className={styles.card}>
            <div className={styles.cardHeader}><span className={styles.cardTitle}>{t('los.losArea.parameters')}</span><div className={styles.unitToggle}><button className={distanceUnit === 'm' ? styles.active : ''} onClick={() => setDistanceUnit('m')}>{t('los.losArea.metersShort')}</button><button className={distanceUnit === 'km' ? styles.active : ''} onClick={() => setDistanceUnit('km')}>{t('los.losArea.kmShort')}</button></div></div>
            <div className={styles.paramsGrid}>
              <div className={styles.inputGroup}><span className={styles.inputLabel}>{t('los.losArea.minDistance')}</span><input type="number" value={minDistance} onChange={e => setMinDistance(e.target.value)} className={styles.input} /></div>
              <div className={styles.inputGroup}><span className={styles.inputLabel}>{t('los.losArea.maxDistance')}</span><input type="number" value={maxDistance} onChange={e => setMaxDistance(e.target.value)} className={styles.input} /></div>
              <div className={styles.inputGroup}><span className={styles.inputLabel}>{t('los.losArea.minAzimuth')}</span><input type="number" value={minAzimuth} onChange={e => setMinAzimuth(e.target.value)} className={styles.input} /></div>
              <div className={styles.inputGroup}><span className={styles.inputLabel}>{t('los.losArea.maxAzimuth')}</span><input type="number" value={maxAzimuth} onChange={e => setMaxAzimuth(e.target.value)} className={styles.input} /></div>
              <div className={styles.inputGroup}><span className={styles.inputLabel}>{t('los.losArea.resolution')}</span><input type="number" value={resolution} onChange={e => setResolution(e.target.value)} className={styles.input} /></div>
              <div className={styles.inputGroup}><span className={styles.inputLabel}>{t('los.losArea.targetHeight')}</span><input type="number" value={targetHeight} onChange={e => setTargetHeight(e.target.value)} className={styles.input} /></div>
            </div>
            <div className={styles.pointEstimate}>~{estimatedPointCount.toLocaleString()} {t('los.losArea.points')}</div>
          </div>

          {stats.totalCells > 0 && !calculating && (
            <div className={styles.resultCard}>
              <div className={styles.resultGrid}>
                <div className={styles.resultRow}><span>{t('los.losArea.total')}</span><span>{stats.totalCells.toLocaleString()}</span></div>
                <div className={styles.resultRow}><span>{t('los.losArea.coverage')}</span><span>{stats.percent}%</span></div>
                <div className={styles.statRow}><span className={styles.clearDot} /><span>{stats.clear.toLocaleString()} {t('los.losArea.clear')}</span></div>
                <div className={styles.statRow}><span className={styles.blockedDot} /><span>{stats.blocked.toLocaleString()} {t('los.losArea.blocked')}</span></div>
                {stats.noData > 0 && <div className={styles.statRow}><span className={styles.noDataDot} /><span>{stats.noData.toLocaleString()} {t('los.losArea.noData')}</span></div>}
                {calcTime && <div className={styles.resultRow}><span>{t('los.losArea.time')}</span><span>{calcTime < 60000 ? `${(calcTime / 1000).toFixed(1)}s` : `${Math.round(calcTime / 60000)}m`}</span></div>}
              </div>
            </div>
          )}

          <div className={styles.actions}>
            {calculating ? (
              <><div className={styles.progressBar}><div className={styles.progressFill} style={{ width: `${progress}%` }} /></div><span className={styles.progressText}>{progress}%</span><button className={styles.cancelBtn} onClick={handleCancel}>{t('los.losArea.cancel')}</button></>
            ) : (
              <><button className={styles.calculateBtn} onClick={handleCalculate} disabled={!origin}>{t('los.losArea.calculate')}</button>{gridCells.length > 0 && <button className={styles.clearBtn} onClick={() => { setGridCells([]); setCalcTime(null); }}>{t('los.losArea.clearResult')}</button>}</>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
