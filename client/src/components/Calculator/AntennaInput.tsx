import { useTranslation } from 'react-i18next';
import { useAuth } from '../../contexts/AuthContext';
import { useUnits } from '../../contexts/UnitsContext';
import type { Antenna } from '../../hooks/useAntennas';
import { validatePower, validateGain } from '../../utils/validation';
import { useState } from 'react';

interface Props {
  label: string;
  power: string;
  gain: string;
  onPowerChange: (v: string) => void;
  onGainChange: (v: string) => void;
  savedAntennas: Antenna[];
  onSelectSaved: (a: Antenna) => void;
  onSave: (name: string, power: number, gain: number) => void;
  powerHint?: string;
}

export default function AntennaInput({
  label, power, gain, onPowerChange, onGainChange,
  savedAntennas, onSelectSaved, onSave, powerHint
}: Props) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const { powerUnit } = useUnits();
  const [powerTouched, setPowerTouched] = useState(false);
  const [gainTouched, setGainTouched] = useState(false);
  const [saveName, setSaveName] = useState('');
  const [showSave, setShowSave] = useState(false);

  const powerError = powerTouched ? validatePower(power) : null;
  const gainError = gainTouched ? validateGain(gain) : null;

  const handleSave = () => {
    if (saveName && !validatePower(power) && !validateGain(gain)) {
      onSave(saveName, parseFloat(power), parseFloat(gain));
      setSaveName('');
      setShowSave(false);
    }
  };

  return (
    <div className="bg-white dark:bg-slate-800 rounded-xl border border-gray-200 dark:border-gray-700 p-5 shadow-sm">
      <h3 className="text-lg font-semibold text-gray-800 dark:text-gray-100 mb-4">{label}</h3>

      {user && savedAntennas.length > 0 && (
        <div className="mb-4">
          <select
            onChange={e => {
              const antenna = savedAntennas.find(a => a.id === e.target.value);
              if (antenna) onSelectSaved(antenna);
            }}
            className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-slate-700 dark:text-gray-100 focus:ring-2 focus:ring-indigo-500 outline-none"
            defaultValue=""
          >
            <option value="" disabled>{t('calculator.selectSaved')}</option>
            {savedAntennas.map(a => (
              <option key={a.id} value={a.id}>
                {a.name} ({a.powerWatts}W, {a.gainDbi} dBi)
              </option>
            ))}
          </select>
          <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">{t('calculator.orEnterManually')}</p>
        </div>
      )}

      <div className="space-y-3">
        <div>
          <label className="block text-sm font-medium text-gray-600 dark:text-gray-300 mb-1">
            {t('calculator.power')} ({powerUnit})
          </label>
          <input
            type="number"
            step="any"
            value={power}
            onChange={e => onPowerChange(e.target.value)}
            onBlur={() => setPowerTouched(true)}
            className={`w-full px-3 py-2 border rounded-lg outline-none focus:ring-2 focus:ring-indigo-500 ${
              powerError ? 'border-red-400 focus:ring-red-400' : 'border-gray-300 dark:border-gray-600 dark:bg-slate-700 dark:text-gray-100'
            }`}
            dir="ltr"
          />
          {powerError && <p className="text-xs text-red-500 mt-1">{t(powerError)}</p>}
          {powerHint && !powerError && <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">{powerHint}</p>}
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-600 dark:text-gray-300 mb-1">
            {t('calculator.gain')} (dBi)
          </label>
          <input
            type="number"
            step="any"
            value={gain}
            onChange={e => onGainChange(e.target.value)}
            onBlur={() => setGainTouched(true)}
            className={`w-full px-3 py-2 border rounded-lg outline-none focus:ring-2 focus:ring-indigo-500 ${
              gainError ? 'border-red-400 focus:ring-red-400' : 'border-gray-300 dark:border-gray-600 dark:bg-slate-700 dark:text-gray-100'
            }`}
            dir="ltr"
          />
          {gainError && <p className="text-xs text-red-500 mt-1">{t(gainError)}</p>}
        </div>
      </div>

      {user && (
        <div className="mt-4">
          {!showSave ? (
            <button
              onClick={() => setShowSave(true)}
              disabled={!!validatePower(power) || !!validateGain(gain)}
              className="text-sm text-indigo-600 hover:text-indigo-700 disabled:text-gray-400 dark:disabled:text-gray-600 disabled:cursor-not-allowed"
            >
              {t('calculator.saveAntenna')}
            </button>
          ) : (
            <div className="flex gap-2">
              <input
                type="text"
                value={saveName}
                onChange={e => setSaveName(e.target.value)}
                placeholder={t('antennas.antennaName')}
                className="flex-1 px-3 py-1.5 border border-gray-300 dark:border-gray-600 dark:bg-slate-700 dark:text-gray-100 rounded-lg text-sm outline-none focus:ring-2 focus:ring-indigo-500"
              />
              <button
                onClick={handleSave}
                disabled={!saveName}
                className="px-3 py-1.5 text-sm bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50"
              >
                {t('antennas.save')}
              </button>
              <button
                onClick={() => { setShowSave(false); setSaveName(''); }}
                className="px-3 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-slate-600"
              >
                {t('antennas.cancel')}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
