import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '@/lib/queryKeys';
import { isSupabaseConfigured, supabase } from '@/lib/supabase';
import type { UserRole } from '@/types/database';

export const REALTIME_DEBOUNCE_MS = 250;

export type RealtimeSyncState = 'idle' | 'connecting' | 'connected' | 'offline' | 'error';

export interface RealtimeSyncStatus {
  status: RealtimeSyncState;
  label: string;
  isConfigured: boolean;
}

type SyncTableName =
  | 'inventory'
  | 'categories'
  | 'locations'
  | 'loans'
  | 'history_log'
  | 'profiles';

const GUEST_TABLES: readonly SyncTableName[] = ['categories', 'locations'];
const MEMBER_TABLES: readonly SyncTableName[] = ['inventory', ...GUEST_TABLES, 'loans', 'history_log'];
const ADMIN_TABLES: readonly SyncTableName[] = [...MEMBER_TABLES, 'profiles'];

const STATUS_LABELS: Record<RealtimeSyncState, string> = {
  idle: 'Idle',
  connecting: 'Connecting...',
  connected: 'Live Sync',
  offline: 'Offline',
  error: 'Sync Error',
};

function getSubscribedTables(role: UserRole): readonly SyncTableName[] {
  if (role === 'admin') return ADMIN_TABLES;
  if (role === 'member') return MEMBER_TABLES;
  return GUEST_TABLES;
}

function getQueryKeysForTable(
  table: SyncTableName,
  role: UserRole
): ReadonlyArray<readonly unknown[]> {
  switch (table) {
    case 'inventory':
      return [queryKeys.inventory(role)];
    case 'categories':
      return [queryKeys.categories];
    case 'locations':
      return [queryKeys.locations];
    case 'loans':
      return [queryKeys.loans, queryKeys.inventory(role)];
    case 'history_log':
      return [queryKeys.history];
    case 'profiles':
      return [queryKeys.profiles];
  }
}

function getInitialSyncState(): RealtimeSyncState {
  if (!isSupabaseConfigured) return 'offline';
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return 'offline';
  return 'connecting';
}

/**
 * Subscribes to role-scoped Supabase Realtime table changes and debounces
 * TanStack Query invalidations per query key so rapid multi-row bursts coalesce.
 */
export function useRealtimeSync(role: UserRole): RealtimeSyncStatus {
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<RealtimeSyncState>(getInitialSyncState);
  const timersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  useEffect(() => {
    const clearPendingTimers = () => {
      for (const timer of timersRef.current.values()) {
        clearTimeout(timer);
      }
      timersRef.current.clear();
    };

    if (!isSupabaseConfigured) {
      clearPendingTimers();
      setStatus('offline');
      return;
    }

    let isActive = true;
    setStatus(
      typeof navigator !== 'undefined' && navigator.onLine === false
        ? 'offline'
        : 'connecting'
    );

    const scheduleInvalidation = (queryKey: readonly unknown[]) => {
      if (!isActive) return;
      const cacheId = JSON.stringify(queryKey);
      const existingTimer = timersRef.current.get(cacheId);
      if (existingTimer !== undefined) {
        clearTimeout(existingTimer);
      }

      const nextTimer = setTimeout(() => {
        timersRef.current.delete(cacheId);
        if (!isActive) return;
        void queryClient.invalidateQueries({ queryKey });
      }, REALTIME_DEBOUNCE_MS);

      timersRef.current.set(cacheId, nextTimer);
    };

    const channel = supabase.channel(`wingmacc-sync-${role}`);
    const tables = getSubscribedTables(role);

    for (const table of tables) {
      channel.on<Record<string, unknown>>(
        'postgres_changes',
        { event: '*', schema: 'public', table },
        () => {
          for (const key of getQueryKeysForTable(table, role)) {
            scheduleInvalidation(key);
          }
        }
      );
    }

    channel.subscribe((subscribeStatus) => {
      if (!isActive) return;
      if (subscribeStatus === 'SUBSCRIBED') {
        setStatus('connected');
      } else if (subscribeStatus === 'CLOSED') {
        setStatus('offline');
      } else if (subscribeStatus === 'TIMED_OUT' || subscribeStatus === 'CHANNEL_ERROR') {
        setStatus('error');
      }
    });

    const handleOffline = () => {
      if (isActive) setStatus('offline');
    };

    const handleOnline = () => {
      if (isActive) setStatus('connecting');
    };

    if (typeof window !== 'undefined') {
      window.addEventListener('offline', handleOffline);
      window.addEventListener('online', handleOnline);
    }

    return () => {
      isActive = false;
      clearPendingTimers();
      if (typeof window !== 'undefined') {
        window.removeEventListener('offline', handleOffline);
        window.removeEventListener('online', handleOnline);
      }
      void supabase.removeChannel(channel);
    };
  }, [queryClient, role]);

  const resolvedStatus: RealtimeSyncState = isSupabaseConfigured ? status : 'offline';
  const label =
    resolvedStatus === 'connected' && role === 'guest'
      ? 'Catalog Sync'
      : STATUS_LABELS[resolvedStatus];

  return {
    status: resolvedStatus,
    label,
    isConfigured: isSupabaseConfigured,
  };
}
