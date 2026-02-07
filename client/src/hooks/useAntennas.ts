import { useState, useEffect, useCallback } from 'react';
import { apiGetAntennas, apiCreateAntenna, apiUpdateAntenna, apiDeleteAntenna } from '../utils/api';
import { useAuth } from '../contexts/AuthContext';

export interface Antenna {
  id: string;
  name: string;
  powerWatts: number;
  gainDbi: number;
}

export function useAntennas() {
  const { user } = useAuth();
  const [antennas, setAntennas] = useState<Antenna[]>([]);
  const [loading, setLoading] = useState(false);

  const fetchAntennas = useCallback(async () => {
    if (!user) {
      setAntennas([]);
      return;
    }
    setLoading(true);
    try {
      const data = await apiGetAntennas();
      setAntennas(data.antennas);
    } catch {
      console.error('Failed to fetch antennas');
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    fetchAntennas();
  }, [fetchAntennas]);

  const createAntenna = async (name: string, powerWatts: number, gainDbi: number) => {
    const data = await apiCreateAntenna(name, powerWatts, gainDbi);
    setAntennas(prev => [data.antenna, ...prev]);
    return data.antenna;
  };

  const updateAntenna = async (id: string, updates: { name?: string; powerWatts?: number; gainDbi?: number }) => {
    const data = await apiUpdateAntenna(id, updates);
    setAntennas(prev => prev.map(a => a.id === id ? data.antenna : a));
    return data.antenna;
  };

  const deleteAntenna = async (id: string) => {
    await apiDeleteAntenna(id);
    setAntennas(prev => prev.filter(a => a.id !== id));
  };

  return { antennas, loading, createAntenna, updateAntenna, deleteAntenna, refetch: fetchAntennas };
}
