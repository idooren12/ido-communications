import { useTranslation } from 'react-i18next';
import { formatArea, formatDistance } from '../../../utils/los/geo';
import type { useMeasure } from './useMeasure';
import styles from '../UnifiedMap.module.css';

export default function MeasurePanel({ measure }: { measure: ReturnType<typeof useMeasure> }) {
  const { t } = useTranslation();
  const { measureMode, measurePoints, calcDistance, calcBearing, calcArea, clearMeasure, startMeasure } = measure;

  return (
    <div className={styles.controlGroup}>
      <button
        className={`${styles.controlBtn} ${measureMode !== 'none' ? styles.active : ''}`}
        onClick={() => (measureMode === 'none' ? startMeasure('distance') : clearMeasure())}
        title={t('los.map.measurements')}
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M22 2L2 22M16 2h6v6M2 16v6h6" /></svg>
      </button>
      {measureMode !== 'none' && (
        <div className={styles.measurePanel}>
          <div className={styles.measureTabs}>
            <button className={measureMode === 'distance' ? styles.active : ''} onClick={() => startMeasure('distance')}>{t('los.map.distance')}</button>
            <button className={measureMode === 'area' ? styles.active : ''} onClick={() => startMeasure('area')}>{t('los.map.area')}</button>
          </div>
          {measurePoints.length > 0 && (
            <div className={styles.measureResults}>
              <div className={styles.measureRow}>
                <span className={styles.measureLabel}>{t('los.map.distance')}:</span>
                <span className={styles.measureValue}>{formatDistance(calcDistance())}</span>
              </div>
              {measureMode === 'distance' && measurePoints.length >= 2 && (
                <div className={styles.measureRow}>
                  <span className={styles.measureLabel}>{t('los.map.azimuth')}:</span>
                  <span className={styles.measureValue}>{calcBearing().toFixed(1)}°</span>
                </div>
              )}
              {measureMode === 'area' && measurePoints.length >= 3 && (
                <div className={styles.measureRow}>
                  <span className={styles.measureLabel}>{t('los.map.area')}:</span>
                  <span className={styles.measureValue}>{formatArea(calcArea())}</span>
                </div>
              )}
              <button onClick={clearMeasure} className={styles.clearBtn}>{t('los.map.clear')}</button>
            </div>
          )}
          {measurePoints.length === 0 && (
            <div className={styles.measureHint}>{t('los.map.clickMapHint')}<br />{t('los.map.doubleClickFinish')}</div>
          )}
        </div>
      )}
    </div>
  );
}
