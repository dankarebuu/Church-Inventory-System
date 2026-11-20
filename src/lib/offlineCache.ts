import type { EnrichedInventoryItem } from '@/features/inventory/useInventory';
import type { Category, EquipmentType, LocationRecord } from '@/types/database';

export const OFFLINE_CACHE_KEY_PREFIX = 'wingmacc_offline_cache:';
export const OFFLINE_CACHE_UPDATED_EVENT = 'wingmacc:offline-cache-updated';

export interface OfflineCatalogSnapshot {
  inventory: EnrichedInventoryItem[];
  categories: Category[];
  equipment_types: EquipmentType[];
  locations: LocationRecord[];
  savedAt: string;
}

export interface SaveOfflineSnapshotInput {
  inventory?: readonly EnrichedInventoryItem[];
  categories?: readonly Category[];
  equipment_types?: readonly EquipmentType[];
  locations?: readonly LocationRecord[];
  savedAt?: string;
}

export type OfflineCatalogSliceKey = keyof Omit<OfflineCatalogSnapshot, 'savedAt'>;

let activeOfflineCacheUserId: string | null = null;

function normalizeScope(userId?: string | null): string {
  const trimmed = typeof userId === 'string' ? userId.trim() : '';
  return trimmed.length > 0 ? trimmed : 'guest';
}

function getStorage(): Storage | null {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      return window.localStorage;
    }
  } catch {
    // Ignore storage access errors in restricted browser contexts.
  }
  return null;
}

function notifyCacheUpdated(): void {
  try {
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new Event(OFFLINE_CACHE_UPDATED_EVENT));
    }
  } catch {
    // Ignore event dispatch errors in non-DOM environments.
  }
}

function sanitizeInventoryItemForCache(
  item: EnrichedInventoryItem,
  isGuest: boolean
): EnrichedInventoryItem {
  const safeBase: EnrichedInventoryItem = {
    id: item.id,
    category: item.category,
    category_id: item.category_id,
    subcategory_id: item.subcategory_id,
    item: item.item,
    brand: item.brand,
    qty: item.qty,
    condition: item.condition,
    owner: item.owner,
    location: item.location,
    location_id: item.location_id,
    serial: item.serial,
    description: item.description,
    image_filename: item.image_filename,
    remarks: item.remarks,
    dateChecked: item.dateChecked,
    checked_at: item.checked_at,
    qty_on_loan: item.qty_on_loan,
    available_qty: item.available_qty,
    equipment_type_id: item.equipment_type_id,
    equipment_type: item.equipment_type,
    min_qty: item.min_qty,
  };

  if (isGuest) {
    return safeBase;
  }

  return {
    ...safeBase,
    ...(item.checkedBy !== undefined ? { checkedBy: item.checkedBy } : {}),
    ...(item.updated_at !== undefined ? { updated_at: item.updated_at } : {}),
    ...(item.deleted_at !== undefined ? { deleted_at: item.deleted_at } : {}),
  };
}

function isValidSnapshotShape(value: unknown): value is OfflineCatalogSnapshot {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.savedAt === 'string' &&
    record.savedAt.length > 0 &&
    Array.isArray(record.inventory) &&
    Array.isArray(record.categories) &&
    Array.isArray(record.equipment_types) &&
    Array.isArray(record.locations)
  );
}

/**
 * Sets the active authenticated user ID for offline catalog cache scoping
 * (`null` resolves to `'guest'`). Called by `AuthProvider`.
 */
export function setActiveOfflineCacheUserId(userId: string | null): void {
  const trimmed = typeof userId === 'string' ? userId.trim() : '';
  activeOfflineCacheUserId = trimmed.length > 0 ? trimmed : null;
}

/**
 * Returns the active authenticated user ID (`null` when in guest mode).
 */
export function getActiveOfflineCacheUserId(): string | null {
  return activeOfflineCacheUserId;
}

/**
 * Returns the `localStorage` key for the given user ID or `'guest'`.
 */
export function getOfflineCacheKey(userId?: string | null): string {
  return `${OFFLINE_CACHE_KEY_PREFIX}${normalizeScope(userId)}`;
}

/**
 * Loads the persisted read-only catalog snapshot for `userId` (or `'guest'`).
 * Returns `null` if absent or malformed.
 */
