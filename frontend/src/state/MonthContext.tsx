import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { TargetMonth, loadTargetMonth, saveTargetMonth, normalizeTargetMonth } from './monthStore';

export type TargetMonthContextValue = {
  targetMonth: TargetMonth;
  setTargetMonth: (value: TargetMonth) => void;
};

const TargetMonthContext = createContext<TargetMonthContextValue | undefined>(undefined);

export const TargetMonthProvider = ({ children }: { children: ReactNode }) => {
  const [targetMonth, setTargetMonthState] = useState<TargetMonth>(() => loadTargetMonth());

  const setTargetMonth = (value: TargetMonth) => {
    setTargetMonthState((prev) => {
      const next = normalizeTargetMonth(value.year, value.month);
      if (prev.year === next.year && prev.month === next.month) {
        return prev;
      }
      return next;
    });
  };

  useEffect(() => {
    saveTargetMonth(targetMonth);
  }, [targetMonth]);

  const contextValue = useMemo<TargetMonthContextValue>(
    () => ({
      targetMonth,
      setTargetMonth,
    }),
    [targetMonth],
  );

  return <TargetMonthContext.Provider value={contextValue}>{children}</TargetMonthContext.Provider>;
};

export const useTargetMonth = (): TargetMonthContextValue => {
  const value = useContext(TargetMonthContext);
  if (!value) {
    throw new Error('useTargetMonth must be used within TargetMonthProvider');
  }
  return value;
};
