import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useUnits } from '../../contexts/UnitsContext';
import { fromKm } from '../../utils/unitConversions';
import { generatePDF } from '../../utils/pdfExport';
import type {
  RealisticResult,
  RealisticPowerResult,
  EnvironmentLoss,
  AtmosphericLoss,
} from '../../utils/realisticCalculations';

// ── Types ──────────────────────────────────────────────────────────────

type RealisticDistanceCalcResult = {
  type: 'realistic_distance';
} & RealisticResult;

type RealisticPowerCalcResult = {
  type: 'realistic_power';
} & RealisticPowerResult;

export type RealisticCalcResult =
  | RealisticDistanceCalcResult
  | RealisticPowerCalcResult;

interface Props {
  result: RealisticCalcResult;
  regionNameHe: string;
  regionNameEn: string;
}

// ── Helpers ────────────────────────────────────────────────────────────

interface LossRow {
  labelKey: string;
  value: number;
}

function envLossRows(env: EnvironmentLoss): LossRow[] {
  return [
    { labelKey: 'realistic.lossBreakdown.pathLossExcess', value: env.pathLossExcessDb },
    { labelKey: 'realistic.lossBreakdown.vegetation', value: env.vegetationDb },
    { labelKey: 'realistic.lossBreakdown.urbanClutter', value: env.urbanClutterDb },
    { labelKey: 'realistic.lossBreakdown.terrain', value: env.terrainDb },
  ];
}

function atmosLossRows(atmos: AtmosphericLoss): LossRow[] {
  return [
    { labelKey: 'realistic.lossBreakdown.rain', value: atmos.rainDb },
    { labelKey: 'realistic.lossBreakdown.fog', value: atmos.fogDb },
    { labelKey: 'realistic.lossBreakdown.humidity', value: atmos.humidityDb },
    { labelKey: 'realistic.lossBreakdown.dust', value: atmos.dustDb },
  ];
}

function visibleRows(rows: LossRow[]): LossRow[] {
  return rows.filter((r) => r.value > 0.1);
}

// ── Component ──────────────────────────────────────────────────────────

