import { useTranslation } from 'react-i18next';
import type { Antenna } from '../../hooks/useAntennas';

interface Props {
  antenna: Antenna;
  onEdit: () => void;
  onDelete: () => void;
}

export default function AntennaCard({ antenna, onEdit, onDelete }: Props) {
  const { t } = useTranslation();

  return (
    <div className="bg-white dark:bg-slate-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4 shadow-sm flex items-center justify-between">
      <div>
        <h4 className="font-semibold text-gray-800 dark:text-gray-100">{antenna.name}</h4>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
          {t('calculator.power')}: {antenna.powerWatts}W | {t('calculator.gain')}: {antenna.gainDbi} dBi
        </p>
      </div>
      <div className="flex gap-2">
        <button
          onClick={onEdit}
          className="px-3 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-slate-700 transition-colors"
        >
          {t('antennas.edit')}
        </button>
        <button
          onClick={onDelete}
          className="px-3 py-1.5 text-sm border border-red-200 dark:border-red-800 text-red-600 dark:text-red-400 rounded-lg hover:bg-red-50 dark:hover:bg-red-900/30 transition-colors"
        >
          {t('antennas.delete')}
        </button>
      </div>
    </div>
  );
}
