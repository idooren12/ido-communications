import { useTranslation } from 'react-i18next';
import { ISRAEL_REGIONS, REGION_GROUPS } from '../../utils/israelRegions';
import type { WeatherData } from '../../utils/realisticCalculations';

interface EnvironmentSectionProps {
  realisticMode: boolean;
  onRealisticModeChange: (on: boolean) => void;
  selectedRegionId: string | null;
  onRegionChange: (regionId: string) => void;
  weather: WeatherData | null;
  weatherLoading: boolean;
  weatherError: string | null;
  onRetryWeather: () => void;
}

function formatMinutesAgo(fetchedAt: number): number {
  return Math.max(0, Math.round((Date.now() - fetchedAt) / 60000));
}

export default function EnvironmentSection({
  realisticMode,
  onRealisticModeChange,
  selectedRegionId,
  onRegionChange,
  weather,
  weatherLoading,
  weatherError,
  onRetryWeather,
}: EnvironmentSectionProps) {
  const { t, i18n } = useTranslation();
  const isHebrew = i18n.language === 'he';

  const showWeatherWidget =
    realisticMode && selectedRegionId && (weather || weatherLoading || weatherError);

  return (
    <div className="bg-white dark:bg-slate-800 rounded-xl border-2 border-emerald-200 dark:border-emerald-800 p-6 mb-5">
      {/* Toggle */}
      <label className="flex items-start gap-3 cursor-pointer">
        <span className="relative inline-flex items-center mt-0.5">
          <input
            type="checkbox"
            checked={realisticMode}
            onChange={(e) => onRealisticModeChange(e.target.checked)}
            className="sr-only peer"
          />
          <span className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-emerald-300 dark:peer-focus:ring-emerald-800 rounded-full peer dark:bg-gray-600 peer-checked:after:translate-x-full rtl:peer-checked:after:-translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:start-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all dark:after:border-gray-500 peer-checked:bg-emerald-500"></span>
        </span>
        <span className="flex flex-col">
          <span className="text-sm font-medium text-gray-900 dark:text-gray-100">
            {t('realistic.toggle')}
          </span>
          <span className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
            {t('realistic.toggleDescription')}
          </span>
        </span>
      </label>

      {/* Collapsible content */}
      {realisticMode && (
        <div className="mt-5 space-y-4">
          {/* Region Selector */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
              {t('realistic.selectRegion')}
            </label>
            <select
              value={selectedRegionId ?? ''}
              onChange={(e) => onRegionChange(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 dark:bg-slate-700 dark:text-gray-100 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none"
            >
              <option value="" disabled>
                {t('realistic.selectRegionPlaceholder')}
              </option>
              {REGION_GROUPS.map((group) => (
                <optgroup key={group.id} label={t(group.nameKey)}>
                  {ISRAEL_REGIONS.filter((r) => r.group === group.id).map((region) => (
                    <option key={region.id} value={region.id}>
                      {isHebrew ? region.nameHe : region.nameEn}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          </div>

          {/* Weather Widget */}
          {showWeatherWidget && (
            <div className="bg-gray-50 dark:bg-slate-700/50 rounded-lg p-4 mt-4">
              {weatherLoading && (
                <div className="flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400">
                  <svg
                    className="animate-spin h-4 w-4"
                    xmlns="http://www.w3.org/2000/svg"
                    fill="none"
                    viewBox="0 0 24 24"
                  >
                    <circle
                      className="opacity-25"
                      cx="12"
                      cy="12"
                      r="10"
                      stroke="currentColor"
                      strokeWidth="4"
                    />
                    <path
                      className="opacity-75"
                      fill="currentColor"
                      d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                    />
                  </svg>
                  <span>{t('realistic.weather.loading')}</span>
                </div>
              )}

              {weatherError && !weatherLoading && (
                <div className="flex items-center justify-between">
                  <span className="text-sm text-red-600 dark:text-red-400">
                    {t('realistic.weather.error')}
                  </span>
                  <button
                    type="button"
                    onClick={onRetryWeather}
                    className="text-sm font-medium text-indigo-600 dark:text-indigo-400 hover:underline"
                  >
                    {t('realistic.weather.retry', 'Retry')}
                  </button>
                </div>
              )}

              {weather && !weatherLoading && (
                <div>
                  <div className="flex items-center gap-2 mb-2">
                    <img
                      src={`https://openweathermap.org/img/wn/${weather.icon}@2x.png`}
                      alt={weather.description}
                      width={32}
                      height={32}
                    />
                    <h4 className="text-sm font-semibold text-gray-800 dark:text-gray-100">
                      {t('realistic.weather.title')}
                    </h4>
                  </div>

                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-gray-700 dark:text-gray-300">
                    <span>{'\u{1F321}\uFE0F'} {weather.temperature}°C</span>
                    <span className="text-gray-300 dark:text-gray-600">|</span>
                    <span>{'\u{1F4A7}'} {weather.humidity}%</span>
                    <span className="text-gray-300 dark:text-gray-600">|</span>
                    <span>{'\u{1F4A8}'} {weather.windSpeed} km/h</span>
                    <span className="text-gray-300 dark:text-gray-600">|</span>
                    <span>{'\u{1F441}'} {(weather.visibility / 1000).toFixed(1)} km</span>
                  </div>

                  <p className="text-sm text-gray-600 dark:text-gray-400 mt-1.5 capitalize">
                    {weather.description}
                  </p>

                  <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">
                    {t('realistic.weather.updated', {
                      minutes: formatMinutesAgo(weather.fetchedAt),
                    })}
                  </p>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
