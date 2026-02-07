import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import AntennaInput from '../components/Calculator/AntennaInput';
import CalculationMode, { type CalcMode } from '../components/Calculator/CalculationMode';
import ResultDisplay, { type CalcResult } from '../components/Calculator/ResultDisplay';
import RealisticResultDisplay, { type RealisticCalcResult } from '../components/Calculator/RealisticResultDisplay';
import EnvironmentSection from '../components/Calculator/EnvironmentSection';
import PowerDistanceChart from '../components/Calculator/PowerDistanceChart';
import HistoryPanel from '../components/Calculator/HistoryPanel';
import UnitSelector from '../components/Layout/UnitSelector';
import { useUnits } from '../contexts/UnitsContext';
import { useAuth } from '../contexts/AuthContext';
import { toWatts, toMhz, toKm, fromWatts, fromMhz, fromKm } from '../utils/unitConversions';
import { calculateMaxDistance, calculateReceivedPower } from '../utils/friisCalculations';
import { calculateRealisticMaxDistance, calculateRealisticReceivedPower } from '../utils/realisticCalculations';
import type { WeatherData } from '../utils/realisticCalculations';
import { getRegionById } from '../utils/israelRegions';
import type { RegionData } from '../utils/israelRegions';
import { validatePower, validateGain, validateFrequency, validateSensitivity, validateDistance } from '../utils/validation';
import { useAntennas } from '../hooks/useAntennas';
import { useHistory, type CalculationRecord } from '../hooks/useHistory';
import { apiGetWeather } from '../utils/api';

