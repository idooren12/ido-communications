import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAntennas } from '../hooks/useAntennas';
import { useAuth } from '../contexts/AuthContext';
import {
  calculateSafeDistance,
  getICNIRPLimit,
  type PopulationType,
  type RFSafetyResult,
} from '../utils/rfSafetyCalculations';

export default function RFSafety() {
  const { t } = useTranslation();
  const { antennas } = useAntennas();
  const { user } = useAuth();

  const [power, setPower] = useState('');
  const [gain, setGain] = useState('');
  const [frequency, setFrequency] = useState('');
  const [population, setPopulation] = useState<PopulationType>('public');
  const [densityMode, setDensityMode] = useState<'auto' | 'manual'>('auto');
  const [manualDensity, setManualDensity] = useState('');
  const [result, setResult] = useState<RFSafetyResult | null>(null);
  const [error, setError] = useState('');
  const [showDetails, setShowDetails] = useState(false);

  const handleSelectAntenna = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const antenna = antennas.find(a => a.id === e.target.value);
    if (antenna) {
      setPower(antenna.powerWatts.toString());
      setGain(antenna.gainDbi.toString());
    }
  };

  const handleCalculate = () => {
    setError('');
    setResult(null);

    const p = parseFloat(power);
    const g = parseFloat(gain);

    if (isNaN(p) || p <= 0) { setError(t('errors.powerPositive')); return; }
    if (isNaN(g)) { setError(t('errors.gainNumber')); return; }

    let densityLimit: number;

    if (densityMode === 'auto') {
      const f = parseFloat(frequency);
      if (isNaN(f) || f <= 0) { setError(t('errors.frequencyPositive')); return; }
      densityLimit = getICNIRPLimit(f, population);
    } else {
      const d = parseFloat(manualDensity);
      if (isNaN(d) || d <= 0) { setError(t('errors.powerPositive')); return; }
      densityLimit = d;
    }

    try {
      const res = calculateSafeDistance(p, g, densityLimit);
      if (!isFinite(res.safeDistanceMeters) || res.safeDistanceMeters <= 0) {
        setError(t('errors.calculationError'));
        return;
      }
      setResult(res);
    } catch {
      setError(t('errors.calculationError'));
    }
  };

  const autoLimit = (() => {
    const f = parseFloat(frequency);
    if (densityMode === 'auto' && !isNaN(f) && f > 0) {
      return getICNIRPLimit(f, population);
    }
    return null;
  })();

  return (
    <div className="max-w-3xl mx-auto px-4 py-8">
      <div className="text-center mb-8">
        <h1 className="text-2xl md:text-3xl font-bold text-gray-900 dark:text-gray-100">
          {t('rfSafety.title')}
        </h1>
        <p className="mt-2 text-gray-600 dark:text-gray-400">{t('rfSafety.subtitle')}</p>
      </div>

      {/* Transmitter Details */}
      <div className="bg-white dark:bg-slate-800 rounded-xl border border-gray-200 dark:border-gray-700 p-6 mb-5">
        <h2 className="text-lg font-semibold text-gray-800 dark:text-gray-200 mb-4">{t('rfSafety.transmitterDetails')}</h2>

        {user && antennas.length > 0 && (
          <div className="mb-4">
            <select
              onChange={handleSelectAntenna}
              defaultValue=""
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 dark:bg-slate-700 dark:text-gray-100 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none"
            >
              <option value="" disabled>{t('calculator.selectSaved')}</option>
              {antennas.map(a => (
                <option key={a.id} value={a.id}>{a.name} ({a.powerWatts}W, {a.gainDbi}dBi)</option>
              ))}
            </select>
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              {t('calculator.power')} ({t('calculator.powerUnit')})
            </label>
            <input
              type="number"
              value={power}
              onChange={e => setPower(e.target.value)}
              min="0"
              step="any"
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 dark:bg-slate-700 dark:text-gray-100 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none"
              dir="ltr"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              {t('calculator.gain')} (dBi)
            </label>
            <input
              type="number"
              value={gain}
              onChange={e => setGain(e.target.value)}
              step="any"
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 dark:bg-slate-700 dark:text-gray-100 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none"
              dir="ltr"
            />
          </div>
        </div>

        {densityMode === 'auto' && (
          <div className="mt-4">
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              {t('calculator.frequency')} (MHz)
            </label>
            <input
              type="number"
              value={frequency}
              onChange={e => setFrequency(e.target.value)}
              min="0"
              step="any"
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 dark:bg-slate-700 dark:text-gray-100 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none"
              dir="ltr"
            />
          </div>
        )}
      </div>

      {/* Safety Standard */}
      <div className="bg-white dark:bg-slate-800 rounded-xl border border-gray-200 dark:border-gray-700 p-6 mb-5">
        <h2 className="text-lg font-semibold text-gray-800 dark:text-gray-200 mb-4">{t('rfSafety.safetyStandard')}</h2>

        <div className="mb-4">
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">{t('rfSafety.populationType')}</label>
          <div className="space-y-2">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="radio"
                name="population"
                checked={population === 'public'}
                onChange={() => setPopulation('public')}
                className="text-indigo-600"
              />
              <span className="text-sm text-gray-700 dark:text-gray-300">{t('rfSafety.generalPublic')}</span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="radio"
                name="population"
                checked={population === 'occupational'}
                onChange={() => setPopulation('occupational')}
                className="text-indigo-600"
              />
              <span className="text-sm text-gray-700 dark:text-gray-300">{t('rfSafety.occupational')}</span>
            </label>
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">{t('rfSafety.powerDensity')}</label>
          <div className="space-y-2">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="radio"
                name="densityMode"
                checked={densityMode === 'auto'}
                onChange={() => setDensityMode('auto')}
                className="text-indigo-600"
              />
              <span className="text-sm text-gray-700 dark:text-gray-300">{t('rfSafety.autoByFreq')}</span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="radio"
                name="densityMode"
                checked={densityMode === 'manual'}
                onChange={() => setDensityMode('manual')}
                className="text-indigo-600"
              />
              <span className="text-sm text-gray-700 dark:text-gray-300">{t('rfSafety.manual')}</span>
            </label>
          </div>

          {densityMode === 'manual' && (
            <div className="mt-3">
              <input
                type="number"
                value={manualDensity}
                onChange={e => setManualDensity(e.target.value)}
                min="0"
                step="any"
                placeholder="W/m²"
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 dark:bg-slate-700 dark:text-gray-100 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none"
                dir="ltr"
              />
            </div>
          )}

          {autoLimit !== null && (
            <p className="mt-2 text-sm text-indigo-600 dark:text-indigo-400">
              S = {autoLimit.toFixed(2)} W/m²
            </p>
          )}
        </div>
      </div>

      {/* Calculate Button */}
      <div className="text-center mb-6">
        <button
          onClick={handleCalculate}
          className="px-10 py-3 bg-indigo-600 text-white rounded-xl font-bold text-lg hover:bg-indigo-700 disabled:opacity-40 disabled:cursor-not-allowed transition-all shadow-md hover:shadow-lg"
        >
          {t('calculator.calculate')}
        </button>
      </div>

      {/* Error */}
      {error && (
        <div className="mb-6 p-4 text-red-700 dark:text-red-400 bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 rounded-xl text-center">
          {error}
        </div>
      )}

      {/* Result */}
      {result && (
        <div className="space-y-4">
          {/* Main result */}
          <div className="bg-amber-50 dark:bg-amber-900/20 border-2 border-amber-400 dark:border-amber-600 rounded-xl p-6 text-center">
            <div className="text-4xl font-bold text-amber-700 dark:text-amber-400">
              {result.safeDistanceMeters.toFixed(2)} {t('result.meters')}
            </div>
            <div className="mt-2 text-amber-600 dark:text-amber-500 font-medium">
              {t('rfSafety.safeDistance')}
            </div>
          </div>

          {/* Calculation Details */}
          <div className="bg-white dark:bg-slate-800 rounded-xl border border-gray-200 dark:border-gray-700 p-6">
            <button
              onClick={() => setShowDetails(!showDetails)}
              className="flex items-center gap-2 text-sm font-medium text-indigo-600 dark:text-indigo-400 hover:underline"
            >
              {showDetails ? t('result.hideDetails') : t('result.showDetails')}
              <svg className={`w-4 h-4 transition-transform ${showDetails ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </button>

            {showDetails && (
              <div className="mt-4 space-y-2 text-sm text-gray-700 dark:text-gray-300" dir="ltr">
                <div className="flex justify-between">
                  <span>{t('calculator.power')}:</span>
                  <span className="font-mono">{result.powerWatts} W</span>
                </div>
                <div className="flex justify-between">
                  <span>{t('calculator.gain')}:</span>
                  <span className="font-mono">{result.gainDbi} dBi</span>
                </div>
                <div className="flex justify-between">
                  <span>{t('rfSafety.gainLinear')}:</span>
                  <span className="font-mono">{result.gainLinear.toFixed(2)}</span>
                </div>
                <div className="flex justify-between">
                  <span>{t('rfSafety.eirp')}:</span>
                  <span className="font-mono">{result.eirpWatts.toFixed(2)} W</span>
                </div>
                <div className="flex justify-between">
                  <span>{t('rfSafety.powerDensity')}:</span>
                  <span className="font-mono">{result.powerDensityLimit.toFixed(2)} W/m²</span>
                </div>
                <hr className="border-gray-200 dark:border-gray-600" />
                <div className="flex justify-between font-medium">
                  <span>R = sqrt({result.eirpWatts.toFixed(2)} / (4{'\u03C0'} x {result.powerDensityLimit.toFixed(2)}))</span>
                  <span className="font-mono">{result.safeDistanceMeters.toFixed(2)} m</span>
                </div>
              </div>
            )}
          </div>

          {/* Safety Notes */}
          <div className="bg-amber-50 dark:bg-amber-900/10 border border-amber-200 dark:border-amber-800 rounded-xl p-6">
            <h3 className="text-sm font-semibold text-amber-800 dark:text-amber-400 mb-3">{t('rfSafety.safetyNotes')}</h3>
            <ul className="text-sm text-amber-700 dark:text-amber-500 space-y-1.5 list-disc list-inside">
              <li>{t('rfSafety.note1')}</li>
              <li>{t('rfSafety.note2')}</li>
              <li>{t('rfSafety.note3')}</li>
              <li>{t('rfSafety.note4')}</li>
            </ul>
          </div>
        </div>
      )}
    </div>
  );
}
