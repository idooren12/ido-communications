import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useUnits } from '../../contexts/UnitsContext';
import { fromKm } from '../../utils/unitConversions';
import { generatePDF } from '../../utils/pdfExport';
import type { CalculationDetails as Details } from '../../utils/friisCalculations';
import CalculationDetails from './CalculationDetails';

interface DistanceResult {
  type: 'distance';
  distanceKm: number;
  details: Details;
}

interface PowerResult {
  type: 'power';
  receivedPowerDbm: number;
  details: Details;
}

export type CalcResult = DistanceResult | PowerResult;

interface Props {
  result: CalcResult;
}

export default function ResultDisplay({ result }: Props) {
  const { t, i18n } = useTranslation();
  const { distanceUnit } = useUnits();
  const [showDetails, setShowDetails] = useState(false);
  const [copied, setCopied] = useState(false);

  const isDistance = result.type === 'distance';

  let mainValue: string;
  let mainUnit: string;
  let subtitle: string;
  let warning: string | null = null;

  if (isDistance) {
    const km = result.distanceKm;
    const displayValue = fromKm(km, distanceUnit);
    mainValue = displayValue < 1 && distanceUnit === 'km'
      ? (km * 1000).toFixed(0)
      : displayValue.toFixed(2);
    mainUnit = displayValue < 1 && distanceUnit === 'km'
      ? t('result.meters')
      : distanceUnit;
    subtitle = t('result.maxRange');
    if (km > 1000) {
      warning = t('result.theoreticalOnly');
    }
  } else {
    mainValue = result.receivedPowerDbm.toFixed(2);
    mainUnit = 'dBm';
    subtitle = t('result.receivedPower');
  }

  const handleCopy = async () => {
    const text = `${mainValue} ${mainUnit}`;
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleExportPDF = () => {
    generatePDF({
      mode: result.type,
      txPowerWatts: result.details.txPowerDbm, // dBm value for display
      txGainDbi: result.details.totalGain / 2, // approximate
      rxGainDbi: result.details.totalGain / 2,
      frequencyMhz: result.details.frequencyMhz,
      sensitivityDbm: result.details.rxSensitivityDbm,
      distanceKm: result.details.distanceKm,
      resultValue: mainValue,
      resultUnit: mainUnit,
      details: result.details,
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
    });
  };

  return (
    <div className="animate-fadeIn">
      <div className="text-center py-8">
        <div className="inline-block bg-gradient-to-br from-indigo-500 to-purple-600 text-white rounded-2xl px-10 py-6 shadow-lg">
          <div className="text-4xl font-bold" dir="ltr">
            {mainValue} {mainUnit}
          </div>
        </div>

        <p className="text-gray-600 dark:text-gray-400 mt-4 text-sm">{subtitle}</p>

        {warning && (
          <p className="text-amber-600 text-sm mt-2 font-medium">{warning}</p>
        )}

        <div className="flex justify-center gap-3 mt-4">
          <button
            onClick={handleCopy}
            className="px-4 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-slate-700 transition-colors text-gray-700 dark:text-gray-200"
          >
            {copied ? t('pdf.copied') : t('pdf.copy')}
          </button>
          <button
            onClick={handleExportPDF}
            className="px-4 py-2 text-sm bg-indigo-100 dark:bg-indigo-900/50 text-indigo-700 dark:text-indigo-300 rounded-lg hover:bg-indigo-200 dark:hover:bg-indigo-900 transition-colors"
          >
            {t('pdf.export')}
          </button>
        </div>
      </div>

      <div className="bg-gray-50 dark:bg-slate-800 rounded-xl border border-gray-200 dark:border-gray-700">
        <button
          onClick={() => setShowDetails(!showDetails)}
          className="w-full flex items-center justify-between px-5 py-3 text-sm font-medium text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-slate-700 rounded-xl transition-colors"
        >
          <span>{showDetails ? t('result.hideDetails') : t('result.showDetails')}</span>
          <svg
            className={`w-5 h-5 transition-transform ${showDetails ? 'rotate-180' : ''}`}
            fill="none" viewBox="0 0 24 24" stroke="currentColor"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </button>

        {showDetails && (
          <div className="px-5 pb-4 border-t border-gray-200 dark:border-gray-700 pt-3">
            <CalculationDetails details={result.details} mode={result.type} />
          </div>
        )}
      </div>
    </div>
  );
}
