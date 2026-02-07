import { useTranslation } from 'react-i18next';
import { useUnits } from '../../contexts/UnitsContext';
import {
  distanceUnits, powerUnits, frequencyUnits,
  type DistanceUnit, type PowerUnit, type FrequencyUnit
} from '../../utils/unitConversions';

export default function UnitSelector() {
  const { t } = useTranslation();
  const {
    distanceUnit, powerUnit, frequencyUnit,
    setDistanceUnit, setPowerUnit, setFrequencyUnit
  } = useUnits();

  return (
    <div className="bg-white dark:bg-slate-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4 shadow-sm mb-5">
      <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-200 mb-3">{t('units.title')}</h3>
      <div className="flex flex-wrap gap-4">
        <div className="flex items-center gap-2">
          <label className="text-xs text-gray-500 dark:text-gray-400">{t('units.distance')}:</label>
          <select
            value={distanceUnit}
            onChange={e => setDistanceUnit(e.target.value as DistanceUnit)}
            className="px-2 py-1 text-xs border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-slate-700 dark:text-gray-100 outline-none focus:ring-1 focus:ring-indigo-500"
          >
            {distanceUnits.map(u => (
              <option key={u} value={u}>{t(`units.${u}`)}</option>
            ))}
          </select>
        </div>
        <div className="flex items-center gap-2">
          <label className="text-xs text-gray-500 dark:text-gray-400">{t('units.power')}:</label>
          <select
            value={powerUnit}
            onChange={e => setPowerUnit(e.target.value as PowerUnit)}
            className="px-2 py-1 text-xs border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-slate-700 dark:text-gray-100 outline-none focus:ring-1 focus:ring-indigo-500"
          >
            {powerUnits.map(u => (
              <option key={u} value={u}>{t(`units.${u}`)}</option>
            ))}
          </select>
        </div>
        <div className="flex items-center gap-2">
          <label className="text-xs text-gray-500 dark:text-gray-400">{t('units.frequency')}:</label>
          <select
            value={frequencyUnit}
            onChange={e => setFrequencyUnit(e.target.value as FrequencyUnit)}
            className="px-2 py-1 text-xs border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-slate-700 dark:text-gray-100 outline-none focus:ring-1 focus:ring-indigo-500"
          >
            {frequencyUnits.map(u => (
              <option key={u} value={u}>{t(`units.${u}`)}</option>
            ))}
          </select>
        </div>
      </div>
    </div>
  );
}
