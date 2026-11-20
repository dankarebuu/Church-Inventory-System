import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { EnrichedInventoryItem } from '@/features/inventory/useInventory';
import {
  getActiveOfflineCacheUserId,
  loadOfflineSnapshot,
  saveOfflineSnapshot,
} from '@/lib/offlineCache';
import { queryKeys } from '@/lib/queryKeys';
import type { Category, EquipmentType, LocationRecord, UserRole } from '@/types/database';
import { useOfflineCatalogSync } from './useOfflineCatalogSync';

const { mockIsConfigured } = vi.hoisted(() => ({
  mockIsConfigured: { value: true },
}));

vi.mock('@/lib/supabase', () => ({
  get isSupabaseConfigured() {
    return mockIsConfigured.value;
  },
}));

function makeItem(id: string, item: string, extra: Partial<EnrichedInventoryItem> = {}): EnrichedInventoryItem {
  return {
    id,
    category: 'Drums',
    category_id: 'cat-1',
    subcategory_id: null,
    item,
    brand: 'Pearl',
    qty: 2,
    condition: 'working',
    owner: 'Church Property',
    location: 'Stage',
    location_id: 'loc-1',
    serial: null,
    description: null,
    image_filename: null,
    remarks: null,
    dateChecked: null,
    checked_at: null,
    qty_on_loan: 0,
    available_qty: 2,
    equipment_type_id: 'et-1',
    equipment_type: 'Instruments',
    min_qty: null,
    ...extra,
  };
}

const sampleCategory: Category = {
  id: 'cat-1',
  name: 'Drums',
  parent_id: null,
  color: '#d97740',
  icon: 'drum',
  sort_order: 10,
  created_at: '2026-11-20T00:00:00.000Z',
};

const sampleType: EquipmentType = {
  id: 'et-1',
  name: 'Instruments',
  color: '#2563EB',
  icon: 'guitar',
  sort_order: 10,
  created_at: '2026-11-20T00:00:00.000Z',
};

const sampleLocation: LocationRecord = {
  id: 'loc-1',
  name: 'Stage',
  description: null,
  sort_order: 10,
  created_at: '2026-11-20T00:00:00.000Z',
};

function SyncHarness(props: {
  userId: string | null;
  role: UserRole;
  isAuthLoading: boolean;
  isOnline: boolean;
}) {
  useOfflineCatalogSync(props);
  return null;
}

describe('useOfflineCatalogSync', () => {
  beforeEach(() => {
    localStorage.clear();
    mockIsConfigured.value = true;
  });

  afterEach(() => {
    localStorage.clear();
  });

  it('persists resolved online catalog queries into user-namespaced localStorage without leaking across roles', async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });

    render(
      <QueryClientProvider client={queryClient}>
        <SyncHarness userId="member-1" role="member" isAuthLoading={false} isOnline={true} />
      </QueryClientProvider>
    );

    expect(getActiveOfflineCacheUserId()).toBe('member-1');

    const memberItem = makeItem('m-1', 'Member Kit', { checkedBy: 'Dan Caleb' });
    await act(async () => {
      await queryClient.fetchQuery({
        queryKey: queryKeys.inventory('member'),
        queryFn: async () => [memberItem],
      });
      await queryClient.fetchQuery({
        queryKey: queryKeys.categories,
        queryFn: async () => [sampleCategory],
      });
      await queryClient.fetchQuery({
        queryKey: queryKeys.equipmentTypes,
        queryFn: async () => [sampleType],
      });
      await queryClient.fetchQuery({
        queryKey: queryKeys.locations,
        queryFn: async () => [sampleLocation],
      });
    });

    const savedMember = loadOfflineSnapshot('member-1');
    expect(savedMember?.inventory.map((i) => i.item)).toEqual(['Member Kit']);
    expect(savedMember?.categories).toEqual([sampleCategory]);
    expect(savedMember?.equipment_types).toEqual([sampleType]);
    expect(savedMember?.locations).toEqual([sampleLocation]);
    expect(loadOfflineSnapshot('guest')).toBeNull();
  });

  it('hydrates cached catalog data when offline and clears in-memory catalog queries on user/role switch', () => {
    saveOfflineSnapshot('user-A', {
      inventory: [makeItem('a-1', 'User A Snare')],
      categories: [sampleCategory],
      equipment_types: [sampleType],
      locations: [sampleLocation],
      savedAt: '2026-11-20T09:00:00.000Z',
    });

    saveOfflineSnapshot('user-B', {
      inventory: [makeItem('b-1', 'User B Mic')],
      categories: [],
      equipment_types: [],
      locations: [],
      savedAt: '2026-11-20T09:30:00.000Z',
    });

    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });

    const { rerender } = render(
      <QueryClientProvider client={queryClient}>
        <SyncHarness userId="user-A" role="member" isAuthLoading={false} isOnline={false} />
      </QueryClientProvider>
    );

    expect(queryClient.getQueryData(queryKeys.inventory('member'))).toEqual([
      expect.objectContaining({ id: 'a-1', item: 'User A Snare' }),
    ]);
    expect(queryClient.getQueryData(queryKeys.categories)).toEqual([sampleCategory]);

    // Switching to User B offline clears User A's in-memory catalog data and hydrates User B's snapshot.
    rerender(
      <QueryClientProvider client={queryClient}>
        <SyncHarness userId="user-B" role="member" isAuthLoading={false} isOnline={false} />
      </QueryClientProvider>
    );

    expect(queryClient.getQueryData(queryKeys.inventory('member'))).toEqual([
      expect.objectContaining({ id: 'b-1', item: 'User B Mic' }),
    ]);
    expect(queryClient.getQueryData(queryKeys.categories)).toEqual([]);

    // Switching to guest (no guest snapshot) clears User B's data so nothing leaks.
    rerender(
      <QueryClientProvider client={queryClient}>
        <SyncHarness userId={null} role="guest" isAuthLoading={false} isOnline={false} />
      </QueryClientProvider>
    );

    expect(queryClient.getQueryData(queryKeys.inventory('member'))).toBeUndefined();
    expect(queryClient.getQueryData(queryKeys.inventory('guest'))).toBeUndefined();
    expect(queryClient.getQueryData(queryKeys.categories)).toBeUndefined();
  });
});
