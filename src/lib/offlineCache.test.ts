import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { EnrichedInventoryItem } from '@/features/inventory/useInventory';
import type { Category, EquipmentType, LocationRecord } from '@/types/database';
import {
  clearAllOfflineCaches,
  clearOfflineCache,
  getOfflineCacheKey,
  getOfflineSnapshotSavedAt,
  loadOfflineSnapshot,
  OFFLINE_CACHE_KEY_PREFIX,
  saveOfflineSnapshot,
} from './offlineCache';

function makeItem(overrides: Partial<EnrichedInventoryItem> = {}): EnrichedInventoryItem {
  return {
    id: 'item-1',
    category: 'Drums',
    category_id: 'cat-1',
    subcategory_id: null,
    item: 'Pearl Brass Snare',
    brand: 'Pearl',
    qty: 2,
    condition: 'working',
    owner: 'Church Property',
    location: 'Stage',
    location_id: 'loc-1',
    serial: 'SN-100',
    description: 'Main snare',
    image_filename: null,
    remarks: null,
    dateChecked: 'November 18, 2026',
    checked_at: '2026-11-18T09:00:00.000Z',
    qty_on_loan: 1,
    available_qty: 1,
    equipment_type_id: 'et-1',
    equipment_type: 'Instruments',
    min_qty: 1,
    ...overrides,
  };
}

const sampleCategory: Category = {
  id: 'cat-1',
  name: 'Drums',
  parent_id: null,
  color: '#d97740',
  icon: 'drum',
  sort_order: 10,
  created_at: '2026-11-18T00:00:00.000Z',
};

const sampleEquipmentType: EquipmentType = {
  id: 'et-1',
  name: 'Instruments',
  color: '#2563EB',
  icon: 'guitar',
  sort_order: 10,
  created_at: '2026-11-18T00:00:00.000Z',
};

const sampleLocation: LocationRecord = {
  id: 'loc-1',
  name: 'Stage',
  description: 'Main sanctuary stage',
  sort_order: 10,
  created_at: '2026-11-18T00:00:00.000Z',
};

describe('offlineCache', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    localStorage.clear();
  });

  it('builds user-namespaced and guest cache keys consistently', () => {
    expect(getOfflineCacheKey()).toBe(`${OFFLINE_CACHE_KEY_PREFIX}guest`);
    expect(getOfflineCacheKey(null)).toBe('wingmacc_offline_cache:guest');
    expect(getOfflineCacheKey('   ')).toBe('wingmacc_offline_cache:guest');
    expect(getOfflineCacheKey('user-123')).toBe('wingmacc_offline_cache:user-123');
  });

  it('saves, merges partial catalog updates, and loads snapshots with savedAt timestamp', () => {
    const first = saveOfflineSnapshot('user-1', {
      inventory: [makeItem()],
      categories: [sampleCategory],
      savedAt: '2026-11-20T10:00:00.000Z',
    });

    expect(first).not.toBeNull();
    expect(first?.savedAt).toBe('2026-11-20T10:00:00.000Z');
    expect(first?.inventory).toHaveLength(1);
    expect(first?.categories).toEqual([sampleCategory]);
    expect(first?.equipment_types).toEqual([]);
    expect(first?.locations).toEqual([]);

    const second = saveOfflineSnapshot('user-1', {
      equipment_types: [sampleEquipmentType],
      locations: [sampleLocation],
      savedAt: '2026-11-20T10:05:00.000Z',
    });

    expect(second?.inventory).toHaveLength(1);
    expect(second?.categories).toEqual([sampleCategory]);
    expect(second?.equipment_types).toEqual([sampleEquipmentType]);
    expect(second?.locations).toEqual([sampleLocation]);
    expect(getOfflineSnapshotSavedAt('user-1')).toBe('2026-11-20T10:05:00.000Z');

    const loaded = loadOfflineSnapshot('user-1');
    expect(loaded).toEqual(second);
  });

  it('isolates snapshots by user namespace and strips borrower/staff PII fields', () => {
    const itemWithPii = makeItem({
      checkedBy: 'Dan Caleb',
      updated_at: '2026-11-20T09:00:00.000Z',
      deleted_at: null,
      activeLoans: [
        {
          id: 'loan-1',
          item_id: 'item-1',
          borrower_name: 'Joel Santos',
          borrower_contact: '09171234567',
          qty_loaned: 1,
          checked_out_at: '2026-11-20T08:00:00.000Z',
          due_date: '2026-11-25',
          returned_at: null,
          checked_out_by: 'dan@wingmacc.org',
          returned_by: null,
          notes: 'Private note',
        },
      ],
    });

    saveOfflineSnapshot(null, {
      inventory: [itemWithPii],
      categories: [sampleCategory],
    });

    saveOfflineSnapshot('user-A', {
      inventory: [makeItem({ id: 'item-a', item: 'User A Synth' })],
      categories: [sampleCategory],
    });

    saveOfflineSnapshot('user-B', {
      inventory: [makeItem({ id: 'item-b', item: 'User B Amp' })],
      categories: [],
    });

    const guestRaw = localStorage.getItem(getOfflineCacheKey(null)) ?? '';
    expect(guestRaw).not.toContain('Joel Santos');
    expect(guestRaw).not.toContain('09171234567');
    expect(guestRaw).not.toContain('Dan Caleb');
    expect(guestRaw).not.toContain('activeLoans');

    const guestLoaded = loadOfflineSnapshot(null);
    expect(guestLoaded?.inventory[0].checkedBy).toBeUndefined();
    expect(guestLoaded?.inventory[0].activeLoans).toBeUndefined();
    expect(guestLoaded?.inventory[0].qty_on_loan).toBe(1);
    expect(guestLoaded?.inventory[0].available_qty).toBe(1);

    expect(loadOfflineSnapshot('user-A')?.inventory.map((i) => i.item)).toEqual(['User A Synth']);
    expect(loadOfflineSnapshot('user-B')?.inventory.map((i) => i.item)).toEqual(['User B Amp']);
    expect(loadOfflineSnapshot('user-C')).toBeNull();
  });

  it('safely returns null on corrupt or invalid localStorage entries', () => {
    localStorage.setItem(getOfflineCacheKey('guest'), '{invalid json');
    expect(loadOfflineSnapshot('guest')).toBeNull();
    expect(getOfflineSnapshotSavedAt('guest')).toBeNull();

    localStorage.setItem(
      getOfflineCacheKey('user-bad'),
      JSON.stringify({ inventory: 'not-an-array', savedAt: '2026-11-20T00:00:00.000Z' })
    );
    expect(loadOfflineSnapshot('user-bad')).toBeNull();
  });

  it('clears individual namespace or all offline caches without touching unrelated keys', () => {
    localStorage.setItem('wingmacc_theme', 'dark');
    saveOfflineSnapshot('guest', { inventory: [makeItem()] });
    saveOfflineSnapshot('user-1', { inventory: [makeItem({ id: 'u1' })] });
    saveOfflineSnapshot('user-2', { inventory: [makeItem({ id: 'u2' })] });

    clearOfflineCache('user-1');
    expect(loadOfflineSnapshot('user-1')).toBeNull();
    expect(loadOfflineSnapshot('user-2')).not.toBeNull();
    expect(loadOfflineSnapshot('guest')).not.toBeNull();
    expect(localStorage.getItem('wingmacc_theme')).toBe('dark');

    clearAllOfflineCaches();
    expect(loadOfflineSnapshot('user-2')).toBeNull();
    expect(loadOfflineSnapshot('guest')).toBeNull();
    expect(localStorage.getItem('wingmacc_theme')).toBe('dark');
  });
});
