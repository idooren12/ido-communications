import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { CalculationRecord } from '../../hooks/useHistory';

interface Props {
  history: CalculationRecord[];
  onLoad: (record: CalculationRecord) => void;
  onDelete: (id: string) => void;
  onClear: () => void;
}

export default function HistoryPanel({ history, onLoad, onDelete, onClear }: Props) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);

  return (
    <div className="bg-white dark:bg-slate-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm mb-5">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between px-5 py-3 text-sm font-medium text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-slate-700 rounded-xl transition-colors"
      >
        <span>{t('history.title')} ({history.length})</span>
        <svg
          className={`w-5 h-5 transition-transform ${expanded ? 'rotate-180' : ''}`}
          fill="none" viewBox="0 0 24 24" stroke="currentColor"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {expanded && (
        <div className="px-5 pb-4 border-t border-gray-200 dark:border-gray-700 pt-3">
          {history.length === 0 ? (
            <p className="text-sm text-gray-500 dark:text-gray-400 text-center py-3">{t('history.noHistory')}</p>
          ) : (
            <>
              <div className="space-y-2 max-h-64 overflow-y-auto">
                {history.map((record) => (
                  <div
                    key={record.id}
                    className="flex items-center justify-between bg-gray-50 dark:bg-slate-700/50 rounded-lg px-3 py-2"
                  >
                    <div className="text-sm">
                      <span className="font-medium text-gray-800 dark:text-gray-100" dir="ltr">
                        {record.resultValue.toFixed(2)} {record.mode === 'distance' ? 'km' : 'dBm'}
                      </span>
                      <span className="text-gray-400 dark:text-gray-500 mx-2">|</span>
                      <span className="text-xs text-gray-500 dark:text-gray-400">
                        {record.frequencyMhz} MHz
                      </span>
                      <span className="text-gray-400 dark:text-gray-500 mx-1">-</span>
                      <span className="text-xs text-gray-400 dark:text-gray-500">
                        {new Date(record.createdAt).toLocaleDateString()}
                      </span>
                    </div>
                    <div className="flex gap-1">
                      <button
                        onClick={() => onLoad(record)}
                        className="px-2 py-1 text-xs text-indigo-600 dark:text-indigo-400 hover:bg-indigo-50 dark:hover:bg-indigo-900/30 rounded transition-colors"
                      >
                        {t('history.load')}
                      </button>
                      <button
                        onClick={() => onDelete(record.id)}
                        className="px-2 py-1 text-xs text-red-500 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/30 rounded transition-colors"
                      >
                        ×
                      </button>
                    </div>
                  </div>
                ))}
              </div>
              <div className="mt-3 text-end">
                {confirmClear ? (
                  <div className="flex items-center justify-end gap-2">
                    <span className="text-xs text-gray-500 dark:text-gray-400">{t('history.confirmClear')}</span>
                    <button
                      onClick={() => { onClear(); setConfirmClear(false); }}
                      className="px-2 py-1 text-xs bg-red-600 text-white rounded hover:bg-red-700 transition-colors"
                    >
                      {t('history.clear')}
                    </button>
                    <button
                      onClick={() => setConfirmClear(false)}
                      className="px-2 py-1 text-xs border border-gray-300 dark:border-gray-600 rounded hover:bg-gray-50 dark:hover:bg-slate-600 transition-colors"
                    >
                      {t('antennas.cancel')}
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => setConfirmClear(true)}
                    className="text-xs text-red-500 dark:text-red-400 hover:underline"
                  >
                    {t('history.clear')}
                  </button>
                )}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
