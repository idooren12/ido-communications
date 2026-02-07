import { useTranslation } from 'react-i18next';
import type { CalculationDetails as Details } from '../../utils/friisCalculations';

interface Props {
  details: Details;
  mode: 'distance' | 'power';
}

export default function CalculationDetails({ details, mode }: Props) {
  const { t } = useTranslation();

  return (
    <div className="space-y-2 text-sm text-gray-600 dark:text-gray-300" dir="ltr">
      <div className="flex justify-between">
        <span>{t('result.details.txPower')}:</span>
        <span className="font-mono">{details.txPowerDbm.toFixed(2)} dBm</span>
      </div>
      <div className="flex justify-between">
        <span>{t('result.details.totalGain')}:</span>
        <span className="font-mono">{details.totalGain.toFixed(2)} dBi</span>
      </div>
      {mode === 'distance' && details.maxFSPL !== undefined && (
        <div className="flex justify-between">
          <span>{t('result.details.maxFSPL')}:</span>
          <span className="font-mono">{details.maxFSPL.toFixed(2)} dB</span>
        </div>
      )}
      {mode === 'power' && details.fspl !== undefined && (
        <div className="flex justify-between">
          <span>{t('result.details.fspl')}:</span>
          <span className="font-mono">{details.fspl.toFixed(2)} dB</span>
        </div>
      )}
      <div className="flex justify-between">
        <span>{t('result.details.frequency')}:</span>
        <span className="font-mono">{details.frequencyMhz} MHz</span>
      </div>
    </div>
  );
}
