import { useTranslation } from 'react-i18next';
import { useUnits } from '../../contexts/UnitsContext';

export interface Scenario {
  id: number;
  txPower: string;
  txGain: string;
  rxGain: string;
  frequency: string;
  sensitivity: string;
}

interface Props {
  scenario: Scenario;
  index: number;
  onChange: (id: number, field: keyof Omit<Scenario, 'id'>, value: string) => void;
  onClone: (id: number) => void;
  onRemove: (id: number) => void;
}

export default function ScenarioCard({ scenario, index, onChange, onClone, onRemove }: Props) {
  const { t } = useTranslation();
  const { powerUnit, frequencyUnit } = useUnits();

  const inputClass = "w-full px-2 py-1.5 border border-gray-300 dark:border-gray-600 rounded-md text-sm bg-white dark:bg-slate-700 dark:text-gray-100 outline-none focus:ring-1 focus:ring-indigo-500";

  return (
    <div className="bg-white dark:bg-slate-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4 shadow-sm">
      <div className="flex items-center justify-between mb-3">
        <h4 className="font-semibold text-gray-800 dark:text-gray-100">
          {t('scenarios.scenario')} {index + 1}
        </h4>
        <div className="flex gap-2">
          <button
            onClick={() => onClone(scenario.id)}
            className="px-2 py-1 text-xs border border-gray-300 dark:border-gray-600 rounded hover:bg-gray-50 dark:hover:bg-slate-700 transition-colors text-gray-600 dark:text-gray-300"
          >
            {t('scenarios.clone')}
          </button>
          <button
            onClick={() => onRemove(scenario.id)}
            className="px-2 py-1 text-xs border border-red-200 dark:border-red-800 text-red-600 dark:text-red-400 rounded hover:bg-red-50 dark:hover:bg-red-900/30 transition-colors"
          >
            {t('scenarios.remove')}
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="block text-xs text-gray-500 dark:text-gray-400 mb-0.5">
            {t('calculator.power')} ({powerUnit})
          </label>
          <input
            type="number" step="any" value={scenario.txPower}
            onChange={e => onChange(scenario.id, 'txPower', e.target.value)}
            className={inputClass} dir="ltr"
          />
        </div>
        <div>
          <label className="block text-xs text-gray-500 dark:text-gray-400 mb-0.5">
            TX {t('calculator.gain')} (dBi)
          </label>
          <input
            type="number" step="any" value={scenario.txGain}
            onChange={e => onChange(scenario.id, 'txGain', e.target.value)}
            className={inputClass} dir="ltr"
          />
        </div>
        <div>
          <label className="block text-xs text-gray-500 dark:text-gray-400 mb-0.5">
            RX {t('calculator.gain')} (dBi)
          </label>
          <input
            type="number" step="any" value={scenario.rxGain}
            onChange={e => onChange(scenario.id, 'rxGain', e.target.value)}
            className={inputClass} dir="ltr"
          />
        </div>
        <div>
          <label className="block text-xs text-gray-500 dark:text-gray-400 mb-0.5">
            {t('calculator.frequency')} ({frequencyUnit})
          </label>
          <input
            type="number" step="any" value={scenario.frequency}
            onChange={e => onChange(scenario.id, 'frequency', e.target.value)}
            className={inputClass} dir="ltr"
          />
        </div>
        <div className="col-span-2">
          <label className="block text-xs text-gray-500 dark:text-gray-400 mb-0.5">
            {t('calculator.sensitivity')} (dBm)
          </label>
          <input
            type="number" step="any" value={scenario.sensitivity}
            onChange={e => onChange(scenario.id, 'sensitivity', e.target.value)}
            className={inputClass} dir="ltr"
          />
        </div>
      </div>
    </div>
  );
}
