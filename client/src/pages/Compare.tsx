import { useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import ScenarioCard, { type Scenario } from '../components/Scenarios/ScenarioCard';
import ScenarioTable from '../components/Scenarios/ScenarioTable';
import InsightsPanel from '../components/Scenarios/InsightsPanel';
import { useUnits } from '../contexts/UnitsContext';
import { toWatts, toMhz } from '../utils/unitConversions';
import { calculateMaxDistance, calculateReceivedPower } from '../utils/friisCalculations';

let nextId = 1;

function emptyScenario(): Scenario {
  return { id: nextId++, txPower: '', txGain: '', rxGain: '', frequency: '', sensitivity: '' };
}

interface ScenarioResult {
  index: number;
  distanceKm: number;
  receivedPowerDbm: number;
}

export default function Compare() {
  const { t } = useTranslation();
  const { powerUnit, frequencyUnit } = useUnits();
  const [scenarios, setScenarios] = useState<Scenario[]>([]);
  const [results, setResults] = useState<ScenarioResult[]>([]);

  const addScenario = () => {
    if (scenarios.length >= 4) return;
    setScenarios(prev => [...prev, emptyScenario()]);
  };

  const cloneScenario = (id: number) => {
    if (scenarios.length >= 4) return;
    const s = scenarios.find(s => s.id === id);
    if (s) {
      setScenarios(prev => [...prev, { ...s, id: nextId++ }]);
    }
  };

  const removeScenario = (id: number) => {
    setScenarios(prev => prev.filter(s => s.id !== id));
    setResults([]);
  };

  const handleChange = useCallback((id: number, field: keyof Omit<Scenario, 'id'>, value: string) => {
    setScenarios(prev => prev.map(s => s.id === id ? { ...s, [field]: value } : s));
  }, []);

  const handleCompare = () => {
    const newResults: ScenarioResult[] = [];

    scenarios.forEach((s, index) => {
      const txPW = toWatts(parseFloat(s.txPower), powerUnit);
      const txG = parseFloat(s.txGain);
      const rxG = parseFloat(s.rxGain);
      const freq = toMhz(parseFloat(s.frequency), frequencyUnit);
      const sens = parseFloat(s.sensitivity);

      if ([txPW, txG, rxG, freq, sens].some(v => !isFinite(v))) return;

      const distRes = calculateMaxDistance(txPW, txG, rxG, freq, sens);
      const powRes = calculateReceivedPower(txPW, txG, rxG, freq, distRes.distanceKm > 0 ? distRes.distanceKm : 1);

      if (isFinite(distRes.distanceKm) && distRes.distanceKm > 0) {
        newResults.push({
          index,
          distanceKm: distRes.distanceKm,
          receivedPowerDbm: powRes.receivedPowerDbm,
        });
      }
    });

    setResults(newResults);
  };

  return (
    <div className="max-w-5xl mx-auto px-4 py-8">
      <h2 className="text-2xl font-bold text-gray-800 dark:text-gray-100 mb-6">{t('scenarios.title')}</h2>

      {scenarios.length === 0 && (
        <div className="text-center py-16">
          <div className="text-5xl mb-4">📊</div>
          <h3 className="text-lg font-semibold text-gray-700 dark:text-gray-200 mb-2">
            {t('scenarios.emptyTitle')}
          </h3>
          <p className="text-gray-500 dark:text-gray-400 mb-6">
            {t('scenarios.emptyDescription')}
          </p>
          <button onClick={addScenario} className="px-6 py-2.5 bg-indigo-600 text-white rounded-lg font-medium hover:bg-indigo-700 transition-colors">
            + {t('scenarios.addFirstScenario')}
          </button>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
        {scenarios.map((s, i) => (
          <ScenarioCard
            key={s.id}
            scenario={s}
            index={i}
            onChange={handleChange}
            onClone={cloneScenario}
            onRemove={removeScenario}
          />
        ))}
      </div>

      <div className="flex gap-3 mb-6">
        {scenarios.length < 4 && (
          <button
            onClick={addScenario}
            className="px-4 py-2 text-sm border border-dashed border-gray-400 dark:border-gray-500 rounded-lg hover:bg-gray-50 dark:hover:bg-slate-700 transition-colors text-gray-600 dark:text-gray-300"
          >
            + {t('scenarios.addScenario')}
          </button>
        )}
        {scenarios.length >= 2 && (
          <button
            onClick={handleCompare}
            className="px-6 py-2 text-sm bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors font-medium"
          >
            {t('scenarios.title')}
          </button>
        )}
      </div>

      {results.length > 0 && (
        <div className="space-y-4">
          <div className="bg-white dark:bg-slate-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4 shadow-sm">
            <ScenarioTable results={results} />
          </div>
          <InsightsPanel results={results} />
        </div>
      )}
    </div>
  );
}
