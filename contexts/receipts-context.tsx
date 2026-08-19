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
  deleteAllReceipts,
  deleteReceipt,
  getReceipts,
  getReceiptStats,
  getRecentReceipts,
  initDatabase,
  markReceiptsSynced,
  searchReceipts,
  updateReceipt,
} from '@/services/storage';
import {
  isRemoteConfigured,
  refreshRemoteConfig,
  syncReceipt,
} from '@/services/remote-db';
import { syncPendingReceipts } from '@/services/config';
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
  /** Wipe every receipt on this device. Caller must confirm first. */
  clearAllReceipts: () => Promise<number>;
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
      // Req 2.9/2.10: mirror to the configured endpoint, but never let a
      // network failure surface as a failed scan — the local row is the record.
      // A failure leaves synced_at null, so the next launch retries it.
      if (isRemoteConfigured()) {
        syncReceipt(saved)
          .then(() => markReceiptsSynced([saved.id]))
          .catch((error) => {
            console.warn('Remote sync failed; receipt is saved locally:', error);
          });
      }
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

  const clearAllReceipts = useCallback(async () => {
    const deleted = await deleteAllReceipts();
    await refresh();
    return deleted;
  }, [refresh]);

  // Single DB init for the whole app.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        await initDatabase();
        await refreshRemoteConfig();
        if (!cancelled) await refresh();

        // Catch up anything scanned without signal. Fire-and-forget: the app
        // is fully usable whether or not the database is reachable.
        syncPendingReceipts().catch((error) => {
          console.warn('Pending sync failed; will retry next launch:', error);
        });
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
      clearAllReceipts,
    }),
    [
      state,
      refresh,
      setFilter,
      addReceipt,
      updateReceiptById,
      removeReceipt,
      clearAllReceipts,
    ],
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
