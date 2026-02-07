import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useLOSState, isLOSLineResult, isLOSAreaResult, isPeakFinderResult, type CalculationResult } from '../../../contexts/LOSContext';
import { formatDistance } from '../../../utils/los/geo';
import styles from './ResultsPanel.module.css';

function formatDate(date: Date): string {
  return new Intl.DateTimeFormat('he-IL', {
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

function ResultItem({ result }: { result: CalculationResult }) {
  const { t } = useTranslation();
  const { toggleResultVisibility, removeResult, setResultColor, mapRef, updateResultName, editResultInPanel } = useLOSState();
  const [editName, setEditName] = useState(result.name);

  // Keep editName in sync if result.name changes externally
  useEffect(() => {
    setEditName(result.name);
  }, [result.name]);

  const handleNameChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setEditName(e.target.value);
  };

  const handleNameBlur = () => {
    const trimmed = editName.trim();
    if (trimmed && trimmed !== result.name) {
      updateResultName(result.id, trimmed);
    } else {
      setEditName(result.name);
    }
  };

  const handleNameKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      (e.target as HTMLInputElement).blur();
    } else if (e.key === 'Escape') {
      setEditName(result.name);
      (e.target as HTMLInputElement).blur();
    }
  };

  const getTypeIcon = () => {
    switch (result.type) {
      case 'los-line': return '━';
      case 'los-area': return '◎';
      case 'peaks': return '△';
      default: return '?';
    }
  };

  const getTypeLabel = () => {
    switch (result.type) {
      case 'los-line': return t('los.results.losLineResult');
      case 'los-area': return t('los.results.losAreaResult');
      case 'peaks': return t('los.results.peakResult');
      default: return t('los.results.unknown');
    }
  };

  const getStatusBadge = () => {
    if (isLOSLineResult(result)) {
      return result.result.clear
        ? { text: t('los.results.clear'), className: styles.clear }
        : { text: t('los.results.blocked'), className: styles.blocked };
    }
    if (isLOSAreaResult(result)) {
      const pct = result.result.clearPercentage;
      return { text: `${pct.toFixed(0)}%`, className: pct > 50 ? styles.clear : styles.blocked };
    }
    if (isPeakFinderResult(result)) {
      return { text: `${result.result.peaks.length} ${t('los.results.peakResult')}`, className: styles.info };
    }
    return null;
  };

  const handleFocus = () => {
    if (!mapRef.current) return;

    if (isLOSLineResult(result)) {
      const { pointA, pointB } = result.params;
      mapRef.current.fitBounds([
        [Math.min(pointA.lon, pointB.lon), Math.min(pointA.lat, pointB.lat)],
        [Math.max(pointA.lon, pointB.lon), Math.max(pointA.lat, pointB.lat)]
      ], { padding: 100 });
    } else if (isLOSAreaResult(result)) {
      const { origin, maxDistance } = result.params;
      // Approximate bounds based on max distance
      const latOffset = maxDistance / 111000;
      const lonOffset = maxDistance / (111000 * Math.cos(origin.lat * Math.PI / 180));
      mapRef.current.fitBounds([
        [origin.lon - lonOffset, origin.lat - latOffset],
        [origin.lon + lonOffset, origin.lat + latOffset]
      ], { padding: 50 });
    } else if (isPeakFinderResult(result)) {
      const { polygon } = result.params;
      if (polygon.length > 0) {
        const lons = polygon.map(p => p.lon);
        const lats = polygon.map(p => p.lat);
        mapRef.current.fitBounds([
          [Math.min(...lons), Math.min(...lats)],
          [Math.max(...lons), Math.max(...lats)]
        ], { padding: 50 });
      }
    }
  };

  const handleEdit = () => {
    editResultInPanel(result.id);
  };

  const status = getStatusBadge();

  return (
    <div className={`${styles.resultItem} ${!result.visible ? styles.hidden : ''}`}>
      <div className={styles.resultHeader}>
        <div className={styles.resultIcon} style={{ backgroundColor: result.color }}>
          {getTypeIcon()}
        </div>
        <div className={styles.resultInfo}>
          <input
            type="text"
            value={editName}
            onChange={handleNameChange}
            onBlur={handleNameBlur}
            onKeyDown={handleNameKeyDown}
            className={styles.nameInput}
          />
          <span className={styles.resultMeta}>
            {getTypeLabel()} | {formatDate(result.timestamp)}
          </span>
        </div>
        {status && (
          <span className={`${styles.statusBadge} ${status.className}`}>
            {status.text}
          </span>
        )}
      </div>

      <div className={styles.resultActions}>
        <button
          className={`${styles.actionBtn} ${result.visible ? styles.active : ''}`}
          onClick={() => toggleResultVisibility(result.id)}
          title={result.visible ? t('los.results.hidden') : t('los.results.visible')}
        >
          {result.visible ? '👁️' : '👁️‍🗨️'}
        </button>
        <button
          className={styles.actionBtn}
          onClick={handleFocus}
          title={t('los.results.zoomTo')}
        >
          🎯
        </button>
        <button
          className={`${styles.actionBtn} ${styles.edit}`}
          onClick={handleEdit}
          title={t('los.results.edit')}
        >
          ✏️
        </button>
        <input
          type="color"
          value={result.color}
          onChange={(e) => setResultColor(result.id, e.target.value)}
          className={styles.colorPicker}
          title={t('los.results.changeColor')}
        />
        <button
          className={`${styles.actionBtn} ${styles.delete}`}
          onClick={() => removeResult(result.id)}
          title={t('los.results.delete')}
        >
          🗑️
        </button>
      </div>

      {/* Result details */}
      <div className={styles.resultDetails}>
        {isLOSLineResult(result) && (
          <>
            <div className={styles.detailRow}>
              <span>{t('los.results.distance')}:</span>
              <span>{formatDistance(result.result.totalDistance)}</span>
            </div>
            <div className={styles.detailRow}>
              <span>{t('los.results.azimuth')}:</span>
              <span>{result.result.bearing.toFixed(1)}°</span>
            </div>
            {result.result.minClearance !== null && (
              <div className={styles.detailRow}>
                <span>{t('los.results.minClearance')}:</span>
                <span className={result.result.minClearance < 0 ? styles.negative : styles.positive}>
                  {result.result.minClearance.toFixed(1)} {t('los.results.meters')}
                </span>
              </div>
            )}
          </>
        )}

        {isLOSAreaResult(result) && (
          <>
            <div className={styles.detailRow}>
              <span>{t('los.results.clearPoints')}:</span>
              <span>{result.result.clearCount}</span>
            </div>
            <div className={styles.detailRow}>
              <span>{t('los.results.blockedPoints')}:</span>
              <span>{result.result.blockedCount}</span>
            </div>
            <div className={styles.detailRow}>
              <span>{t('los.results.coveragePercent')}:</span>
              <span className={result.result.clearPercentage > 50 ? styles.positive : styles.negative}>
                {result.result.clearPercentage.toFixed(1)}%
              </span>
            </div>
          </>
        )}

        {isPeakFinderResult(result) && (
          <>
            <div className={styles.detailRow}>
              <span>{t('los.results.peakCount')}:</span>
              <span>{result.result.peaks.length}</span>
            </div>
            <div className={styles.detailRow}>
              <span>{t('los.results.sampledPoints')}:</span>
              <span>{result.result.sampledPoints.toLocaleString()}</span>
            </div>
            {result.result.peaks[0] && (
              <div className={styles.detailRow}>
                <span>{t('los.results.maxElevation')}:</span>
                <span>{Math.round(result.result.peaks[0].elevation)} {t('los.results.meters')}</span>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

export default function ResultsPanel() {
  const { t } = useTranslation();
  const { state, clearAllResults } = useLOSState();
  const { results } = state;

  if (results.length === 0) {
    return (
      <div className={styles.empty}>
        <div className={styles.emptyIcon}>📊</div>
        <p>{t('los.results.noResults')}</p>
        <p className={styles.emptyHint}>{t('los.results.noResultsHint')}</p>
      </div>
    );
  }

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <span className={styles.count}>{results.length} {t('los.results.resultsCount')}</span>
        <button className={styles.clearAllBtn} onClick={clearAllResults}>
          {t('los.results.clearAll')}
        </button>
      </div>

      <div className={styles.resultsList}>
        {results.map((result) => (
          <ResultItem key={result.id} result={result} />
        ))}
      </div>
    </div>
  );
}