export default function RealisticResultDisplay({
  result,
  regionNameHe,
  regionNameEn,
}: Props) {
  const { t, i18n } = useTranslation();
  const { distanceUnit } = useUnits();
  const [showDetails, setShowDetails] = useState(false);
  const [copied, setCopied] = useState(false);

  const isDistance = result.type === 'realistic_distance';
  const regionName = i18n.language === 'he' ? regionNameHe : regionNameEn;

  // ── Derive display values ──────────────────────────────────────────

  let primaryLabel: string;
  let primaryValue: string;
  let primaryUnit: string;
  let secondaryLabel: string;
  let secondaryValue: string;
  let secondaryUnit: string;
  let badgeText: string;
  let barPercent: number;
  let totalExtra: number;
  let environmentLoss: EnvironmentLoss;
  let atmosphericLoss: AtmosphericLoss;
  let fsplDb: number | null;
  let recommendations: string[];

  if (isDistance) {
    const r = result as RealisticDistanceCalcResult;
    const realisticDisplay = fromKm(r.realisticDistanceKm, distanceUnit);
    const freeSpaceDisplay = fromKm(r.freeSpaceDistanceKm, distanceUnit);

    primaryLabel = t('realistic.result.realisticRange');
    primaryValue = realisticDisplay.toFixed(2);
    primaryUnit = distanceUnit;
    secondaryLabel = t('realistic.result.freeSpaceRange');
    secondaryValue = freeSpaceDisplay.toFixed(2);
    secondaryUnit = distanceUnit;
    badgeText = `-${r.reductionPercent.toFixed(0)}%`;
    barPercent =
      r.freeSpaceDistanceKm > 0
        ? (r.realisticDistanceKm / r.freeSpaceDistanceKm) * 100
        : 0;
    totalExtra = r.totalExtraLossDb;
    environmentLoss = r.environmentLoss;
    atmosphericLoss = r.atmosphericLoss;
    fsplDb = r.freeSpaceFsplDb;
    recommendations = r.recommendations;
  } else {
    const r = result as RealisticPowerCalcResult;

    primaryLabel = t('realistic.result.realisticPower');
    primaryValue = r.realisticPowerDbm.toFixed(1);
    primaryUnit = 'dBm';
    secondaryLabel = t('realistic.result.freeSpacePower');
    secondaryValue = r.freeSpacePowerDbm.toFixed(1);
    secondaryUnit = 'dBm';
    badgeText = `+${r.extraLossDb.toFixed(1)} dB`;
    // Bar: realistic power is lower (more negative), express as fraction
    // We use absolute values relative to free-space
    const absFree = Math.abs(r.freeSpacePowerDbm);
    const absReal = Math.abs(r.realisticPowerDbm);
    barPercent = absReal > 0 ? Math.max(0, Math.min(100, (absFree / absReal) * 100)) : 0;
    totalExtra = r.extraLossDb;
    environmentLoss = r.environmentLoss;
    atmosphericLoss = r.atmosphericLoss;
    fsplDb = null;
    recommendations = r.recommendations;
  }

  // Clamp bar to valid range
  barPercent = Math.max(0, Math.min(100, barPercent));

  // ── Loss breakdown rows ────────────────────────────────────────────

  const envRows = visibleRows(envLossRows(environmentLoss));
  const atmosRows = visibleRows(atmosLossRows(atmosphericLoss));

  // ── Render ─────────────────────────────────────────────────────────

  return (
    <div className="animate-fadeIn space-y-4">
      {/* Region label */}
      <p className="text-center text-sm text-gray-500 dark:text-gray-400">
        {regionName}
      </p>

      {/* Section 1: Dual Result Display */}
      <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
        {/* Primary — realistic */}
        <div className="bg-gradient-to-br from-emerald-500 to-teal-600 text-white rounded-2xl px-8 py-5 shadow-lg text-center">
          <div className="text-sm font-medium text-emerald-100">
            {primaryLabel}
          </div>
          <div className="text-3xl font-bold mt-1" dir="ltr">
            {primaryValue} {primaryUnit}
          </div>
        </div>

        {/* Reduction badge */}
        <div className="bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400 rounded-full px-3 py-1 text-sm font-bold">
          {badgeText}
        </div>

        {/* Secondary — free-space */}
        <div className="bg-gradient-to-br from-gray-400 to-gray-500 text-white rounded-2xl px-6 py-4 shadow-md opacity-75 text-center">
          <div className="text-xs font-medium text-gray-200">
            {secondaryLabel}
          </div>
          <div className="text-xl font-bold mt-1" dir="ltr">
            {secondaryValue} {secondaryUnit}
          </div>
        </div>
      </div>

      {/* Section 2: Comparison Bar */}
      <div className="bg-gray-100 dark:bg-slate-700 rounded-full h-6 overflow-hidden mt-4 relative">
        <div
          className="bg-gradient-to-r from-emerald-400 to-teal-500 h-full rounded-full transition-all duration-700 ease-out flex items-center justify-center"
          style={{ width: `${barPercent}%` }}
        >
          {barPercent > 15 && (
            <span className="text-xs font-bold text-white drop-shadow">
              {barPercent.toFixed(0)}%
            </span>
          )}
        </div>
        {barPercent <= 15 && (
          <span className="absolute inset-0 flex items-center justify-center text-xs font-bold text-gray-500 dark:text-gray-300">
            {barPercent.toFixed(0)}%
          </span>
        )}
      </div>

      {/* Copy + PDF buttons */}
      <div className="flex justify-center gap-3 mt-2">
        <button
          onClick={async () => {
            const text = `${primaryValue} ${primaryUnit} (${secondaryValue} ${secondaryUnit} free-space)`;
            await navigator.clipboard.writeText(text);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
          }}
          className="px-4 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-slate-700 transition-colors text-gray-700 dark:text-gray-200"
        >
          {copied ? t('pdf.copied') : t('pdf.copy')}
        </button>
        <button
          onClick={() => {
            const allRows = [...envRows, ...atmosRows].map(r => ({
              label: t(r.labelKey),
              value: r.value,
            }));
            generatePDF({
              mode: isDistance ? 'distance' : 'power',
              txPowerWatts: 0,
              txGainDbi: 0,
              rxGainDbi: 0,
              frequencyMhz: 0,
              resultValue: primaryValue,
              resultUnit: primaryUnit,
              details: {
                txPowerDbm: 0,
                totalGain: 0,
                frequencyMhz: 0,
              },
              labels: {
                title: t('pdf.title'),
                date: t('pdf.date'),
                txAntenna: t('pdf.txAntenna'),
                rxAntenna: t('pdf.rxAntenna'),
                power: t('calculator.power'),
                gain: t('calculator.gain'),
                frequency: t('calculator.frequency'),
                sensitivity: t('calculator.sensitivity'),
                distance: t('calculator.distance'),
                result: t('pdf.result'),
                calculationDetails: t('pdf.calculationDetails'),
                txPower: t('result.details.txPower'),
                totalGain: t('result.details.totalGain'),
                maxFSPL: t('result.details.maxFSPL'),
                fspl: t('result.details.fspl'),
                note: t('pdf.note'),
              },
              isRtl: i18n.language === 'he',
              realisticData: {
                regionName: regionName,
                weatherDescription: '',
                realisticValue: primaryValue,
                freeSpaceValue: secondaryValue,
                reductionPercent: badgeText,
                resultUnit: primaryUnit,
                totalExtraLoss: totalExtra,
                lossRows: allRows,
                labels: {
                  realisticSection: t('pdf.realisticSection'),
                  region: t('pdf.region'),
                  weather: t('pdf.weather'),
                  realisticRange: t('pdf.realisticRange'),
                  freeSpaceRange: t('pdf.freeSpaceRange'),
                  reduction: t('pdf.reduction'),
                  lossBreakdown: t('pdf.lossBreakdown'),
                  totalExtra: t('realistic.lossBreakdown.totalExtra'),
                },
              },
            });
          }}
          className="px-4 py-2 text-sm bg-emerald-100 dark:bg-emerald-900/50 text-emerald-700 dark:text-emerald-300 rounded-lg hover:bg-emerald-200 dark:hover:bg-emerald-900 transition-colors"
        >
          {t('pdf.export')}
        </button>
      </div>

      {/* Section 3: Loss Breakdown (collapsible) */}
      <div className="bg-gray-50 dark:bg-slate-800 rounded-xl border border-gray-200 dark:border-gray-700">
        <button
          onClick={() => setShowDetails(!showDetails)}
          className="w-full flex items-center justify-between px-5 py-3 text-sm font-medium text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-slate-700 rounded-xl transition-colors"
        >
          <span>{t('realistic.lossBreakdown.title')}</span>
          <svg
            className={`w-5 h-5 transition-transform ${showDetails ? 'rotate-180' : ''}`}
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M19 9l-7 7-7-7"
            />
          </svg>
        </button>

        {showDetails && (
          <div className="px-5 pb-4 border-t border-gray-200 dark:border-gray-700 pt-3">
            <div className="divide-y divide-gray-200 dark:divide-gray-700" dir="ltr">
              {/* FSPL (distance mode only) */}
              {fsplDb !== null && (
                <div className="flex justify-between py-2 px-4 text-sm">
                  <span className="text-gray-600 dark:text-gray-400">
                    {t('realistic.lossBreakdown.fspl')}
                  </span>
                  <span className="font-mono text-gray-900 dark:text-gray-100">
                    {fsplDb.toFixed(1)} dB
                  </span>
                </div>
              )}

              {/* Environment losses group */}
              {envRows.length > 0 && (
                <>
                  <div className="py-2 px-4">
                    <span className="text-xs font-semibold uppercase tracking-wider text-emerald-600 dark:text-emerald-400">
                      {t('realistic.lossBreakdown.environmentGroup')}
                    </span>
                  </div>
                  {envRows.map((row) => (
                    <div
                      key={row.labelKey}
                      className="flex justify-between py-2 px-4 text-sm"
                    >
                      <span className="text-gray-600 dark:text-gray-400">
                        {t(row.labelKey)}
                      </span>
                      <span className="font-mono text-gray-900 dark:text-gray-100">
                        +{row.value.toFixed(1)} dB
                      </span>
                    </div>
                  ))}
                </>
              )}

              {/* Atmospheric losses group */}
              {atmosRows.length > 0 ? (
                <>
                  <div className="py-2 px-4">
                    <span className="text-xs font-semibold uppercase tracking-wider text-sky-600 dark:text-sky-400">
                      {t('realistic.lossBreakdown.atmosphericGroup')}
                    </span>
                  </div>
                  {atmosRows.map((row) => (
                    <div
                      key={row.labelKey}
                      className="flex justify-between py-2 px-4 text-sm"
                    >
                      <span className="text-gray-600 dark:text-gray-400">
                        {t(row.labelKey)}
                      </span>
                      <span className="font-mono text-gray-900 dark:text-gray-100">
                        +{row.value.toFixed(1)} dB
                      </span>
                    </div>
                  ))}
                </>
              ) : (
                <div className="py-2 px-4 text-sm text-gray-400 dark:text-gray-500 italic">
                  {t('realistic.lossBreakdown.noAtmosphericLoss')}
                </div>
              )}

              {/* Total extra loss */}
              <div className="flex justify-between py-3 px-4 text-sm font-bold">
                <span className="text-gray-800 dark:text-gray-100">
                  {t('realistic.lossBreakdown.totalExtra')}
                </span>
                <span className="font-mono text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 rounded-md px-2 py-0.5">
                  +{totalExtra.toFixed(1)} dB
                </span>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Section 4: Recommendations */}
      {recommendations.length > 0 && (
        <div className="bg-amber-50 dark:bg-amber-900/10 border border-amber-200 dark:border-amber-800 rounded-xl p-4 mt-4">
          <h4 className="font-semibold text-amber-800 dark:text-amber-300 mb-2">
            {t('realistic.recommendations.title')}
          </h4>
          <ul className="list-disc list-inside text-sm text-amber-700 dark:text-amber-500 space-y-1.5">
            {recommendations.map((key) => (
              <li key={key}>{t(`realistic.recommendations.${key}`)}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
