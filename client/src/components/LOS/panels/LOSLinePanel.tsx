import React, { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { LineChart, Line, XAxis, YAxis, ResponsiveContainer, Area, ComposedChart } from 'recharts';
import { type LOSResult, RF_FREQUENCIES } from '../../../utils/los/los';
import { calculateLOSAsync } from '../../../utils/los/workers/workerPool';
import { haversineDistance, initialBearing, formatDistance } from '../../../utils/los/geo';
import { useLOSState, type LOSLineParams, type LOSLineResultData } from '../../../contexts/LOSContext';
import styles from './LOSLinePanel.module.css';

type PickMode = 'none' | 'A' | 'B';
type CalculationMode = 'optical' | 'rf';

export default function LOSLinePanel() {
  const { t } = useTranslation();
  const { mapRef, addResult, setMapClickHandler, setPreviewPoints, setPreviewLine, setPreviewDragHandler, editingResultData, clearEditingResultData } = useLOSState();
  const pickModeRef = useRef<PickMode>('none');

  const [pickMode, setPickMode] = useState<PickMode>('none');
  const [latA, setLatA] = useState('');
  const [lonA, setLonA] = useState('');
  const [heightA, setHeightA] = useState('2');
  const [latB, setLatB] = useState('');
  const [lonB, setLonB] = useState('');
  const [heightB, setHeightB] = useState('2');
  const [calcMode, setCalcMode] = useState<CalculationMode>('optical');
  const [rfFrequency, setRfFrequency] = useState<string>('2.4GHz');
  const [showFresnel, setShowFresnel] = useState(true);
  const [result, setResult] = useState<LOSResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [calcTime, setCalcTime] = useState<number | null>(null);

  useEffect(() => { pickModeRef.current = pickMode; }, [pickMode]);

  // Register drag handler for preview markers (NaN = delete point)
  useEffect(() => {
    setPreviewDragHandler((index: number, lat: number, lon: number) => {
      if (isNaN(lat) || isNaN(lon)) {
        // Delete signal
        if (index === 0) { setLatA(''); setLonA(''); }
        else if (index === 1) { setLatB(''); setLonB(''); }
      } else {
        if (index === 0) { setLatA(lat.toFixed(6)); setLonA(lon.toFixed(6)); }
        else if (index === 1) { setLatB(lat.toFixed(6)); setLonB(lon.toFixed(6)); }
      }
      setResult(null);
      setCalcTime(null);
    });
    return () => setPreviewDragHandler(null);
  }, [setPreviewDragHandler]);

  // Consume editingResultData when editing from a saved result
  useEffect(() => {
    if (editingResultData && editingResultData.type === 'los-line') {
      const params = editingResultData.params as any;
      setLatA(params.pointA.lat.toFixed(6));
      setLonA(params.pointA.lon.toFixed(6));
      setHeightA(String(params.pointA.height || 2));
      setLatB(params.pointB.lat.toFixed(6));
      setLonB(params.pointB.lon.toFixed(6));
      setHeightB(String(params.pointB.height || 2));
      if (params.mode) setCalcMode(params.mode);
      if (params.rfFrequency) setRfFrequency(params.rfFrequency);
      setResult(null);
      setCalcTime(null);
      clearEditingResultData();
    }
  }, [editingResultData, clearEditingResultData]);

  const pointA = useMemo(() => {
    const lat = parseFloat(latA), lon = parseFloat(lonA);
    return isNaN(lat) || isNaN(lon) ? null : { lat, lon };
  }, [latA, lonA]);

  const pointB = useMemo(() => {
    const lat = parseFloat(latB), lon = parseFloat(lonB);
    return isNaN(lat) || isNaN(lon) ? null : { lat, lon };
  }, [latB, lonB]);

  const lineInfo = useMemo(() => {
    if (!pointA || !pointB) return null;
    return {
      distance: haversineDistance(pointA.lat, pointA.lon, pointB.lat, pointB.lon),
      bearing: initialBearing(pointA.lat, pointA.lon, pointB.lat, pointB.lon)
    };
  }, [pointA, pointB]);

  // Update preview points whenever points change
  useEffect(() => {
    const points = [];
    if (pointA) {
      points.push({ lat: pointA.lat, lon: pointA.lon, label: 'A', name: t('los.losLine.pointA'), color: '#22d3ee' });
    }
    if (pointB) {
      points.push({ lat: pointB.lat, lon: pointB.lon, label: 'B', name: t('los.losLine.pointB'), color: '#f59e0b' });
    }
    setPreviewPoints(points);

    // Update preview line if both points exist
    if (pointA && pointB) {
      setPreviewLine([
        { lat: pointA.lat, lon: pointA.lon },
        { lat: pointB.lat, lon: pointB.lon }
      ]);
    } else {
      setPreviewLine(null);
    }

    // Cleanup when component unmounts
    return () => {
      setPreviewPoints([]);
      setPreviewLine(null);
    };
  }, [pointA, pointB, setPreviewPoints, setPreviewLine]);

  // Register click handler with the context
  useEffect(() => {
    if (pickMode !== 'none') {
      setMapClickHandler((e) => {
        if (pickModeRef.current === 'A') {
          setLatA(e.lngLat.lat.toFixed(6));
          setLonA(e.lngLat.lng.toFixed(6));
          setPickMode('none');
          setResult(null);
        } else if (pickModeRef.current === 'B') {
          setLatB(e.lngLat.lat.toFixed(6));
          setLonB(e.lngLat.lng.toFixed(6));
          setPickMode('none');
          setResult(null);
        }
      }, 'crosshair');
    } else {
      setMapClickHandler(null);
    }

    return () => {
      setMapClickHandler(null);
    };
  }, [pickMode, setMapClickHandler]);

  const handleCalculate = async () => {
    if (!pointA || !pointB) {
      setError(t('los.losLine.enterCoordinates'));
      return;
    }

    setLoading(true);
    setError(null);
    const startTime = performance.now();

    try {
      const options: any = { sampleStepMeters: 30 };
      if (calcMode === 'rf') {
        options.frequencyMHz = RF_FREQUENCIES[rfFrequency as keyof typeof RF_FREQUENCIES];
      }

      const res = await calculateLOSAsync(
        { lat: pointA.lat, lon: pointA.lon, antennaHeight: parseFloat(heightA) || 2 },
        { lat: pointB.lat, lon: pointB.lon, antennaHeight: parseFloat(heightB) || 2 },
        options
      );

      setResult(res);
      setCalcTime(performance.now() - startTime);

      // Fit map to bounds
      if (mapRef.current) {
        const bounds = [
          [Math.min(pointA.lon, pointB.lon), Math.min(pointA.lat, pointB.lat)],
          [Math.max(pointA.lon, pointB.lon), Math.max(pointA.lat, pointB.lat)]
        ] as [[number, number], [number, number]];
        mapRef.current.fitBounds(bounds, { padding: 100 });
      }
    } catch (e) {
      setError(t('los.losLine.calculationError'));
      console.error(e);
    }

    setLoading(false);
  };

  const handleSaveResult = () => {
    if (!result || !pointA || !pointB) return;

    const params: LOSLineParams = {
      pointA: { lat: pointA.lat, lon: pointA.lon, height: parseFloat(heightA) || 2 },
      pointB: { lat: pointB.lat, lon: pointB.lon, height: parseFloat(heightB) || 2 },
      mode: calcMode,
      rfFrequency: calcMode === 'rf' ? rfFrequency : undefined,
    };

    const resultData: LOSLineResultData = {
      clear: result.clear,
      fresnelClear: result.fresnelClear,
      totalDistance: result.totalDistance,
      bearing: result.bearing,
      minClearance: result.minClearance,
      minClearanceDistance: result.minClearanceDistance,
      profile: result.profile,
      confidence: result.confidence,
    };

    addResult({
      type: 'los-line',
      name: `${t('los.losLine.losLine')} ${formatDistance(result.totalDistance)}`,
      params,
      result: resultData,
      visible: true,
      color: result.clear ? '#10b981' : '#f43f5e',
    });

    // Clear inputs for new calculation
    setResult(null);
  };

  const chartData = useMemo(() => {
    if (!result) return [];
    return result.profile.map(p => ({
      distance: p.distance / 1000,
      terrain: p.groundElevation ?? 0,
      los: p.losHeight,
      fresnelUpper: showFresnel && p.fresnelRadius ? p.losHeight + p.fresnelRadius * 0.6 : undefined,
      fresnelLower: showFresnel && p.fresnelRadius ? p.losHeight - p.fresnelRadius * 0.6 : undefined
    }));
  }, [result, showFresnel]);

  const getStatus = () => {
    if (!result) return null;
    if (calcMode === 'rf') {
      if (!result.clear) return { text: t('los.losLine.blocked'), type: 'blocked', icon: '✕' };
      if (result.fresnelClear === false) return { text: t('los.losLine.fresnelBlocked'), type: 'warning', icon: '⚠' };
      return { text: t('los.losLine.clear'), type: 'clear', icon: '✓' };
    }
    return {
      text: result.clear ? t('los.losLine.clear') : t('los.losLine.blocked'),
      type: result.clear ? 'clear' : 'blocked',
      icon: result.clear ? '✓' : '✕'
    };
  };

  const status = getStatus();

  return (
    <div className={styles.container}>
      <div className={styles.modeToggle}>
        <button
          className={`${styles.modeBtn} ${calcMode === 'optical' ? styles.active : ''}`}
          onClick={() => { setCalcMode('optical'); setResult(null); }}
        >
          {t('los.losLine.optical')}
        </button>
        <button
          className={`${styles.modeBtn} ${calcMode === 'rf' ? styles.active : ''}`}
          onClick={() => { setCalcMode('rf'); setResult(null); }}
        >
          RF
        </button>
      </div>

      {calcMode === 'rf' && (
        <div className={styles.rfSettings}>
          <label>{t('los.losLine.frequency')}:</label>
          <select
            value={rfFrequency}
            onChange={(e) => { setRfFrequency(e.target.value); setResult(null); }}
            className={styles.freqSelect}
          >
            {Object.keys(RF_FREQUENCIES).map(f => (
              <option key={f} value={f}>{f}</option>
            ))}
          </select>
        </div>
      )}

      <div className={styles.pointCard}>
        <div className={styles.pointHeader}>
          <span className={styles.pointLabel}>
            <span className={`${styles.pointDot} ${styles.dotA}`} />
            {t('los.losLine.pointA')}
          </span>
          <button
            className={`${styles.pickBtn} ${pickMode === 'A' ? styles.active : ''}`}
            onClick={() => setPickMode(pickMode === 'A' ? 'none' : 'A')}
          >
            {pickMode === 'A' ? '✕' : '📍'}
          </button>
        </div>
        <div className={styles.coordsGrid}>
          <div className={styles.inputGroup}>
            <span className={styles.inputLabel}>lat</span>
            <input
              type="text"
              value={latA}
              onChange={e => { setLatA(e.target.value); setResult(null); }}
              className={styles.input}
              placeholder="32.0853"
            />
          </div>
          <div className={styles.inputGroup}>
            <span className={styles.inputLabel}>lon</span>
            <input
              type="text"
              value={lonA}
              onChange={e => { setLonA(e.target.value); setResult(null); }}
              className={styles.input}
              placeholder="34.7818"
            />
          </div>
        </div>
        <div className={styles.heightRow}>
          <label>{t('los.losLine.heightAboveGround')} ({t('los.common.meters')})</label>
          <input
            type="number"
            value={heightA}
            onChange={e => { setHeightA(e.target.value); setResult(null); }}
            className={styles.heightInput}
          />
        </div>
      </div>

      <div className={styles.pointCard}>
        <div className={styles.pointHeader}>
          <span className={styles.pointLabel}>
            <span className={`${styles.pointDot} ${styles.dotB}`} />
            {t('los.losLine.pointB')}
          </span>
          <button
            className={`${styles.pickBtn} ${pickMode === 'B' ? styles.active : ''}`}
            onClick={() => setPickMode(pickMode === 'B' ? 'none' : 'B')}
          >
            {pickMode === 'B' ? '✕' : '📍'}
          </button>
        </div>
        <div className={styles.coordsGrid}>
          <div className={styles.inputGroup}>
            <span className={styles.inputLabel}>lat</span>
            <input
              type="text"
              value={latB}
              onChange={e => { setLatB(e.target.value); setResult(null); }}
              className={styles.input}
              placeholder="32.0853"
            />
          </div>
          <div className={styles.inputGroup}>
            <span className={styles.inputLabel}>lon</span>
            <input
              type="text"
              value={lonB}
              onChange={e => { setLonB(e.target.value); setResult(null); }}
              className={styles.input}
              placeholder="34.7818"
            />
          </div>
        </div>
        <div className={styles.heightRow}>
          <label>{t('los.losLine.heightAboveGround')} ({t('los.common.meters')})</label>
          <input
            type="number"
            value={heightB}
            onChange={e => { setHeightB(e.target.value); setResult(null); }}
            className={styles.heightInput}
          />
        </div>
      </div>

      {lineInfo && (
        <div className={styles.lineInfo}>
          <span>{formatDistance(lineInfo.distance)}</span>
          <span className={styles.separator}>|</span>
          <span>{lineInfo.bearing.toFixed(1)}°</span>
        </div>
      )}

      {pickMode !== 'none' && (
        <div className={styles.pickHint}>{t('los.losLine.selectOnMap')} {pickMode}</div>
      )}

      {result && status && (
        <div className={styles.resultCard}>
          <div className={`${styles.statusBadge} ${styles[status.type]}`}>
            {status.icon} {status.text}
          </div>
          <div className={styles.resultGrid}>
            <div className={styles.resultRow}>
              <span>{t('los.losLine.distance')}</span>
              <span>{formatDistance(result.totalDistance)}</span>
            </div>
            {result.minClearance !== null && (
              <div className={styles.resultRow}>
                <span>{t('los.losLine.minClearance')}</span>
                <span className={result.minClearance < 0 ? styles.negative : styles.positive}>
                  {result.minClearance.toFixed(1)} {t('los.common.meters')}
                </span>
              </div>
            )}
            {calcMode === 'rf' && result.minFresnelClearance != null && (
              <div className={styles.resultRow}>
                <span>Fresnel</span>
                <span className={result.minFresnelClearance < 0 ? styles.negative : styles.positive}>
                  {result.minFresnelClearance.toFixed(1)} {t('los.common.meters')}
                </span>
              </div>
            )}
            {calcTime && (
              <div className={styles.resultRow}>
                <span>{t('los.losLine.time')}</span>
                <span>{calcTime < 1000 ? `${calcTime.toFixed(0)}ms` : `${(calcTime/1000).toFixed(1)}s`}</span>
              </div>
            )}
          </div>
        </div>
      )}

      {chartData.length > 0 && (
        <div className={styles.chartCard}>
          <h4>{t('los.losLine.profile')}</h4>
          <ResponsiveContainer width="100%" height={100}>
            <ComposedChart data={chartData} margin={{ top: 5, right: 5, left: -25, bottom: 0 }}>
              <XAxis dataKey="distance" tick={{ fontSize: 8, fill: '#71717a' }} tickFormatter={v => `${v.toFixed(0)}`} />
              <YAxis tick={{ fontSize: 8, fill: '#71717a' }} domain={['auto', 'auto']} />
              <Area type="monotone" dataKey="terrain" fill="#3d8b6e" fillOpacity={0.6} stroke="#3d8b6e" strokeWidth={1} />
              {calcMode === 'rf' && showFresnel && (
                <>
                  <Line type="monotone" dataKey="fresnelUpper" stroke="#f59e0b" strokeWidth={1} strokeDasharray="3 3" dot={false} />
                  <Line type="monotone" dataKey="fresnelLower" stroke="#f59e0b" strokeWidth={1} strokeDasharray="3 3" dot={false} />
                </>
              )}
              <Line type="monotone" dataKey="los" stroke={result?.clear ? '#10b981' : '#f43f5e'} strokeWidth={2} dot={false} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      )}

      {error && <div className={styles.error}>{error}</div>}

      <div className={styles.actions}>
        <button
          className={styles.calculateBtn}
          onClick={handleCalculate}
          disabled={loading || !pointA || !pointB}
        >
          {loading ? t('los.losLine.calculating') : t('los.losLine.calculate')}
        </button>
        {result && (
          <>
            <button className={styles.saveBtn} onClick={handleSaveResult}>{t('los.common.save')}</button>
            <button className={styles.clearBtn} onClick={() => setResult(null)}>{t('los.common.clear')}</button>
          </>
        )}
      </div>
    </div>
  );
}
