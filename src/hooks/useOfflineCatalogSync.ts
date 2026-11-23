import { useEffect, useRef } from 'react';
import { useQueryClient, type Query } from '@tanstack/react-query';
import type { EnrichedInventoryItem } from '@/features/inventory/useInventory';
import {
  loadOfflineSnapshot,
  saveOfflineSnapshot,
  setActiveOfflineCacheUserId,
  type SaveOfflineSnapshotInput,
} from '@/lib/offlineCache';
import { clearPrivateQueries, queryKeys } from '@/lib/queryKeys';
import { isSupabaseConfigured } from '@/lib/supabase';
import type { Category, EquipmentType, LocationRecord, UserRole } from '@/types/database';

export interface UseOfflineCatalogSyncOptions {
  userId: string | null;
  role: UserRole;
  isAuthLoading: boolean;
  isOnline: boolean;
}

function queryKeysEqual(a: readonly unknown[], b: readonly unknown[]): boolean {
  return a.length === b.length && a.every((val, index) => val === b[index]);
}

function buildSlicePatchForQuery(
  query: Query<unknown, Error, unknown, readonly unknown[]>,
  role: UserRole
): SaveOfflineSnapshotInput | null {
  const data = query.state.data;
  if (!Array.isArray(data)) return null;

  if (queryKeysEqual(query.queryKey, queryKeys.inventory(role))) {
    return { inventory: data as EnrichedInventoryItem[] };
  }
  if (queryKeysEqual(query.queryKey, queryKeys.categories)) {
    return { categories: data as Category[] };
  }
  if (queryKeysEqual(query.queryKey, queryKeys.equipmentTypes)) {
    return { equipment_types: data as EquipmentType[] };
  }
  if (queryKeysEqual(query.queryKey, queryKeys.locations)) {
    return { locations: data as LocationRecord[] };
  }
  return null;
}

/**
 * Synchronizes resolved online catalog queries (`inventory`, `categories`,
 * `equipment_types`, `locations`) into user-scoped `localStorage` snapshots,
 * hydrates cached data when offline, and purges in-memory catalog queries on
 * user/role transitions so another user's snapshot never leaks.
 */
export function useOfflineCatalogSync({
  userId,
  role,
  isAuthLoading,
  isOnline,
}: UseOfflineCatalogSyncOptions): void {
  const queryClient = useQueryClient();
  const cacheUserId = role === 'guest' ? null : userId;
  const scopeKey = role === 'guest' ? 'guest' : `${cacheUserId ?? 'anon'}:${role}`;

  const prevScopeRef = useRef<string | undefined>(undefined);
  const isHydratingRef = useRef(false);
  const hydratedKeysRef = useRef<Map<string, number>>(new Map());

  setActiveOfflineCacheUserId(cacheUserId);

  useEffect(() => {
    setActiveOfflineCacheUserId(cacheUserId);
  }, [cacheUserId]);

  useEffect(() => {
    if (isAuthLoading) return;

    const prevScope = prevScopeRef.current;
    const scopeChanged = prevScope !== undefined && prevScope !== scopeKey;
    const bootedAuthenticated = prevScope === undefined && scopeKey !== 'guest';
    prevScopeRef.current = scopeKey;

    if (scopeChanged || bootedAuthenticated) {
      hydratedKeysRef.current.clear();

      if (scopeChanged) {
        queryClient.removeQueries({ queryKey: ['inventory'] });
        clearPrivateQueries(queryClient);
      } else {
        queryClient.removeQueries({ queryKey: queryKeys.inventory('guest') });
      }
      queryClient.removeQueries({ queryKey: queryKeys.categories });
      queryClient.removeQueries({ queryKey: queryKeys.equipmentTypes });
      queryClient.removeQueries({ queryKey: queryKeys.locations });
    }

    const canAccessUserScope = role === 'guest' || cacheUserId !== null;
    if (!canAccessUserScope) return;

    if (!isOnline) {
      const snapshot = loadOfflineSnapshot(cacheUserId);
      if (!snapshot) return;

      const parsedSavedAt = Date.parse(snapshot.savedAt);
      const updatedAt = Number.isFinite(parsedSavedAt) ? parsedSavedAt : Date.now();

      isHydratingRef.current = true;
      try {
        const hydrateSlice = <T,>(queryKey: readonly unknown[], sliceData: T[]) => {
          const existingQuery = queryClient.getQueryCache().find({ queryKey, exact: true });
          if (existingQuery && existingQuery.state.data !== undefined) {
            hydratedKeysRef.current.set(
              JSON.stringify(queryKey),
              existingQuery.state.dataUpdatedAt
            );
            return;
          }
          hydratedKeysRef.current.set(JSON.stringify(queryKey), updatedAt);
          queryClient.setQueryData(queryKey, sliceData, { updatedAt });
        };

        hydrateSlice(queryKeys.inventory(role), snapshot.inventory);
        hydrateSlice(queryKeys.categories, snapshot.categories);
        hydrateSlice(queryKeys.equipmentTypes, snapshot.equipment_types);
        hydrateSlice(queryKeys.locations, snapshot.locations);
      } finally {
        isHydratingRef.current = false;
      }
      return;
    }

    if (!isSupabaseConfigured) return;

    // Persist any catalog queries that already succeeded online before mount.
    const cacheQueries = queryClient.getQueryCache().getAll();
    const initialPatch: SaveOfflineSnapshotInput = {};
    let hasPatch = false;

    for (const query of cacheQueries) {
      if (query.state.status !== 'success' || query.state.dataUpdatedAt <= 0) continue;
      const hydratedStamp = hydratedKeysRef.current.get(JSON.stringify(query.queryKey));
      if (hydratedStamp !== undefined && query.state.dataUpdatedAt === hydratedStamp) {
        continue;
      }

      const slice = buildSlicePatchForQuery(query, role);
      if (slice) {
        Object.assign(initialPatch, slice);
        hasPatch = true;
      }
    }

    if (hasPatch) {
      saveOfflineSnapshot(cacheUserId, initialPatch);
    }

    const unsubscribe = queryClient.getQueryCache().subscribe((event) => {
      if (isHydratingRef.current) return;
      if (event.type !== 'updated' || event.action.type !== 'success') return;

      const slice = buildSlicePatchForQuery(event.query, role);
      if (!slice) return;

      hydratedKeysRef.current.delete(JSON.stringify(event.query.queryKey));
      saveOfflineSnapshot(cacheUserId, slice);
    });

    return () => {
      unsubscribe();
    };
  }, [cacheUserId, isAuthLoading, isOnline, queryClient, role, scopeKey]);
}