export function loadOfflineSnapshot(userId?: string | null): OfflineCatalogSnapshot | null {
  const storage = getStorage();
  if (!storage) return null;

  try {
    const raw = storage.getItem(getOfflineCacheKey(userId));
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!isValidSnapshotShape(parsed)) return null;
    return parsed;
  } catch {
    return null;
  }
}

/**
 * Saves or merges read-only catalog slices (`inventory`, `categories`,
 * `equipment_types`, `locations`) under `wingmacc_offline_cache:<userId|guest>`
 * with an ISO `savedAt` timestamp. Strips borrower/loan PII before persistence.
 */
export function saveOfflineSnapshot(
  userId: string | null | undefined,
  snapshot: SaveOfflineSnapshotInput
): OfflineCatalogSnapshot | null {
  const storage = getStorage();
  if (!storage) return null;

  const scope = normalizeScope(userId);
  const isGuest = scope === 'guest';
  const existing = loadOfflineSnapshot(userId);

  const nextSnapshot: OfflineCatalogSnapshot = {
    inventory:
      snapshot.inventory !== undefined
        ? snapshot.inventory.map((entry) => sanitizeInventoryItemForCache(entry, isGuest))
        : (existing?.inventory ?? []),
    categories:
      snapshot.categories !== undefined
        ? [...snapshot.categories]
        : (existing?.categories ?? []),
    equipment_types:
      snapshot.equipment_types !== undefined
        ? [...snapshot.equipment_types]
        : (existing?.equipment_types ?? []),
    locations:
      snapshot.locations !== undefined
        ? [...snapshot.locations]
        : (existing?.locations ?? []),
    savedAt: snapshot.savedAt ?? new Date().toISOString(),
  };

  try {
    storage.setItem(getOfflineCacheKey(userId), JSON.stringify(nextSnapshot));
    notifyCacheUpdated();
    return nextSnapshot;
  } catch {
    return null;
  }
}

/**
 * Returns the ISO `savedAt` timestamp for the cached snapshot, or `null` if none exists.
 */
export function getOfflineSnapshotSavedAt(userId?: string | null): string | null {
  return loadOfflineSnapshot(userId)?.savedAt ?? null;
}

/**
 * Removes the cached offline snapshot for a single user namespace (or `'guest'`).
 */
export function clearOfflineCache(userId?: string | null): void {
  const storage = getStorage();
  if (!storage) return;

  try {
    storage.removeItem(getOfflineCacheKey(userId));
    notifyCacheUpdated();
  } catch {
    // Ignore storage removal errors.
  }
}

/**
 * Returns `true` when the browser reports offline or a fetch failed with a
 * network `TypeError` (used by catalog queries to avoid swallowing RLS errors).
 */
export function isOfflineNetworkError(error: unknown): boolean {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    return true;
  }
  return error instanceof TypeError;
}

/**
 * Reads an initial offline catalog slice synchronously when `navigator.onLine`
 * is `false` so cold offline renders avoid a loading/paused dead-end.
 */
export function getOfflineInitialSlice<K extends OfflineCatalogSliceKey>(
  sliceKey: K,
  userId?: string | null
): { data: OfflineCatalogSnapshot[K]; updatedAt: number } | null {
  if (typeof navigator === 'undefined' || navigator.onLine !== false) {
    return null;
  }
  const snapshot = loadOfflineSnapshot(userId);
  if (!snapshot) return null;
  const parsed = Date.parse(snapshot.savedAt);
  return {
    data: snapshot[sliceKey],
    updatedAt: Number.isFinite(parsed) ? parsed : 0,
  };
}

/**
 * Purges every `wingmacc_offline_cache:*` namespace from `localStorage` without
 * disturbing unrelated preferences such as theme.
 */
export function clearAllOfflineCaches(): void {
  const storage = getStorage();
  if (!storage) return;

  try {
    const keysToRemove: string[] = [];
    for (let i = 0; i < storage.length; i++) {
      const key = storage.key(i);
      if (key && key.startsWith(OFFLINE_CACHE_KEY_PREFIX)) {
        keysToRemove.push(key);
      }
    }
    for (const key of keysToRemove) {
      storage.removeItem(key);
    }
    if (keysToRemove.length > 0) {
      notifyCacheUpdated();
    }
  } catch {
    // Ignore storage removal errors.
  }
}
