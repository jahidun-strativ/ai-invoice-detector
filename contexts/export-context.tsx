/**
 * Export state for the monthly workflow: which month is selected and
 * generating the workbook. Delivering the finished file — share sheet or save
 * to a folder — is `deliverFile` in services/export, shared with the other
 * export sites. Kept separate from receipts-context because nothing else in
 * the app needs it.
 */

import {
  createContext,
  ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { getColumns, getOfficeName, pullRemoteReceipts } from '@/services/config';
import {
  getMonthlyPeriods,
  getReceiptsByMonth,
  MonthlyPeriod,
  MonthlyPeriodSummary,
} from '@/services/storage';
import { generateMonthlyXLSX, SignatureConfig } from '@/services/xlsx-export';

interface ExportState {
  periods: MonthlyPeriodSummary[];
  officeName: string;
  selectedPeriod: MonthlyPeriod | null;
  isLoading: boolean;
  isGenerating: boolean;
  lastExportPath: string | null;
  error: string | null;
}

interface ExportContextValue extends ExportState {
  refresh: () => Promise<void>;
  selectPeriod: (period: MonthlyPeriod | null) => void;
  generateExport: (
    signatures: SignatureConfig,
    amountReceived?: number
  ) => Promise<string>;
  clearError: () => void;
}

const ExportContext = createContext<ExportContextValue | null>(null);

export function ExportProvider({ children }: { children: ReactNode }) {
  const [periods, setPeriods] = useState<MonthlyPeriodSummary[]>([]);
  const [officeName, setOfficeName] = useState('Office');
  const [selectedPeriod, setSelectedPeriod] = useState<MonthlyPeriod | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isGenerating, setIsGenerating] = useState(false);
  const [lastExportPath, setLastExportPath] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setIsLoading(true);
    try {
      // The month's sheet must cover the whole office, not just this phone, so
      // pull the team's scans before counting. Failure is non-fatal — the
      // export then covers whatever is on the device.
      await pullRemoteReceipts().catch(() => 0);

      const [nextPeriods, name] = await Promise.all([
        getMonthlyPeriods(),
        getOfficeName(),
      ]);
      setPeriods(nextPeriods);
      setOfficeName(name);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load monthly data.');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const generateExport = useCallback(
    async (signatures: SignatureConfig, amountReceived?: number) => {
      if (!selectedPeriod) {
        throw new Error('Pick a month first.');
      }

      setIsGenerating(true);
      setError(null);
      try {
        const [receipts, columns, name] = await Promise.all([
          getReceiptsByMonth(selectedPeriod.year, selectedPeriod.month),
          getColumns(),
          getOfficeName(),
        ]);

        const filepath = await generateMonthlyXLSX(
          {
            receipts,
            officeName: name,
            year: selectedPeriod.year,
            month: selectedPeriod.month,
            columns,
            amountReceived,
          },
          signatures
        );

        setLastExportPath(filepath);
        return filepath;
      } catch (e) {
        const message =
          e instanceof Error ? e.message : 'Export failed. Please try again.';
        setError(message);
        throw new Error(message);
      } finally {
        setIsGenerating(false);
      }
    },
    [selectedPeriod]
  );

  const value = useMemo(
    () => ({
      periods,
      officeName,
      selectedPeriod,
      isLoading,
      isGenerating,
      lastExportPath,
      error,
      refresh,
      selectPeriod: setSelectedPeriod,
      generateExport,
      clearError: () => setError(null),
    }),
    [
      periods,
      officeName,
      selectedPeriod,
      isLoading,
      isGenerating,
      lastExportPath,
      error,
      refresh,
      generateExport,
    ]
  );

  return <ExportContext.Provider value={value}>{children}</ExportContext.Provider>;
}

export function useExport(): ExportContextValue {
  const context = useContext(ExportContext);
  if (!context) {
    throw new Error('useExport must be used inside an ExportProvider');
  }
  return context;
}
