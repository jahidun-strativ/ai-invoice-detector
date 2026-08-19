/**
 * Export state for the monthly workflow: which month is selected, generating
 * the workbook, and handing it to the share sheet. Kept separate from
 * receipts-context because nothing else in the app needs it.
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
import * as Sharing from 'expo-sharing';
import { getColumns, getOfficeName } from '@/services/config';
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
  shareExport: (filepath: string) => Promise<void>;
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

  const shareExport = useCallback(async (filepath: string) => {
    if (!(await Sharing.isAvailableAsync())) {
      throw new Error('Sharing is not available on this device.');
    }
    await Sharing.shareAsync(filepath, {
      mimeType:
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      dialogTitle: 'Share Bill Approval Sheet',
      UTI: 'org.openxmlformats.spreadsheetml.sheet',
    });
  }, []);

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
      shareExport,
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
      shareExport,
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
