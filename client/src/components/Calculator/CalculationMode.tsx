import { useTranslation } from 'react-i18next';
import { useUnits } from '../../contexts/UnitsContext';
import { validateFrequency, validateSensitivity, validateDistance } from '../../utils/validation';
import { FREQUENCY_PRESETS } from '../../utils/rfSafetyCalculations';
import { fromMhz } from '../../utils/unitConversions';
import { useState } from 'react';

export type CalcMode = 'distance' | 'power';

interface Props {
  mode: CalcMode;
  onModeChange: (m: CalcMode) => void;
  frequency: string;
  onFrequencyChange: (v: string) => void;
  sensitivity: string;
  onSensitivityChange: (v: string) => void;
  distance: string;
  onDistanceChange: (v: string) => void;
}

export default function CalculationMode({
  mode, onModeChange,
  frequency, onFrequencyChange,
  sensitivity, onSensitivityChange,
  distance, onDistanceChange
}: Props) {
  const { t } = useTranslation();
  const { distanceUnit, frequencyUnit } = useUnits();
  const [freqTouched, setFreqTouched] = useState(false);
  const [sensTouched, setSensTouched] = useState(false);
  const [distTouched, setDistTouched] = useState(false);

  const freqError = freqTouched ? validateFrequency(frequency) : null;
  const sensError = sensTouched && mode === 'distance' ? validateSensitivity(sensitivity) : null;
  const distError = distTouched && mode === 'power' ? validateDistance(distance) : null;

  return (
    <div className="bg-white dark:bg-slate-800 rounded-xl border border-gray-200 dark:border-gray-700 p-5 shadow-sm">
      <h3 className="text-lg font-semibold text-gray-800 dark:text-gray-100 mb-4">{t('calculator.sharedParams')}</h3>

      <div className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-gray-600 dark:text-gray-300 mb-1">
            {t('calculator.frequency')} ({frequencyUnit})
          </label>
          <input
            type="number"
            step="any"
            value={frequency}
            onChange={e => onFrequencyChange(e.target.value)}
            onBlur={() => setFreqTouched(true)}
            className={`w-full px-3 py-2 border rounded-lg outline-none focus:ring-2 focus:ring-indigo-500 ${
              freqError ? 'border-red-400 focus:ring-red-400' : 'border-gray-300 dark:border-gray-600 dark:bg-slate-700 dark:text-gray-100'
            }`}
            dir="ltr"
          />
          {freqError && <p className="text-xs text-red-500 mt-1">{t(freqError)}</p>}
          <div className="flex flex-wrap gap-1.5 mt-1.5">
            {FREQUENCY_PRESETS.map((p) => (
              <button
                key={p.mhz}
                type="button"
                onClick={() => onFrequencyChange(fromMhz(p.mhz, frequencyUnit).toString())}
                className="px-2 py-0.5 text-xs bg-gray-100 dark:bg-slate-600 text-gray-600 dark:text-gray-300 rounded hover:bg-indigo-100 dark:hover:bg-indigo-900/50 hover:text-indigo-600 dark:hover:text-indigo-300 transition-colors"
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>

        <div className="bg-gray-50 dark:bg-slate-700/50 rounded-lg p-4">
          <p className="text-sm font-medium text-gray-700 dark:text-gray-200 mb-3">{t('calculator.calcMode')}</p>

          <div className="space-y-3">
            <label className="flex items-start gap-3 cursor-pointer">
              <input
                type="radio"
                checked={mode === 'distance'}
                onChange={() => onModeChange('distance')}
                className="mt-1 accent-indigo-600"
              />
              <div className="flex-1">
                <span className="text-sm font-medium">{t('calculator.calcDistance')}</span>
                {mode === 'distance' && (
                  <div className="mt-2">
                    <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">
                      {t('calculator.sensitivity')} (dBm)
                    </label>
                    <input
                      type="number"
                      step="any"
                      value={sensitivity}
                      onChange={e => onSensitivityChange(e.target.value)}
                      onBlur={() => setSensTouched(true)}
                      className={`w-full px-3 py-2 border rounded-lg outline-none text-sm focus:ring-2 focus:ring-indigo-500 ${
                        sensError ? 'border-red-400 focus:ring-red-400' : 'border-gray-300 dark:border-gray-600 dark:bg-slate-700 dark:text-gray-100'
                      }`}
                      dir="ltr"
                    />
                    {sensError && <p className="text-xs text-red-500 mt-1">{t(sensError)}</p>}
                  </div>
                )}
              </div>
            </label>

            <label className="flex items-start gap-3 cursor-pointer">
              <input
                type="radio"
                checked={mode === 'power'}
                onChange={() => onModeChange('power')}
                className="mt-1 accent-indigo-600"
              />
              <div className="flex-1">
                <span className="text-sm font-medium">{t('calculator.calcPower')}</span>
                {mode === 'power' && (
                  <div className="mt-2">
                    <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">
                      {t('calculator.distance')} ({distanceUnit})
                    </label>
                    <input
                      type="number"
                      step="any"
                      value={distance}
                      onChange={e => onDistanceChange(e.target.value)}
                      onBlur={() => setDistTouched(true)}
                      className={`w-full px-3 py-2 border rounded-lg outline-none text-sm focus:ring-2 focus:ring-indigo-500 ${
                        distError ? 'border-red-400 focus:ring-red-400' : 'border-gray-300 dark:border-gray-600 dark:bg-slate-700 dark:text-gray-100'
                      }`}
                      dir="ltr"
                    />
                    {distError && <p className="text-xs text-red-500 mt-1">{t(distError)}</p>}
                  </div>
                )}
              </div>
            </label>
          </div>
        </div>
      </div>
    </div>
  );
}
