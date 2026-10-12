import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../contexts/AuthContext';
import {
  apiGetHistory, apiSaveCalculation, apiDeleteCalculation, apiClearHistory,
  type CalculationRecord
} from '../utils/api';

export type { CalculationRecord };

export function useHistory() {
  const { user } = useAuth();
  const [history, setHistory] = useState<CalculationRecord[]>([]);

  const refresh = useCallback(async () => {
    if (!user) return;
    try {
      const data = await apiGetHistory();
      setHistory(data.calculations);
    } catch {
      // History is optional; keep what we have.
    }
  }, [user]);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    apiGetHistory()
      .then(data => { if (!cancelled) setHistory(data.calculations); })
      .catch(() => { /* keep what we have */ });
    return () => { cancelled = true; };
  }, [user]);

  const saveCalculation = async (data: {
    mode: string;
    txPowerWatts: number;
    txGainDbi: number;
    rxGainDbi: number;
    frequencyMhz: number;
    sensitivity?: number;
    distance?: number;
    resultValue: number;
  }) => {
    if (!user) return;
    await apiSaveCalculation(data);
    await refresh();
  };

  const deleteCalculation = async (id: string) => {
    await apiDeleteCalculation(id);
    await refresh();
  };

  const clearHistory = async () => {
    await apiClearHistory();
    setHistory([]);
  };

  // A logged-out user has no history, whatever was loaded before.
  return { history: user ? history : [], saveCalculation, deleteCalculation, clearHistory };
}