export default function FriisCalculator() {
  const { t } = useTranslation();
  const { antennas, createAntenna } = useAntennas();
  const { user } = useAuth();
  const { powerUnit, frequencyUnit, distanceUnit } = useUnits();
  const { history, saveCalculation, deleteCalculation, clearHistory } = useHistory();

  // TX antenna
  const [txPower, setTxPower] = useState('');
  const [txGain, setTxGain] = useState('');
  // RX antenna
  const [rxPower, setRxPower] = useState('');
  const [rxGain, setRxGain] = useState('');
  // Shared
  const [frequency, setFrequency] = useState('');
  const [mode, setMode] = useState<CalcMode>('distance');
  const [sensitivity, setSensitivity] = useState('');
  const [distance, setDistance] = useState('');
  // Result
  const [result, setResult] = useState<CalcResult | null>(null);
  const [realisticResult, setRealisticResult] = useState<RealisticCalcResult | null>(null);
  const [error, setError] = useState('');
  // Store base-unit values for the chart
  const [lastCalcParams, setLastCalcParams] = useState({ txPowerW: 0, freqMhz: 0, distKm: 0 });
  const [attemptedSubmit, setAttemptedSubmit] = useState(false);

  // Realistic mode state
  const [realisticMode, setRealisticMode] = useState(false);
  const [selectedRegionId, setSelectedRegionId] = useState<string | null>(null);
  const [selectedRegion, setSelectedRegion] = useState<RegionData | null>(null);
  const [weather, setWeather] = useState<WeatherData | null>(null);
  const [weatherLoading, setWeatherLoading] = useState(false);
  const [weatherError, setWeatherError] = useState<string | null>(null);

  const hasValidationErrors = () => {
    if (validatePower(txPower)) return true;
    if (validateGain(txGain)) return true;
    if (validateGain(rxGain)) return true;
    if (validateFrequency(frequency)) return true;
    if (mode === 'distance' && validateSensitivity(sensitivity)) return true;
    if (mode === 'power' && validateDistance(distance)) return true;
    return false;
  };

  // Weather fetch
  const fetchWeather = async (regionId: string) => {
    const region = getRegionById(regionId);
    if (!region) return;
    setWeatherLoading(true);
    setWeatherError(null);
    try {
      const data = await apiGetWeather(region.coordinates.lat, region.coordinates.lon);
      setWeather({ ...data, fetchedAt: Date.now() });
    } catch {
      setWeatherError(t('realistic.weather.error'));
    } finally {
      setWeatherLoading(false);
    }
  };

  const handleRegionChange = (regionId: string) => {
    setSelectedRegionId(regionId);
    const region = getRegionById(regionId);
    setSelectedRegion(region ?? null);
    fetchWeather(regionId);
  };

  const handleRetryWeather = () => {
    if (selectedRegionId) {
      fetchWeather(selectedRegionId);
    }
  };

  const handleCalculate = () => {
    setError('');
    setResult(null);
    setRealisticResult(null);

    if (hasValidationErrors()) return;

    try {
      // Convert from user-selected units to base units
      const txPowerW = toWatts(parseFloat(txPower), powerUnit);
      const txGainDbi = parseFloat(txGain);
      const rxGainDbi = parseFloat(rxGain);
      const freqMhz = toMhz(parseFloat(frequency), frequencyUnit);

      if (mode === 'distance') {
        const sensDbm = parseFloat(sensitivity);

        // Always compute free-space result
        const fsRes = calculateMaxDistance(txPowerW, txGainDbi, rxGainDbi, freqMhz, sensDbm);
        if (!isFinite(fsRes.distanceKm) || fsRes.distanceKm <= 0) {
          setError(t('errors.calculationError'));
          return;
        }

        // Realistic mode
        if (realisticMode && selectedRegion && weather) {
          const realRes = calculateRealisticMaxDistance(
            txPowerW, txGainDbi, rxGainDbi, freqMhz, sensDbm, selectedRegion, weather
          );
          setLastCalcParams({ txPowerW, freqMhz, distKm: realRes.realisticDistanceKm });
          setRealisticResult({ type: 'realistic_distance', ...realRes });
          // Auto-save with realistic value
          saveCalculation({
            mode: 'distance', txPowerWatts: txPowerW, txGainDbi, rxGainDbi,
            frequencyMhz: freqMhz, sensitivity: sensDbm, resultValue: realRes.realisticDistanceKm,
          });
        } else {
          // Standard Friis
          setLastCalcParams({ txPowerW, freqMhz, distKm: fsRes.distanceKm });
          setResult({ type: 'distance', distanceKm: fsRes.distanceKm, details: fsRes.details });
          saveCalculation({
            mode: 'distance', txPowerWatts: txPowerW, txGainDbi, rxGainDbi,
            frequencyMhz: freqMhz, sensitivity: sensDbm, resultValue: fsRes.distanceKm,
          });
        }
      } else {
        const distKm = toKm(parseFloat(distance), distanceUnit);

        // Always compute free-space result
        const fsRes = calculateReceivedPower(txPowerW, txGainDbi, rxGainDbi, freqMhz, distKm);
        if (!isFinite(fsRes.receivedPowerDbm)) {
          setError(t('errors.calculationError'));
          return;
        }

        // Realistic mode
        if (realisticMode && selectedRegion && weather) {
          const realRes = calculateRealisticReceivedPower(
            txPowerW, txGainDbi, rxGainDbi, freqMhz, distKm, selectedRegion, weather
          );
          setLastCalcParams({ txPowerW, freqMhz, distKm });
          setRealisticResult({ type: 'realistic_power', ...realRes });
          saveCalculation({
            mode: 'power', txPowerWatts: txPowerW, txGainDbi, rxGainDbi,
            frequencyMhz: freqMhz, distance: distKm, resultValue: realRes.realisticPowerDbm,
          });
        } else {
          // Standard Friis
          setLastCalcParams({ txPowerW, freqMhz, distKm });
          setResult({ type: 'power', receivedPowerDbm: fsRes.receivedPowerDbm, details: fsRes.details });
          saveCalculation({
            mode: 'power', txPowerWatts: txPowerW, txGainDbi, rxGainDbi,
            frequencyMhz: freqMhz, distance: distKm, resultValue: fsRes.receivedPowerDbm,
          });
        }
      }
    } catch {
      setError(t('errors.calculationError'));
    }
  };

  const handleLoadHistory = (record: CalculationRecord) => {
    // Load values back into form, converting from base units to selected display units
    setTxPower(fromWatts(record.txPowerWatts, powerUnit).toString());
    setTxGain(record.txGainDbi.toString());
    setRxGain(record.rxGainDbi.toString());
    setFrequency(fromMhz(record.frequencyMhz, frequencyUnit).toString());

    if (record.mode === 'distance') {
      setMode('distance');
      if (record.sensitivity !== null) setSensitivity(record.sensitivity.toString());
    } else {
      setMode('power');
      if (record.distance !== null) setDistance(fromKm(record.distance, distanceUnit).toString());
    }
  };

  const handleSaveAntenna = async (name: string, power: number, gain: number) => {
    await createAntenna(name, power, gain);
  };

  // Determine which result to show
  const showRealisticResult = realisticMode && realisticResult !== null;
  const showStandardResult = !realisticMode && result !== null;
  const hasAnyResult = showRealisticResult || showStandardResult;

  // For chart — determine result distance
  const chartResultDistance = showRealisticResult && realisticResult?.type === 'realistic_distance'
    ? realisticResult.realisticDistanceKm
    : result?.type === 'distance'
      ? result.distanceKm
      : lastCalcParams.distKm;

  const chartResultPower = showRealisticResult && realisticResult?.type === 'realistic_power'
    ? realisticResult.realisticPowerDbm
    : result?.type === 'power'
      ? result.receivedPowerDbm
      : undefined;

  return (
    <div className="max-w-5xl mx-auto px-4 py-8">
      <UnitSelector />

      {user && history.length > 0 && (
        <HistoryPanel
          history={history}
          onLoad={handleLoadHistory}
          onDelete={deleteCalculation}
          onClear={clearHistory}
        />
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-5 mb-5">
        <AntennaInput
          label={t('calculator.antenna1')}
          power={txPower}
          gain={txGain}
          onPowerChange={setTxPower}
          onGainChange={setTxGain}
          savedAntennas={antennas}
          onSelectSaved={a => { setTxPower(a.powerWatts.toString()); setTxGain(a.gainDbi.toString()); }}
          onSave={handleSaveAntenna}
        />
        <AntennaInput
          label={t('calculator.antenna2')}
          power={rxPower}
          gain={rxGain}
          onPowerChange={setRxPower}
          onGainChange={setRxGain}
          savedAntennas={antennas}
          onSelectSaved={a => { setRxPower(a.powerWatts.toString()); setRxGain(a.gainDbi.toString()); }}
          onSave={handleSaveAntenna}
          powerHint={t('calculator.rxPowerHint')}
        />
      </div>

      <CalculationMode
        mode={mode}
        onModeChange={setMode}
        frequency={frequency}
        onFrequencyChange={setFrequency}
        sensitivity={sensitivity}
        onSensitivityChange={setSensitivity}
        distance={distance}
        onDistanceChange={setDistance}
      />

      <EnvironmentSection
        realisticMode={realisticMode}
        onRealisticModeChange={setRealisticMode}
        selectedRegionId={selectedRegionId}
        onRegionChange={handleRegionChange}
        weather={weather}
        weatherLoading={weatherLoading}
        weatherError={weatherError}
        onRetryWeather={handleRetryWeather}
      />

      <div className="mt-6 text-center">
        <button
          onClick={() => {
            if (hasValidationErrors()) {
              setAttemptedSubmit(true);
              return;
            }
            setAttemptedSubmit(false);
            handleCalculate();
          }}
          title={hasValidationErrors() ? t('errors.fillRequiredFields') : undefined}
          className="px-10 py-3 bg-indigo-600 text-white rounded-xl font-bold text-lg hover:bg-indigo-700 transition-all shadow-md hover:shadow-lg"
        >
          {t('calculator.calculate')}
        </button>
        {attemptedSubmit && hasValidationErrors() && (
          <p className="mt-3 text-sm text-red-500 dark:text-red-400">{t('errors.fillRequiredFields')}</p>
        )}
      </div>

      {error && (
        <div className="mt-6 p-4 text-red-700 dark:text-red-400 bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 rounded-xl text-center">
          {error}
        </div>
      )}

      {showRealisticResult && realisticResult && selectedRegion && (
        <div className="mt-6">
          <RealisticResultDisplay
            result={realisticResult}
            regionNameHe={selectedRegion.nameHe}
            regionNameEn={selectedRegion.nameEn}
          />
        </div>
      )}

      {showStandardResult && result && (
        <div className="mt-6">
          <ResultDisplay result={result} />
        </div>
      )}

      {hasAnyResult && (
        <PowerDistanceChart
          txPowerWatts={lastCalcParams.txPowerW}
          txGainDbi={parseFloat(txGain)}
          rxGainDbi={parseFloat(rxGain)}
          frequencyMhz={lastCalcParams.freqMhz}
          sensitivityDbm={mode === 'distance' ? parseFloat(sensitivity) : undefined}
          resultDistanceKm={chartResultDistance}
          resultPowerDbm={chartResultPower}
          realisticMode={realisticMode && selectedRegion !== null && weather !== null}
          region={selectedRegion ?? undefined}
          weather={weather ?? undefined}
        />
      )}
    </div>
  );
}
