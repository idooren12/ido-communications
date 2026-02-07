import { useTranslation } from 'react-i18next';

interface ScenarioResult {
  index: number;
  distanceKm: number;
  receivedPowerDbm: number;
}

interface Props {
  results: ScenarioResult[];
}

export default function InsightsPanel({ results }: Props) {
  const { t } = useTranslation();

  if (results.length < 2) return null;

  const best = results.reduce((a, b) => a.distanceKm > b.distanceKm ? a : b);
  const worst = results.reduce((a, b) => a.distanceKm < b.distanceKm ? a : b);

  const improvement = worst.distanceKm > 0
    ? ((best.distanceKm - worst.distanceKm) / worst.distanceKm * 100).toFixed(1)
    : '0';

  return (
    <div className="bg-indigo-50 dark:bg-indigo-900/30 rounded-xl border border-indigo-200 dark:border-indigo-800 p-4">
      <h4 className="font-semibold text-indigo-700 dark:text-indigo-300 mb-2">{t('scenarios.insights')}</h4>
      <ul className="text-sm text-gray-700 dark:text-gray-300 space-y-1">
        <li>
          {t('scenarios.best')}: {t('scenarios.scenario')} {best.index + 1} ({best.distanceKm.toFixed(2)} km)
        </li>
        <li>
          {improvement}% {t('scenarios.improvement')} {t('scenarios.compared')} {t('scenarios.scenario')} {worst.index + 1}
        </li>
      </ul>
    </div>
  );
}
