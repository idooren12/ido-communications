import React, { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { GRADIENT_STOPS } from '../../utils/los/elevtintProtocol';
import styles from './UnifiedMap.module.css';

interface ElevationLegendProps {
  minElevation: number;
  maxElevation: number;
  visible: boolean;
}

export default function ElevationLegend({ minElevation, maxElevation, visible }: ElevationLegendProps) {
  const { t } = useTranslation();

  const { gradient, labels } = useMemo(() => {
    // Build CSS gradient from GRADIENT_STOPS (bottom=min, top=max)
    const gradientMin = GRADIENT_STOPS[0].elevation;
    const gradientMax = GRADIENT_STOPS[GRADIENT_STOPS.length - 1].elevation;
    const gradientRange = gradientMax - gradientMin;

    const stops = GRADIENT_STOPS.map(s => {
      const pct = ((s.elevation - gradientMin) / gradientRange) * 100;
      return `${s.color} ${pct.toFixed(1)}%`;
    });
    // CSS gradient: bottom is 0%, top is 100%
    const gradient = `linear-gradient(to top, ${stops.join(', ')})`;

    // Generate elevation labels
    const range = maxElevation - minElevation;
    const labelElevations: number[] = [];

    // Pick step size based on range
    let step: number;
    if (range <= 200) step = 50;
    else if (range <= 500) step = 100;
    else if (range <= 1500) step = 200;
    else if (range <= 3000) step = 500;
    else step = 1000;

    const firstLabel = Math.ceil(minElevation / step) * step;
    for (let e = firstLabel; e <= maxElevation; e += step) {
      labelElevations.push(e);
    }

    // Always include min and max if not already near a label
    const labels = labelElevations.map(e => ({
      elevation: e,
      position: ((e - minElevation) / range) * 100,
    }));

    return { gradient, labels };
  }, [minElevation, maxElevation]);

  if (!visible) return null;

  return (
    <div className={styles.elevationLegend}>
      <div className={styles.legendTitle}>{t('los.map.elevationLegend')}</div>
      <div className={styles.legendBody}>
        <div className={styles.legendGradient} style={{ background: gradient }} />
        <div className={styles.legendLabels}>
          {labels.map(l => (
            <div
              key={l.elevation}
              className={styles.legendLabel}
              style={{ bottom: `${l.position}%` }}
            >
              <span className={styles.legendTick} />
              <span className={styles.legendValue}>{l.elevation}{t('los.map.metersShort')}</span>
            </div>
          ))}
        </div>
      </div>
      <div className={styles.legendRange}>
        <span>{maxElevation}{t('los.map.metersShort')}</span>
        <span>{minElevation}{t('los.map.metersShort')}</span>
      </div>
    </div>
  );
}
