import { useTranslation } from 'react-i18next';
import { useUnits } from '../../contexts/UnitsContext';
import { fromKm } from '../../utils/unitConversions';

interface ScenarioResult {
  index: number;
  distanceKm: number;
  receivedPowerDbm: number;
}

interface Props {
  results: ScenarioResult[];
}

export default function ScenarioTable({ results }: Props) {
  const { t } = useTranslation();
  const { distanceUnit } = useUnits();

  if (results.length === 0) return null;

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm border-collapse">
        <thead>
          <tr className="border-b border-gray-200 dark:border-gray-700">
            <th className="text-start px-3 py-2 text-gray-600 dark:text-gray-300 font-medium">{t('scenarios.scenario')}</th>
            <th className="text-start px-3 py-2 text-gray-600 dark:text-gray-300 font-medium">{t('result.maxRange')} ({distanceUnit})</th>
            <th className="text-start px-3 py-2 text-gray-600 dark:text-gray-300 font-medium">{t('result.receivedPower')} (dBm)</th>
          </tr>
        </thead>
        <tbody>
          {results.map((r) => (
            <tr key={r.index} className="border-b border-gray-100 dark:border-gray-700/50">
              <td className="px-3 py-2 font-medium text-gray-800 dark:text-gray-100">
                {t('scenarios.scenario')} {r.index + 1}
              </td>
              <td className="px-3 py-2 font-mono text-gray-700 dark:text-gray-200" dir="ltr">
                {fromKm(r.distanceKm, distanceUnit).toFixed(2)}
              </td>
              <td className="px-3 py-2 font-mono text-gray-700 dark:text-gray-200" dir="ltr">
                {r.receivedPowerDbm.toFixed(2)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
