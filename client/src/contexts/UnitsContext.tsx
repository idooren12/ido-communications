import { createContext, useContext, useState, type ReactNode } from 'react';
import type { DistanceUnit, PowerUnit, FrequencyUnit } from '../utils/unitConversions';

interface UnitsContextType {
  distanceUnit: DistanceUnit;
  powerUnit: PowerUnit;
  frequencyUnit: FrequencyUnit;
  setDistanceUnit: (u: DistanceUnit) => void;
  setPowerUnit: (u: PowerUnit) => void;
  setFrequencyUnit: (u: FrequencyUnit) => void;
}

const UnitsContext = createContext<UnitsContextType | null>(null);

export function UnitsProvider({ children }: { children: ReactNode }) {
  const [distanceUnit, setDistanceUnitState] = useState<DistanceUnit>(
    () => (localStorage.getItem('distanceUnit') as DistanceUnit) || 'km'
  );
  const [powerUnit, setPowerUnitState] = useState<PowerUnit>(
    () => (localStorage.getItem('powerUnit') as PowerUnit) || 'W'
  );
  const [frequencyUnit, setFrequencyUnitState] = useState<FrequencyUnit>(
    () => (localStorage.getItem('frequencyUnit') as FrequencyUnit) || 'MHz'
  );

  const setDistanceUnit = (u: DistanceUnit) => {
    setDistanceUnitState(u);
    localStorage.setItem('distanceUnit', u);
  };

  const setPowerUnit = (u: PowerUnit) => {
    setPowerUnitState(u);
    localStorage.setItem('powerUnit', u);
  };

  const setFrequencyUnit = (u: FrequencyUnit) => {
    setFrequencyUnitState(u);
    localStorage.setItem('frequencyUnit', u);
  };

  return (
    <UnitsContext.Provider value={{
      distanceUnit, powerUnit, frequencyUnit,
      setDistanceUnit, setPowerUnit, setFrequencyUnit
    }}>
      {children}
    </UnitsContext.Provider>
  );
}

export function useUnits() {
  const context = useContext(UnitsContext);
  if (!context) throw new Error('useUnits must be used within UnitsProvider');
  return context;
}
