import { useCallback } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/features/auth/useAuth';
import { queryKeys } from '@/lib/queryKeys';
import { isSupabaseConfigured, supabase } from '@/lib/supabase';
import {
  createHistoryId,
  deriveActorName,
  formatDisplayDate,
  parseImages,
  trimOrNull,
} from '@/lib/utils';
import type {
  Category,
  Database,
  InventoryItem,
  ItemCondition,
  LoanRecord,
  LocationRecord,
  MemberCheckItemResult,
  PublicInventoryItem,
  UserRole,
} from '@/types/database';
import {
  itemFormSchema,
  memberCheckSchema,
  validatePhotoFiles,
  type ItemFormInput,
  type ItemFormValues,
} from './schemas';

/**
 * Unified inventory item projection consumed across Inventory, Dashboard, and
 * Sunday Checklist views. Guest reads leave `checkedBy`, `updated_at`,
 * `deleted_at`, and `activeLoans` undefined.
 */
export interface EnrichedInventoryItem extends PublicInventoryItem {
  checkedBy?: string | null;
  updated_at?: string | null;
  deleted_at?: string | null;
  activeLoans?: LoanRecord[];
}

export interface SaveItemInput {
  values: ItemFormInput | ItemFormValues;
  existingItem?: EnrichedInventoryItem | InventoryItem | null;
  existingPhotos?: string[];
  newPhotoFiles?: File[];
}

export interface MemberCheckItemInput {
  itemId: string;
  condition: ItemCondition;
  remarks?: string | null;
}

export type SoftDeleteTarget =
  | string
  | Pick<InventoryItem, 'id'>
  | InventoryItem
  | EnrichedInventoryItem;

const GEAR_PHOTOS_BUCKET = 'gear-photos';
const EMPTY_INVENTORY: EnrichedInventoryItem[] = [];

type InventoryInsert = Database['public']['Tables']['inventory']['Insert'];
type InventoryUpdate = Database['public']['Tables']['inventory']['Update'];
type HistoryInsert = Database['public']['Tables']['history_log']['Insert'];

