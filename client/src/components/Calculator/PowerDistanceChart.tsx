import { useState, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ReferenceLine, ResponsiveContainer, ReferenceDot, Legend
} from 'recharts';
import { calculateReceivedPower, wattToDbm } from '../../utils/friisCalculations';
import { calculateRealisticReceivedPower } from '../../utils/realisticCalculations';
import type { WeatherData } from '../../utils/realisticCalculations';
import type { RegionData } from '../../utils/israelRegions';
import { useTheme } from '../../contexts/ThemeContext';

interface Props {
  txPowerWatts: number;
  txGainDbi: number;
  rxGainDbi: number;
  frequencyMhz: number;
  sensitivityDbm?: number;
  resultDistanceKm?: number;
  resultPowerDbm?: number;
  // Realistic mode additions
  realisticMode?: boolean;
  region?: RegionData;
  weather?: WeatherData;
}

export default function PowerDistanceChart({
  txPowerWatts, txGainDbi, rxGainDbi, frequencyMhz,
  sensitivityDbm, resultDistanceKm, resultPowerDbm,
  realisticMode, region, weather
}: Props) {
  const { t } = useTranslation();
  const { resolvedTheme } = useTheme();
  const [expanded, setExpanded] = useState(false);
  const isDark = resolvedTheme === 'dark';

  const showRealistic = realisticMode && region && weather;

  const data = useMemo(() => {
    const maxDist = resultDistanceKm
      ? Math.max(resultDistanceKm * 2, 1)
      : 50;
    const points: { distance: number; power: number; realisticPower?: number }[] = [];
    const steps = 100;
    for (let i = 1; i <= steps; i++) {
      const d = (maxDist / steps) * i;
      const res = calculateReceivedPower(txPowerWatts, txGainDbi, rxGainDbi, frequencyMhz, d);
      if (isFinite(res.receivedPowerDbm)) {
        const point: { distance: number; power: number; realisticPower?: number } = {
          distance: parseFloat(d.toFixed(3)),
          power: parseFloat(res.receivedPowerDbm.toFixed(2)),
        };

        // Add realistic power curve
        if (showRealistic) {
          const realRes = calculateRealisticReceivedPower(
            txPowerWatts, txGainDbi, rxGainDbi, frequencyMhz, d, region, weather
          );
          if (isFinite(realRes.realisticPowerDbm)) {
            point.realisticPower = parseFloat(realRes.realisticPowerDbm.toFixed(2));
          }
        }

        points.push(point);
      }
    }
    return points;
  }, [txPowerWatts, txGainDbi, rxGainDbi, frequencyMhz, resultDistanceKm, showRealistic, region, weather]);

  const txPowerDbm = wattToDbm(txPowerWatts);
  const allPowerValues = [
    ...data.map(d => d.power),
    ...(showRealistic ? data.filter(d => d.realisticPower !== undefined).map(d => d.realisticPower!) : []),
  ];
  const yMin = Math.min(
    ...allPowerValues,
    sensitivityDbm ?? 0
  ) - 10;
  const yMax = txPowerDbm + txGainDbi + rxGainDbi + 5;

  return (
    <div className="bg-gray-50 dark:bg-slate-800 rounded-xl border border-gray-200 dark:border-gray-700 mt-4">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between px-5 py-3 text-sm font-medium text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-slate-700 rounded-xl transition-colors"
      >
        <span>{t('chart.title')}</span>
        <svg
          className={`w-5 h-5 transition-transform ${expanded ? 'rotate-180' : ''}`}
          fill="none" viewBox="0 0 24 24" stroke="currentColor"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {expanded && (
        <div className="px-4 pb-4 border-t border-gray-200 dark:border-gray-700 pt-3">
          <ResponsiveContainer width="100%" height={320}>
            <LineChart data={data} margin={{ top: 10, right: 20, left: 10, bottom: 10 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={isDark ? '#374151' : '#e5e7eb'} />
              <XAxis
                dataKey="distance"
                tickFormatter={(value) => Math.round(value).toString()}
                label={{ value: `${t('chart.distance')} (${t('result.km')})`, position: 'insideBottom', offset: -5, fill: isDark ? '#9ca3af' : '#6b7280' }}
                tick={{ fill: isDark ? '#9ca3af' : '#6b7280', fontSize: 12 }}
                stroke={isDark ? '#4b5563' : '#d1d5db'}
              />
              <YAxis
                label={{ value: `${t('chart.power')} (dBm)`, angle: -90, position: 'insideLeft', offset: 10, fill: isDark ? '#9ca3af' : '#6b7280' }}
                domain={[yMin, yMax]}
                tick={{ fill: isDark ? '#9ca3af' : '#6b7280', fontSize: 12 }}
                stroke={isDark ? '#4b5563' : '#d1d5db'}
              />
              <Tooltip
                contentStyle={{
                  backgroundColor: isDark ? '#1e293b' : '#fff',
                  border: `1px solid ${isDark ? '#374151' : '#e5e7eb'}`,
                  borderRadius: '8px',
                  color: isDark ? '#e5e7eb' : '#1f2937'
                }}
                formatter={(value: unknown, name: unknown) => {
                  const label = name === 'realisticPower'
                    ? t('chart.realisticPower')
                    : t('chart.power');
                  return [`${value} dBm`, label];
                }}
                labelFormatter={(label: unknown) => `${label} ${t('result.km')}`}
              />
              {showRealistic && (
                <Legend
                  wrapperStyle={{ fontSize: 12, color: isDark ? '#9ca3af' : '#6b7280' }}
                />
              )}
              <Line
                type="monotone"
                dataKey="power"
                name={showRealistic ? t('chart.freeSpacePower') : t('chart.power')}
                stroke="#6366f1"
                strokeWidth={2}
                dot={false}
                activeDot={{ r: 5, fill: '#6366f1' }}
              />
              {showRealistic && (
                <Line
                  type="monotone"
                  dataKey="realisticPower"
                  name={t('chart.realisticPower')}
                  stroke="#f59e0b"
                  strokeWidth={2}
                  strokeDasharray="8 4"
                  dot={false}
                  activeDot={{ r: 5, fill: '#f59e0b' }}
                />
              )}
              {sensitivityDbm !== undefined && (
                <ReferenceLine
                  y={sensitivityDbm}
                  stroke="#ef4444"
                  strokeDasharray="8 4"
                  label={{
                    value: `${t('chart.sensitivity')} (${sensitivityDbm} dBm)`,
                    position: 'right',
                    fill: '#ef4444',
                    fontSize: 11
                  }}
                />
              )}
              {resultDistanceKm !== undefined && resultPowerDbm !== undefined && (
                <ReferenceDot
                  x={parseFloat(resultDistanceKm.toFixed(3))}
                  y={parseFloat(resultPowerDbm.toFixed(2))}
                  r={6}
                  fill={showRealistic ? '#f59e0b' : '#6366f1'}
                  stroke="#fff"
                  strokeWidth={2}
                />
              )}
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}
