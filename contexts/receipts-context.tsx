/**
 * Shared receipts state: single DB init, one source of truth for the
 * receipt list, recent receipts, stats, and the active filter/search.
 * All mutations go through here so every screen stays in sync without
 * per-screen focus refetches.
 */

import {
  createContext,
  ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
} from 'react';
import {
  createReceipt,
  deleteReceipt,
  getReceipts,
  getReceiptStats,
  getRecentReceipts,
  initDatabase,
  searchReceipts,
  updateReceipt,
} from '@/services/storage';
import {
  InvoiceType,
  Receipt,
  ReceiptInput,
  ReceiptStats,
} from '@/types/receipt';

export interface ReceiptsFilter {
  type: InvoiceType | 'all';
  searchQuery: string;
}

type Status = 'initializing' | 'loading' | 'ready' | 'error';

interface ReceiptsState {
  receipts: Receipt[];
  recent: Receipt[];
  stats: ReceiptStats | null;
  filter: ReceiptsFilter;
  status: Status;
  error: string | null;
}

type Action =
  | { type: 'load-start' }
  | { type: 'load-success'; receipts: Receipt[]; recent: Receipt[]; stats: ReceiptStats }
  | { type: 'load-error'; error: string }
  | { type: 'set-filter'; filter: ReceiptsFilter };

const initialState: ReceiptsState = {
  receipts: [],
  recent: [],
  stats: null,
  filter: { type: 'all', searchQuery: '' },
  status: 'initializing',
  error: null,
};

function reducer(state: ReceiptsState, action: Action): ReceiptsState {
  switch (action.type) {
    case 'load-start':
      return {
        ...state,
        // Stay in 'initializing' until the first successful load so screens
        // can distinguish first-load skeletons from background refreshes.
        status: state.stats === null ? 'initializing' : 'loading',
        error: null,
      };
    case 'load-success':
      return {
        ...state,
        receipts: action.receipts,
        recent: action.recent,
        stats: action.stats,
        status: 'ready',
        error: null,
      };
    case 'load-error':
      return { ...state, status: 'error', error: action.error };
    case 'set-filter':
      return { ...state, filter: action.filter };
  }
}

interface ReceiptsContextValue extends ReceiptsState {
  /** Reload list (honoring the current filter/search), recent, and stats. */
  refresh: () => Promise<void>;
  setFilter: (partial: Partial<ReceiptsFilter>) => void;
  addReceipt: (input: ReceiptInput) => Promise<Receipt>;
  updateReceiptById: (id: string, input: ReceiptInput) => Promise<Receipt | null>;
  removeReceipt: (id: string) => Promise<void>;
}

const ReceiptsContext = createContext<ReceiptsContextValue | null>(null);

export function ReceiptsProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, initialState);

  // Ref keeps refresh() stable while always reading the latest filter,
  // so a refresh after navigation never wipes an active search.
  const filterRef = useRef(state.filter);
  filterRef.current = state.filter;

  const refresh = useCallback(async (filterOverride?: ReceiptsFilter) => {
    const filter = filterOverride ?? filterRef.current;
    dispatch({ type: 'load-start' });
    try {
      const query = filter.searchQuery.trim();
      const [receipts, recent, stats] = await Promise.all([
        query
          ? searchReceipts(query)
          : getReceipts(
              filter.type !== 'all' ? { invoice_type: filter.type } : undefined,
            ),
        getRecentReceipts(5),
        getReceiptStats(),
      ]);
      dispatch({ type: 'load-success', receipts, recent, stats });
    } catch (error) {
      dispatch({
        type: 'load-error',
        error: error instanceof Error ? error.message : 'Failed to load receipts',
      });
    }
  }, []);

  const setFilter = useCallback(
    (partial: Partial<ReceiptsFilter>) => {
      const next = { ...filterRef.current, ...partial };
      dispatch({ type: 'set-filter', filter: next });
      refresh(next);
    },
    [refresh],
  );

  // Mutations: write to SQLite, then refresh in the background. The DB is
  // local, so the refresh lands in milliseconds — no optimistic patching.
  const addReceipt = useCallback(
    async (input: ReceiptInput) => {
      const saved = await createReceipt(input);
      refresh();
      return saved;
    },
    [refresh],
  );

  const updateReceiptById = useCallback(
    async (id: string, input: ReceiptInput) => {
      const saved = await updateReceipt(id, input);
      refresh();
      return saved;
    },
    [refresh],
  );

  const removeReceipt = useCallback(
    async (id: string) => {
      await deleteReceipt(id);
      await refresh();
    },
    [refresh],
  );

  // Single DB init for the whole app.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        await initDatabase();
        if (!cancelled) await refresh();
      } catch (error) {
        if (!cancelled) {
          dispatch({
            type: 'load-error',
            error:
              error instanceof Error ? error.message : 'Failed to initialize database',
          });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [refresh]);

  const value = useMemo<ReceiptsContextValue>(
    () => ({
      ...state,
      refresh: () => refresh(),
      setFilter,
      addReceipt,
      updateReceiptById,
      removeReceipt,
    }),
    [state, refresh, setFilter, addReceipt, updateReceiptById, removeReceipt],
  );

  return <ReceiptsContext.Provider value={value}>{children}</ReceiptsContext.Provider>;
}

export function useReceipts(): ReceiptsContextValue {
  const ctx = useContext(ReceiptsContext);
  if (!ctx) {
    throw new Error('useReceipts must be used within a ReceiptsProvider');
  }
  return ctx;
}