function createItemId(): string {
  return `item_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

function toInventorySnapshot(
  item: InventoryItem | EnrichedInventoryItem
): Partial<InventoryItem> {
  return {
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
    checkedBy: item.checkedBy ?? null,
    dateChecked: item.dateChecked,
    checked_at: item.checked_at,
    updated_at: item.updated_at ?? null,
    remarks: item.remarks,
    serial: item.serial,
    description: item.description,
    image_filename: item.image_filename,
    deleted_at: item.deleted_at ?? null,
  };
}

function extractFileExtension(fileName: string): string {
  const parts = fileName.trim().split('.');
  if (parts.length > 1) {
    const ext = parts[parts.length - 1].toLowerCase().replace(/[^a-z0-9]/g, '');
    if (ext) return ext;
  }
  return 'bin';
}

async function cleanupUploadedPaths(paths: readonly string[]): Promise<void> {
  if (paths.length === 0) return;
  try {
    const bucket = supabase.storage.from(GEAR_PHOTOS_BUCKET);
    if (typeof bucket.remove === 'function') {
      await bucket.remove([...paths]);
    }
  } catch {
    // Best-effort cleanup so the original upload or persistence error surfaces clearly.
  }
}

interface UploadedPhotoBatch {
  publicUrls: string[];
  storagePaths: string[];
}

async function uploadPhotoBatch(
  files: readonly File[],
  existingPhotoCount = 0
): Promise<UploadedPhotoBatch> {
  const validation = validatePhotoFiles(files, existingPhotoCount);
  if (!validation.valid) {
    throw new Error(validation.error ?? 'Invalid photo selection.');
  }

  if (files.length === 0) {
    return { publicUrls: [], storagePaths: [] };
  }

  if (!isSupabaseConfigured) {
    throw new Error('Supabase is not configured.');
  }

  const bucket = supabase.storage.from(GEAR_PHOTOS_BUCKET);
  const publicUrls: string[] = [];
  const storagePaths: string[] = [];

  for (let index = 0; index < files.length; index++) {
    const file = files[index];
    const ext = extractFileExtension(file.name);
    const randomSuffix = Math.random().toString(36).slice(2, 8);
    const filePath = `${Date.now()}_${index}_${randomSuffix}.${ext}`;

    const { error: uploadError } = await bucket.upload(filePath, file);
    if (uploadError) {
      await cleanupUploadedPaths(storagePaths);
      throw new Error(`Failed to upload "${file.name}": ${uploadError.message}`);
    }

    storagePaths.push(filePath);

    const { data: urlData } = bucket.getPublicUrl(filePath);
    if (!urlData?.publicUrl) {
      await cleanupUploadedPaths(storagePaths);
      throw new Error(`Failed to resolve public URL for "${file.name}".`);
    }

    publicUrls.push(urlData.publicUrl);
  }

  return { publicUrls, storagePaths };
}

/**
 * Sorts inventory items consistently by category then item name using `localeCompare`.
 */
export function sortInventoryItems<
  T extends Pick<PublicInventoryItem, 'category' | 'item'>,
>(items: readonly T[]): T[] {
  return [...items].sort((a, b) => {
    const categoryCmp = (a.category ?? '').localeCompare(b.category ?? '');
    if (categoryCmp !== 0) return categoryCmp;
    return (a.item ?? '').localeCompare(b.item ?? '');
  });
}

/**
 * Combines raw `inventory` rows with active `loans` (`returned_at == null`),
 * computing `qty_on_loan`, clamped `available_qty`, and attached `activeLoans`.
 */
export function enrichItemsWithLoans(
  items: readonly InventoryItem[],
  activeLoans: readonly LoanRecord[]
): EnrichedInventoryItem[] {
  const loansByItemId = new Map<string, { qtyOnLoan: number; loans: LoanRecord[] }>();

  for (const loan of activeLoans) {
    if (loan.returned_at != null) continue;
    const qtyLoaned = Number.isFinite(loan.qty_loaned) ? Math.max(loan.qty_loaned, 0) : 0;
    const existing = loansByItemId.get(loan.item_id);
    if (existing) {
      existing.qtyOnLoan += qtyLoaned;
      existing.loans.push(loan);
    } else {
      loansByItemId.set(loan.item_id, {
        qtyOnLoan: qtyLoaned,
        loans: [loan],
      });
    }
  }

  return items.map((item) => {
    const safeQty = Number.isFinite(item.qty) ? Math.max(item.qty, 0) : 0;
    const loanSummary = loansByItemId.get(item.id);
    const qtyOnLoan = loanSummary?.qtyOnLoan ?? 0;
    const availableQty = Math.max(safeQty - qtyOnLoan, 0);

    return {
      id: item.id,
      category: item.category,
      category_id: item.category_id,
      subcategory_id: item.subcategory_id,
      item: item.item,
      brand: item.brand,
      qty: safeQty,
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
      checkedBy: item.checkedBy,
      updated_at: item.updated_at,
      deleted_at: item.deleted_at,
      qty_on_loan: qtyOnLoan,
      available_qty: availableQty,
      activeLoans: loanSummary?.loans ?? [],
    };
  });
}

function normalizePublicInventoryItem(row: PublicInventoryItem): EnrichedInventoryItem {
  const safeQty = Number.isFinite(row.qty) ? Math.max(row.qty, 0) : 0;
  const qtyOnLoan = Number.isFinite(row.qty_on_loan) ? Math.max(row.qty_on_loan, 0) : 0;
  const availableQty = Number.isFinite(row.available_qty)
    ? Math.max(row.available_qty, 0)
    : Math.max(safeQty - qtyOnLoan, 0);

  return {
    id: row.id,
    category: row.category,
    category_id: row.category_id,
    subcategory_id: row.subcategory_id,
    item: row.item,
    brand: row.brand,
    qty: safeQty,
    condition: row.condition,
    owner: row.owner,
    location: row.location,
    location_id: row.location_id,
    serial: row.serial,
    description: row.description,
    image_filename: row.image_filename,
    remarks: row.remarks,
    dateChecked: row.dateChecked,
    checked_at: row.checked_at,
    qty_on_loan: qtyOnLoan,
    available_qty: availableQty,
  };
}

async function fetchInventoryItems(role: UserRole): Promise<EnrichedInventoryItem[]> {
  if (role === 'guest') {
    const { data, error } = await supabase.from('inventory_public').select('*');
    if (error) {
      throw new Error(error.message);
    }
    const normalized = (data ?? []).map(normalizePublicInventoryItem);
    return sortInventoryItems(normalized);
  }

  const [inventoryResult, loansResult] = await Promise.all([
    supabase.from('inventory').select('*').is('deleted_at', null),
    supabase.from('loans').select('*').is('returned_at', null),
  ]);

  if (inventoryResult.error) {
    throw new Error(inventoryResult.error.message);
  }
  if (loansResult.error) {
    throw new Error(loansResult.error.message);
  }

  const enriched = enrichItemsWithLoans(
    inventoryResult.data ?? [],
    loansResult.data ?? []
  );
  return sortInventoryItems(enriched);
}

/**
 * Role-aware inventory query hook.
 * Guests query ONLY `inventory_public` (zero access to `inventory` or `loans`),
 * while Members and Admins query non-deleted `inventory` + active `loans`.
 */
export function useInventoryItems(role: UserRole) {
  return useQuery<EnrichedInventoryItem[], Error>({
    queryKey: queryKeys.inventory(role),
    queryFn: () => fetchInventoryItems(role),
    enabled: isSupabaseConfigured,
    initialData: isSupabaseConfigured ? undefined : EMPTY_INVENTORY,
  });
}

function isSnapshotItem(
  target: SoftDeleteTarget
): target is InventoryItem | EnrichedInventoryItem {
  return typeof target === 'object' && target !== null && 'item' in target;
}

/**
 * Provides role-guarded inventory mutations (`saveItem`, `softDeleteItem`,
 * `memberCheckItem`, and `uploadGearPhotos`) with TanStack Query invalidation.
 */
export function useItemMutations() {
  const { role, user, profile } = useAuth();
  const queryClient = useQueryClient();

  const invalidateInventoryAndHistory = useCallback(async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.inventory(role) }),
      queryClient.invalidateQueries({ queryKey: queryKeys.history }),
    ]);
  }, [queryClient, role]);

  const uploadMutation = useMutation<
    string[],
    Error,
    { files: readonly File[]; existingCount: number }
  >({
    mutationFn: async ({ files, existingCount }) => {
      if (role !== 'admin') {
        throw new Error('Only administrators can upload gear photos.');
      }
      const { publicUrls } = await uploadPhotoBatch(files, existingCount);
      return publicUrls;
    },
  });

  const saveMutation = useMutation<Partial<InventoryItem>, Error, SaveItemInput>({
    mutationFn: async (input) => {
      if (!isSupabaseConfigured) {
        throw new Error('Supabase is not configured.');
      }
      if (role !== 'admin') {
        throw new Error('Only administrators can save inventory items.');
      }

      const parsed = itemFormSchema.parse(input.values);
      const rawExistingPhotos =
        input.existingPhotos !== undefined
          ? input.existingPhotos
          : parseImages(input.existingItem?.image_filename);
      const existingPhotos = rawExistingPhotos
        .map((url) => url.trim())
        .filter((url) => url.length > 0);
      const newPhotoFiles = input.newPhotoFiles ?? [];

      const { publicUrls: uploadedUrls, storagePaths: uploadedPaths } =
        await uploadPhotoBatch(newPhotoFiles, existingPhotos.length);

      const mergedPhotos = [...existingPhotos, ...uploadedUrls];
      const imageFilename = mergedPhotos.length > 0 ? JSON.stringify(mergedPhotos) : null;

      const cachedCategories =
        queryClient.getQueryData<Category[]>(queryKeys.categories) ?? [];
      const cachedLocations =
        queryClient.getQueryData<LocationRecord[]>(queryKeys.locations) ?? [];

      const matchedCategory = parsed.category_id
        ? cachedCategories.find((cat) => cat.id === parsed.category_id)
        : undefined;
      const resolvedCategory =
        trimOrNull(parsed.category) ??
        trimOrNull(matchedCategory?.name) ??
        (input.existingItem?.category_id === parsed.category_id
          ? trimOrNull(input.existingItem?.category)
          : null) ??
        'Others';

      const matchedLocation = parsed.location_id
        ? cachedLocations.find((loc) => loc.id === parsed.location_id)
        : undefined;
      const resolvedLocation =
        trimOrNull(parsed.location) ?? trimOrNull(matchedLocation?.name) ?? null;

      const now = new Date();
      const nowIso = now.toISOString();
      const actorName = deriveActorName(profile, user);
      const actorEmail = user?.email ?? profile?.email ?? 'unknown';

      const sharedFields = {
        item: parsed.item,
        category: resolvedCategory,
        category_id: parsed.category_id,
        subcategory_id: parsed.subcategory_id,
        brand: trimOrNull(parsed.brand),
        qty: parsed.qty,
        condition: parsed.condition,
        owner: trimOrNull(parsed.owner),
        location: resolvedLocation,
        location_id: parsed.location_id,
        serial: trimOrNull(parsed.serial),
        description: trimOrNull(parsed.description),
        remarks: trimOrNull(parsed.remarks),
        image_filename: imageFilename,
        updated_at: nowIso,
      };

      if (!input.existingItem) {
        const newId = createItemId();
        const insertPayload: InventoryInsert = {
          id: newId,
          ...sharedFields,
          checkedBy: actorName,
          dateChecked: formatDisplayDate(now),
          checked_at: nowIso,
          deleted_at: null,
        };

        const { error: insertError } = await supabase
          .from('inventory')
          .insert([insertPayload]);

        if (insertError) {
          await cleanupUploadedPaths(uploadedPaths);
          throw new Error(insertError.message);
        }

        const historyEntry: HistoryInsert = {
          id: createHistoryId(),
          action: 'added',
          item_id: newId,
          item_data: insertPayload,
          prev_data: null,
          user_email: actorEmail,
          undone: false,
          timestamp: nowIso,
        };

        const { error: historyError } = await supabase
          .from('history_log')
          .insert([historyEntry]);
        if (historyError) {
          throw new Error(historyError.message);
        }

        await invalidateInventoryAndHistory();
        return insertPayload;
      }

      const existing = input.existingItem;
      const conditionChanged = existing.condition !== parsed.condition;
      const updatePayload: InventoryUpdate = {
        ...sharedFields,
        ...(conditionChanged
          ? {
              checkedBy: actorName,
              dateChecked: formatDisplayDate(now),
              checked_at: nowIso,
            }
          : {}),
      };

      const { error: updateError } = await supabase
        .from('inventory')
        .update(updatePayload)
        .eq('id', existing.id);

      if (updateError) {
        await cleanupUploadedPaths(uploadedPaths);
        throw new Error(updateError.message);
      }

      const prevSnapshot = toInventorySnapshot(existing);
      const nextSnapshot: Partial<InventoryItem> = {
        ...prevSnapshot,
        ...updatePayload,
        id: existing.id,
      };

      const historyEntry: HistoryInsert = {
        id: createHistoryId(),
        action: 'updated',
        item_id: existing.id,
        item_data: nextSnapshot,
        prev_data: prevSnapshot,
        user_email: actorEmail,
        undone: false,
        timestamp: nowIso,
      };

      const { error: historyError } = await supabase
        .from('history_log')
        .insert([historyEntry]);
      if (historyError) {
        throw new Error(historyError.message);
      }

      await invalidateInventoryAndHistory();
      return nextSnapshot;
    },
  });

  const softDeleteMutation = useMutation<void, Error, SoftDeleteTarget>({
    mutationFn: async (target) => {
      if (!isSupabaseConfigured) {
        throw new Error('Supabase is not configured.');
      }
      if (role !== 'admin') {
        throw new Error('Only administrators can delete inventory items.');
      }

      const itemId = typeof target === 'string' ? target : target.id;
      const deletedAt = new Date().toISOString();
      const actorEmail = user?.email ?? profile?.email ?? 'unknown';

      const { error: deleteError } = await supabase
        .from('inventory')
        .update({ deleted_at: deletedAt })
        .eq('id', itemId);

      if (deleteError) {
        throw new Error(deleteError.message);
      }

      const prevSnapshot = isSnapshotItem(target) ? toInventorySnapshot(target) : null;
      const itemData: Partial<InventoryItem> = prevSnapshot
        ? { ...prevSnapshot, deleted_at: deletedAt }
        : { id: itemId, deleted_at: deletedAt };

      const historyEntry: HistoryInsert = {
        id: createHistoryId(),
        action: 'deleted',
        item_id: itemId,
        item_data: itemData,
        prev_data: prevSnapshot,
        user_email: actorEmail,
        undone: false,
        timestamp: deletedAt,
      };

      const { error: historyError } = await supabase
        .from('history_log')
        .insert([historyEntry]);
      if (historyError) {
        throw new Error(historyError.message);
      }

      await invalidateInventoryAndHistory();
    },
  });

  const memberCheckMutation = useMutation<
    MemberCheckItemResult,
    Error,
    MemberCheckItemInput
  >({
    mutationFn: async (input) => {
      if (!isSupabaseConfigured) {
        throw new Error('Supabase is not configured.');
      }
      if (role !== 'member' && role !== 'admin') {
        throw new Error('Only authenticated band members or admins can check items.');
      }

      const parsed = memberCheckSchema.parse(input);

      const { data, error } = await supabase.rpc('member_check_item', {
        p_item_id: parsed.itemId,
        p_condition: parsed.condition,
        p_remarks: parsed.remarks ?? null,
      });

      if (error) {
        throw new Error(error.message);
      }

      await invalidateInventoryAndHistory();
      return data;
    },
  });

  const { mutateAsync: runUpload } = uploadMutation;
  const { mutateAsync: runSave } = saveMutation;
  const { mutateAsync: runSoftDelete } = softDeleteMutation;
  const { mutateAsync: runMemberCheck } = memberCheckMutation;

  const uploadGearPhotos = useCallback(
    (files: readonly File[], existingCount = 0) =>
      runUpload({ files, existingCount }),
    [runUpload]
  );

  const saveItem = useCallback(
    (input: SaveItemInput) => runSave(input),
    [runSave]
  );

  const softDeleteItem = useCallback(
    (target: SoftDeleteTarget) => runSoftDelete(target),
    [runSoftDelete]
  );

  const memberCheckItem = useCallback(
    (input: MemberCheckItemInput) => runMemberCheck(input),
    [runMemberCheck]
  );

  return {
    saveItem,
    softDeleteItem,
    memberCheckItem,
    uploadGearPhotos,
    isSaving: saveMutation.isPending,
    isDeleting: softDeleteMutation.isPending,
    isChecking: memberCheckMutation.isPending,
    isUploading: uploadMutation.isPending,
  };
}
