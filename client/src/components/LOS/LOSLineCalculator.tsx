import React, { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import maplibregl from 'maplibre-gl';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, Area, ComposedChart } from 'recharts';
import { type LOSResult, type LOSPoint, RF_FREQUENCIES } from '../../utils/los/los';
import { calculateLOSAsync } from '../../utils/los/workers/workerPool';
import { haversineDistance, initialBearing, formatDistance } from '../../utils/los/geo';
import { ISRAEL_CENTER, BASEMAP_SOURCES } from '../../utils/los/constants';
import styles from './LOSLineCalculator.module.css';

type PickMode = 'none' | 'A' | 'B';
type CalculationMode = 'optical' | 'rf';

interface Props { initialState?: any; onStateChange?: (state: any) => void; }

export default function LOSLineCalculator({ initialState, onStateChange }: Props) {
  const { t } = useTranslation();
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const markerARef = useRef<maplibregl.Marker | null>(null);
  const markerBRef = useRef<maplibregl.Marker | null>(null);
  const pickModeRef = useRef<PickMode>('none');

  const [mapLoaded, setMapLoaded] = useState(false);
  const [basemap, setBasemap] = useState<'map' | 'satellite'>('map');
  const [pickMode, setPickMode] = useState<PickMode>('none');
  const [latA, setLatA] = useState(initialState?.latA || '');
  const [lonA, setLonA] = useState(initialState?.lonA || '');
  const [heightA, setHeightA] = useState(initialState?.heightA || '2');
  const [latB, setLatB] = useState(initialState?.latB || '');
  const [lonB, setLonB] = useState(initialState?.lonB || '');
  const [heightB, setHeightB] = useState(initialState?.heightB || '2');
  const [calcMode, setCalcMode] = useState<CalculationMode>('optical');
  const [rfFrequency, setRfFrequency] = useState<string>('2.4GHz');
  const [showFresnel, setShowFresnel] = useState(true);
  const [result, setResult] = useState<LOSResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [calcTime, setCalcTime] = useState<number | null>(null);

  useEffect(() => { pickModeRef.current = pickMode; }, [pickMode]);
  useEffect(() => { onStateChange?.({ latA, lonA, heightA, latB, lonB, heightB, result }); }, [latA, lonA, heightA, latB, lonB, heightB, result, onStateChange]);

  const pointA = useMemo(() => { const lat = parseFloat(latA), lon = parseFloat(lonA); return isNaN(lat) || isNaN(lon) ? null : { lat, lon }; }, [latA, lonA]);
  const pointB = useMemo(() => { const lat = parseFloat(latB), lon = parseFloat(lonB); return isNaN(lat) || isNaN(lon) ? null : { lat, lon }; }, [latB, lonB]);
  const lineInfo = useMemo(() => pointA && pointB ? { distance: haversineDistance(pointA.lat, pointA.lon, pointB.lat, pointB.lon), bearing: initialBearing(pointA.lat, pointA.lon, pointB.lat, pointB.lon) } : null, [pointA, pointB]);

  const handleMapClick = useCallback((e: maplibregl.MapMouseEvent) => {
    if (pickModeRef.current === 'A') { setLatA(e.lngLat.lat.toFixed(6)); setLonA(e.lngLat.lng.toFixed(6)); setPickMode('none'); setResult(null); }
    else if (pickModeRef.current === 'B') { setLatB(e.lngLat.lat.toFixed(6)); setLonB(e.lngLat.lng.toFixed(6)); setPickMode('none'); setResult(null); }
  }, []);

  useEffect(() => {
    if (!mapContainerRef.current || mapRef.current) return;
    const map = new maplibregl.Map({
      container: mapContainerRef.current,
      style: { version: 8, sources: {
        'carto-dark': { ...BASEMAP_SOURCES.cartoDark, maxzoom: 20 },
        'esri-satellite': { ...BASEMAP_SOURCES.esriSatellite, maxzoom: 19 },
        'carto-labels': { ...BASEMAP_SOURCES.cartoLabels, maxzoom: 20 }
      }, layers: [
        { id: 'carto-dark-layer', type: 'raster', source: 'carto-dark', layout: { visibility: 'visible' } },
        { id: 'esri-satellite-layer', type: 'raster', source: 'esri-satellite', layout: { visibility: 'none' } },
        { id: 'carto-labels-layer', type: 'raster', source: 'carto-labels', layout: { visibility: 'none' } },
      ]},
      center: ISRAEL_CENTER, zoom: 8, minZoom: 0.5, maxZoom: 22,
    });
    map.addControl(new maplibregl.NavigationControl(), 'top-left');
    map.on('load', () => { setMapLoaded(true); map.addSource('los-line', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } }); map.addLayer({ id: 'los-line-layer', type: 'line', source: 'los-line', paint: { 'line-color': '#22d3ee', 'line-width': 3 } }); });
    map.on('click', handleMapClick);
    mapRef.current = map;
    return () => { map.off('click', handleMapClick); map.remove(); mapRef.current = null; };
  }, [handleMapClick]);

  useEffect(() => { if (mapRef.current) mapRef.current.getCanvas().style.cursor = pickMode !== 'none' ? 'crosshair' : ''; }, [pickMode]);
  useEffect(() => { if (!mapRef.current || !mapLoaded) return; mapRef.current.setLayoutProperty('carto-dark-layer', 'visibility', basemap === 'map' ? 'visible' : 'none'); mapRef.current.setLayoutProperty('esri-satellite-layer', 'visibility', basemap === 'satellite' ? 'visible' : 'none'); mapRef.current.setLayoutProperty('carto-labels-layer', 'visibility', basemap === 'satellite' ? 'visible' : 'none'); }, [basemap, mapLoaded]);

  const createDraggableMarker = useCallback((lat: number, lon: number, label: string, onDrag: (lat: number, lon: number) => void): maplibregl.Marker => {
    const el = document.createElement('div'); el.className = label === 'A' ? styles.markerA : styles.markerB; el.textContent = label;
    const marker = new maplibregl.Marker({ element: el, draggable: true }).setLngLat([lon, lat]);
    marker.on('dragend', () => { const ll = marker.getLngLat(); onDrag(ll.lat, ll.lng); setResult(null); });
    return marker;
  }, []);

  useEffect(() => {
    if (!mapRef.current || !mapLoaded) return;
    if (pointA) { if (markerARef.current) markerARef.current.setLngLat([pointA.lon, pointA.lat]); else { markerARef.current = createDraggableMarker(pointA.lat, pointA.lon, 'A', (lat, lon) => { setLatA(lat.toFixed(6)); setLonA(lon.toFixed(6)); }); markerARef.current.addTo(mapRef.current); } }
    else if (markerARef.current) { markerARef.current.remove(); markerARef.current = null; }
    if (pointB) { if (markerBRef.current) markerBRef.current.setLngLat([pointB.lon, pointB.lat]); else { markerBRef.current = createDraggableMarker(pointB.lat, pointB.lon, 'B', (lat, lon) => { setLatB(lat.toFixed(6)); setLonB(lon.toFixed(6)); }); markerBRef.current.addTo(mapRef.current); } }
    else if (markerBRef.current) { markerBRef.current.remove(); markerBRef.current = null; }
    const source = mapRef.current.getSource('los-line') as maplibregl.GeoJSONSource;
    if (source && pointA && pointB) {
      source.setData({ type: 'FeatureCollection', features: [{ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: [[pointA.lon, pointA.lat], [pointB.lon, pointB.lat]] } }] });
      let color = '#22d3ee'; if (result) { if (calcMode === 'rf') { color = result.fresnelClear ? '#10b981' : (result.clear ? '#f59e0b' : '#f43f5e'); } else { color = result.clear ? '#10b981' : '#f43f5e'; } }
      mapRef.current.setPaintProperty('los-line-layer', 'line-color', color);
    } else if (source) source.setData({ type: 'FeatureCollection', features: [] });
  }, [pointA, pointB, mapLoaded, result, calcMode, createDraggableMarker]);

  const handleCalculate = async () => {
    if (!pointA || !pointB) { setError(t('los.losLine.enterCoordinates')); return; }
    setLoading(true); setError(null); const startTime = performance.now();
    try {
      const options: any = { sampleStepMeters: 30 }; if (calcMode === 'rf') options.frequencyMHz = RF_FREQUENCIES[rfFrequency as keyof typeof RF_FREQUENCIES];
      const res = await calculateLOSAsync({ lat: pointA.lat, lon: pointA.lon, antennaHeight: parseFloat(heightA) || 2 }, { lat: pointB.lat, lon: pointB.lon, antennaHeight: parseFloat(heightB) || 2 }, options);
      setResult(res); setCalcTime(performance.now() - startTime);
      if (mapRef.current) mapRef.current.fitBounds(new maplibregl.LngLatBounds([pointA.lon, pointA.lat], [pointB.lon, pointB.lat]), { padding: 100 });
    } catch (e) { setError(t('los.losLine.calculationError')); console.error(e); }
    setLoading(false);
  };

  const chartData = useMemo(() => result ? result.profile.map(p => ({ distance: p.distance / 1000, terrain: p.groundElevation ?? 0, los: p.losHeight, fresnelUpper: showFresnel && p.fresnelRadius ? p.losHeight + p.fresnelRadius * 0.6 : undefined, fresnelLower: showFresnel && p.fresnelRadius ? p.losHeight - p.fresnelRadius * 0.6 : undefined })) : [], [result, showFresnel]);
  const getStatus = () => { if (!result) return null; if (calcMode === 'rf') { if (!result.clear) return { text: t('los.losLine.result.blocked'), type: 'blocked', icon: '✕' }; if (result.fresnelClear === false) return { text: t('los.losLine.result.fresnelBlocked'), type: 'warning', icon: '⚠' }; return { text: t('los.losLine.result.clear'), type: 'clear', icon: '✓' }; } return { text: result.clear ? t('los.losLine.result.clear') : t('los.losLine.result.blocked'), type: result.clear ? 'clear' : 'blocked', icon: result.clear ? '✓' : '✕' }; };
  const status = getStatus();

  return (
    <div className={styles.container}>
      <div className={styles.mapSection}>
        <div ref={mapContainerRef} className={styles.map} />
        <div className={styles.mapControls}>
          <button className={`${styles.mapBtn} ${basemap === 'map' ? styles.active : ''}`} onClick={() => setBasemap('map')}>{t('los.map.mapView')}</button>
          <button className={`${styles.mapBtn} ${basemap === 'satellite' ? styles.active : ''}`} onClick={() => setBasemap('satellite')}>{t('los.map.satellite')}</button>
        </div>
        {lineInfo && <div className={styles.lineInfo}><span>{formatDistance(lineInfo.distance)}</span><span className={styles.separator}>|</span><span>{lineInfo.bearing.toFixed(1)}°</span></div>}
        {pickMode !== 'none' && <div className={styles.pickHint}>{t('los.losLine.clickMapPickPoint')} {pickMode}</div>}
      </div>

      <div className={styles.panel}>
        <div className={styles.panelContent}>
          <div className={styles.modeToggle}>
            <button className={`${styles.modeBtn} ${calcMode === 'optical' ? styles.active : ''}`} onClick={() => { setCalcMode('optical'); setResult(null); }}>👁️ {t('los.losLine.optical')}</button>
            <button className={`${styles.modeBtn} ${calcMode === 'rf' ? styles.active : ''}`} onClick={() => { setCalcMode('rf'); setResult(null); }}>📡 {t('los.losLine.rf')}</button>
          </div>
          {calcMode === 'rf' && <div className={styles.rfSettings}><label>{t('los.losLine.frequency')}</label><select value={rfFrequency} onChange={(e) => { setRfFrequency(e.target.value); setResult(null); }} className={styles.freqSelect}>{Object.keys(RF_FREQUENCIES).map(f => <option key={f} value={f}>{f}</option>)}</select></div>}

          <div className={styles.pointCard}>
            <div className={styles.pointHeader}><span className={styles.pointLabel}><span className={`${styles.pointDot} ${styles.pointA}`} />{t('los.losLine.pointA')}</span><button className={`${styles.pickBtn} ${pickMode === 'A' ? styles.active : ''}`} onClick={() => setPickMode(pickMode === 'A' ? 'none' : 'A')}>{pickMode === 'A' ? '✕' : '📍'}</button></div>
            <div className={styles.coordsGrid}><div className={styles.inputGroup}><span className={styles.inputLabel}>lat</span><input type="text" value={latA} onChange={e => { setLatA(e.target.value); setResult(null); }} className={styles.input} placeholder="32.0853" /></div><div className={styles.inputGroup}><span className={styles.inputLabel}>lon</span><input type="text" value={lonA} onChange={e => { setLonA(e.target.value); setResult(null); }} className={styles.input} placeholder="34.7818" /></div></div>
            <div className={styles.heightRow}><label>{t('los.losLine.heightMeters')}</label><input type="number" value={heightA} onChange={e => { setHeightA(e.target.value); setResult(null); }} className={styles.heightInput} /></div>
            {pointA && <div className={styles.dragHint}>💡 {t('los.losLine.dragOnMap')}</div>}
          </div>

          <div className={styles.pointCard}>
            <div className={styles.pointHeader}><span className={styles.pointLabel}><span className={`${styles.pointDot} ${styles.pointB}`} />{t('los.losLine.pointB')}</span><button className={`${styles.pickBtn} ${pickMode === 'B' ? styles.active : ''}`} onClick={() => setPickMode(pickMode === 'B' ? 'none' : 'B')}>{pickMode === 'B' ? '✕' : '📍'}</button></div>
            <div className={styles.coordsGrid}><div className={styles.inputGroup}><span className={styles.inputLabel}>lat</span><input type="text" value={latB} onChange={e => { setLatB(e.target.value); setResult(null); }} className={styles.input} placeholder="32.0853" /></div><div className={styles.inputGroup}><span className={styles.inputLabel}>lon</span><input type="text" value={lonB} onChange={e => { setLonB(e.target.value); setResult(null); }} className={styles.input} placeholder="34.7818" /></div></div>
            <div className={styles.heightRow}><label>{t('los.losLine.heightMeters')}</label><input type="number" value={heightB} onChange={e => { setHeightB(e.target.value); setResult(null); }} className={styles.heightInput} /></div>
            {pointB && <div className={styles.dragHint}>💡 {t('los.losLine.dragOnMap')}</div>}
          </div>

          {result && status && (
            <div className={styles.resultCard}>
              <div className={`${styles.statusBadge} ${styles[status.type]}`}>{status.icon} {status.text}</div>
              <div className={styles.resultGrid}>
                <div className={styles.resultRow}><span>{t('los.losLine.distance')}</span><span>{formatDistance(result.totalDistance)}</span></div>
                {result.minClearance !== null && <div className={styles.resultRow}><span>{t('los.losLine.result.minClearance')}</span><span className={result.minClearance < 0 ? styles.negative : styles.positive}>{result.minClearance.toFixed(1)} {t('los.common.meters')}</span></div>}
                {calcMode === 'rf' && result.minFresnelClearance != null && <div className={styles.resultRow}><span>Fresnel</span><span className={result.minFresnelClearance < 0 ? styles.negative : styles.positive}>{result.minFresnelClearance.toFixed(1)} {t('los.common.meters')}</span></div>}
                {calcTime && <div className={styles.resultRow}><span>{t('los.losLine.time')}</span><span>{calcTime < 1000 ? `${calcTime.toFixed(0)}ms` : `${(calcTime/1000).toFixed(1)}s`}</span></div>}
              </div>
            </div>
          )}

          {chartData.length > 0 && (
            <div className={styles.chartCard}><h4>{t('los.losLine.profile')}</h4>
              <ResponsiveContainer width="100%" height={100}>
                <ComposedChart data={chartData} margin={{ top: 5, right: 5, left: -25, bottom: 0 }}>
                  <XAxis dataKey="distance" tick={{ fontSize: 8, fill: '#71717a' }} tickFormatter={v => `${v.toFixed(0)}`} />
                  <YAxis tick={{ fontSize: 8, fill: '#71717a' }} domain={['auto', 'auto']} />
                  <Area type="monotone" dataKey="terrain" fill="#3d8b6e" fillOpacity={0.6} stroke="#3d8b6e" strokeWidth={1} />
                  {calcMode === 'rf' && showFresnel && <><Line type="monotone" dataKey="fresnelUpper" stroke="#f59e0b" strokeWidth={1} strokeDasharray="3 3" dot={false} /><Line type="monotone" dataKey="fresnelLower" stroke="#f59e0b" strokeWidth={1} strokeDasharray="3 3" dot={false} /></>}
                  <Line type="monotone" dataKey="los" stroke={result?.clear ? '#10b981' : '#f43f5e'} strokeWidth={2} dot={false} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          )}

          {error && <div className={styles.error}>{error}</div>}
          <div className={styles.actions}>
            <button className={styles.calculateBtn} onClick={handleCalculate} disabled={loading || !pointA || !pointB}>{loading ? t('los.losLine.calculating') : t('los.losLine.calculate')}</button>
            {result && <button className={styles.clearBtn} onClick={() => setResult(null)}>{t('los.losLine.clearResult')}</button>}
          </div>
        </div>
      </div>
    </div>
  );
}
