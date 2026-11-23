import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '@/lib/queryKeys';
import { isSupabaseConfigured, supabase } from '@/lib/supabase';
import type { UserRole } from '@/types/database';

export const REALTIME_DEBOUNCE_MS = 250;
const REALTIME_RECONNECT_BASE_MS = 3000;
const REALTIME_RECONNECT_MAX_MS = 30_000;

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
  | 'equipment_types'
  | 'item_comments'
  | 'loans'
  | 'history_log'
  | 'profiles';

const GUEST_TABLES: readonly SyncTableName[] = [
  'categories',
  'locations',
  'equipment_types',
];
const MEMBER_TABLES: readonly SyncTableName[] = [
  'inventory',
  ...GUEST_TABLES,
  'item_comments',
  'loans',
  'history_log',
];
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
    case 'equipment_types':
      return [queryKeys.equipmentTypes];
    case 'item_comments':
      return [['item-comments'], queryKeys.commentCounts];
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
  const [reconnectNonce, setReconnectNonce] = useState(0);
  const timersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectAttemptRef = useRef(0);
  const wasDisconnectedRef = useRef(false);
  const prevRoleRef = useRef<UserRole>(role);

  useEffect(() => {
    if (prevRoleRef.current !== role) {
      prevRoleRef.current = role;
      reconnectAttemptRef.current = 0;
      wasDisconnectedRef.current = false;
    }

    const clearPendingTimers = () => {
      for (const timer of timersRef.current.values()) {
        clearTimeout(timer);
      }
      timersRef.current.clear();
    };

    const clearReconnectTimer = () => {
      if (reconnectTimerRef.current !== null) {
        clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
    };

    if (!isSupabaseConfigured) {
      clearPendingTimers();
      clearReconnectTimer();
      setStatus('offline');
      return;
    }

    let isActive = true;
    const isNavigatorOffline =
      typeof navigator !== 'undefined' && navigator.onLine === false;
    if (isNavigatorOffline) {
      wasDisconnectedRef.current = true;
    }
    setStatus(isNavigatorOffline ? 'offline' : 'connecting');

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

    const tables = getSubscribedTables(role);

    const invalidateAllSubscribedTables = () => {
      if (!isActive) return;
      const seenKeys = new Set<string>();
      for (const table of tables) {
        for (const key of getQueryKeysForTable(table, role)) {
          const cacheId = JSON.stringify(key);
          if (seenKeys.has(cacheId)) continue;
          seenKeys.add(cacheId);
          void queryClient.invalidateQueries({ queryKey: key });
        }
      }
    };

    const scheduleReconnect = () => {
      if (!isActive || reconnectTimerRef.current !== null) return;
      if (typeof navigator !== 'undefined' && navigator.onLine === false) return;

      const delayMs = Math.min(
        REALTIME_RECONNECT_BASE_MS * 2 ** reconnectAttemptRef.current,
        REALTIME_RECONNECT_MAX_MS
      );
      reconnectAttemptRef.current += 1;
      reconnectTimerRef.current = setTimeout(() => {
        reconnectTimerRef.current = null;
        if (!isActive) return;
        setReconnectNonce((prev) => prev + 1);
      }, delayMs);
    };

    const channel = supabase.channel(`wingmacc-sync-${role}`);

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
        clearReconnectTimer();
        reconnectAttemptRef.current = 0;
        setStatus('connected');
        if (wasDisconnectedRef.current) {
          wasDisconnectedRef.current = false;
          invalidateAllSubscribedTables();
        }
      } else if (subscribeStatus === 'CLOSED') {
        wasDisconnectedRef.current = true;
        setStatus('offline');
      } else if (subscribeStatus === 'TIMED_OUT' || subscribeStatus === 'CHANNEL_ERROR') {
        wasDisconnectedRef.current = true;
        setStatus('error');
        scheduleReconnect();
      }
    });

    const handleOffline = () => {
      wasDisconnectedRef.current = true;
      clearReconnectTimer();
      if (isActive) setStatus('offline');
    };

    const handleOnline = () => {
      if (!isActive) return;
      wasDisconnectedRef.current = true;
      clearReconnectTimer();
      reconnectAttemptRef.current = 0;
      setStatus('connecting');
      invalidateAllSubscribedTables();
      setReconnectNonce((prev) => prev + 1);
    };

    if (typeof window !== 'undefined') {
      window.addEventListener('offline', handleOffline);
      window.addEventListener('online', handleOnline);
    }

    return () => {
      isActive = false;
      clearPendingTimers();
      clearReconnectTimer();
      if (typeof window !== 'undefined') {
        window.removeEventListener('offline', handleOffline);
        window.removeEventListener('online', handleOnline);
      }
      void supabase.removeChannel(channel);
    };
  }, [queryClient, role, reconnectNonce]);

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
