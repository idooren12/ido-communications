import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import type { Antenna } from '../../hooks/useAntennas';

interface Props {
  antenna?: Antenna | null;
  onSave: (name: string, powerWatts: number, gainDbi: number) => Promise<void>;
  onClose: () => void;
}

export default function AntennaModal({ antenna, onSave, onClose }: Props) {
  const { t } = useTranslation();
  const [name, setName] = useState(antenna?.name || '');
  const [power, setPower] = useState(antenna?.powerWatts?.toString() || '');
  const [gain, setGain] = useState(antenna?.gainDbi?.toString() || '');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (antenna) {
      setName(antenna.name);
      setPower(antenna.powerWatts.toString());
      setGain(antenna.gainDbi.toString());
    }
  }, [antenna]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    const p = parseFloat(power);
    const g = parseFloat(gain);
    if (!name || isNaN(p) || p <= 0 || isNaN(g)) {
      setError(t('errors.powerPositive'));
      return;
    }

    setLoading(true);
    try {
      await onSave(name, p, g);
      onClose();
    } catch {
      setError(t('errors.serverError'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div
        className="bg-white dark:bg-slate-800 rounded-xl shadow-xl w-full max-w-md mx-4 p-6"
        onClick={e => e.stopPropagation()}
      >
        <h3 className="text-xl font-bold mb-4">
          {antenna ? t('antennas.editAntenna') : t('antennas.addAntenna')}
        </h3>

        <form onSubmit={handleSubmit} className="space-y-4">
          {error && (
            <div className="p-3 text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg">
              {error}
            </div>
          )}

          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">{t('antennas.antennaName')}</label>
            <input
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 dark:bg-slate-700 dark:text-gray-100 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              {t('calculator.power')} ({t('calculator.powerUnit')})
            </label>
            <input
              type="number"
              step="any"
              value={power}
              onChange={e => setPower(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 dark:bg-slate-700 dark:text-gray-100 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none"
              dir="ltr"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              {t('calculator.gain')} (dBi)
            </label>
            <input
              type="number"
              step="any"
              value={gain}
              onChange={e => setGain(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 dark:bg-slate-700 dark:text-gray-100 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none"
              dir="ltr"
            />
          </div>

          <div className="flex gap-3 pt-2">
            <button
              type="submit"
              disabled={loading}
              className="flex-1 py-2.5 bg-indigo-600 text-white rounded-lg font-medium hover:bg-indigo-700 disabled:opacity-50 transition-colors"
            >
              {loading ? '...' : t('antennas.save')}
            </button>
            <button
              type="button"
              onClick={onClose}
              className="flex-1 py-2.5 border border-gray-300 dark:border-gray-600 rounded-lg font-medium hover:bg-gray-50 dark:hover:bg-slate-700 dark:text-gray-200 transition-colors"
            >
              {t('antennas.cancel')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
