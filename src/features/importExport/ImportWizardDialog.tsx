import { useCallback, useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  FileSpreadsheet,
  Loader2,
  Upload,
} from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useAuth } from '@/features/auth/useAuth';
import { getCategoryColor } from '@/features/categories/useCategories';
import { getEquipmentTypeColor } from '@/features/equipmentTypes/useEquipmentTypes';
import { CONDITION_META } from '@/features/inventory/inventoryUi';
import type { EnrichedInventoryItem } from '@/features/inventory/useInventory';
import { queryKeys } from '@/lib/queryKeys';
import { isSupabaseConfigured, supabase } from '@/lib/supabase';
import {
  cn,
  createHistoryId,
  deriveActorName,
  formatDisplayDate,
  isUniqueConstraintError,
  trimOrNull,
} from '@/lib/utils';
import type {
  Category,
  Database,
  EquipmentType,
  ImportHistoryPayload,
  InventoryItem,
  LoanRecord,
  LocationRecord,
} from '@/types/database';
import {
  mapCsvRowsByHeader,
  normalizeImportDueDate,
  parseCSV,
  parseJsonImportPayload,
  type ParsedImportItem,
} from './csvUtils';

export type ImportConflictMode = 'skip' | 'update' | 'duplicate';

export interface ImportWizardDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  items: readonly EnrichedInventoryItem[];
  categories: readonly Category[];
  locations: readonly LocationRecord[];
  equipmentTypes?: readonly EquipmentType[];
}

const EMPTY_EQUIPMENT_TYPES: EquipmentType[] = [];

type InventoryInsert = Database['public']['Tables']['inventory']['Insert'];
type InventoryUpdate = Database['public']['Tables']['inventory']['Update'];
type LoanInsert = Database['public']['Tables']['loans']['Insert'];
type HistoryInsert = Database['public']['Tables']['history_log']['Insert'];

interface QueuedLoanCandidate {
  itemId: string;
  itemName: string;
  qty: number;
  existingOnLoan: number;
  borrower: string;
  borrowerContact?: string | null;
  qtyLoaned: number;
  returnDate: string | null;
  notes?: string | null;
  checkedOutAt?: string | null;
  checkedOutBy?: string | null;
  sourceLoanId?: string;
  matchedActiveLoanIds?: ReadonlySet<string>;
  matchedActiveLoans?: readonly LoanRecord[];
  hasReturnDateField?: boolean;
}

const PREVIEW_ROW_LIMIT = 50;

async function readFileAsText(file: File): Promise<string> {
  if (typeof file.text === 'function') {
    return file.text();
  }

  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ''));
    reader.onerror = () => reject(new Error(`Unable to read "${file.name}".`));
    reader.readAsText(file);
  });
}

function buildImportPrevSnapshot(item: EnrichedInventoryItem): Partial<InventoryItem> {
  return {
    category: item.category,
    category_id: item.category_id,
    subcategory_id: item.subcategory_id,
    equipment_type_id: item.equipment_type_id ?? null,
    equipment_type: item.equipment_type ?? null,
    item: item.item,
    brand: item.brand,
    qty: item.qty,
    min_qty: item.min_qty ?? null,
    condition: item.condition,
    owner: item.owner,
    location: item.location,
    location_id: item.location_id,
    checkedBy: item.checkedBy ?? null,
    dateChecked: item.dateChecked,
    checked_at: item.checked_at,
    remarks: item.remarks,
    serial: item.serial,
    description: item.description,
    image_filename: item.image_filename,
    deleted_at: item.deleted_at ?? null,
  };
}

function findMatchingInventoryItem(
  row: ParsedImportItem,
  existingItems: readonly EnrichedInventoryItem[]
): EnrichedInventoryItem | undefined {
  const rowSerial = trimOrNull(row.serial)?.toLowerCase();
  if (rowSerial) {
    const serialMatch = existingItems.find(
      (item) => trimOrNull(item.serial)?.toLowerCase() === rowSerial
    );
    if (serialMatch) return serialMatch;
  }

  const rowName = row.item.trim().toLowerCase();
  return existingItems.find(
    (item) => item.item.trim().toLowerCase() === rowName
  );
}

function matchesExistingActiveLoan(
  borrowerName: string,
  returnDate: string | null,
  hasReturnDateField: boolean,
  activeLoans: readonly LoanRecord[]
): boolean {
  const openLoans = activeLoans.filter((loan) => loan.returned_at == null);
  if (openLoans.length === 0) return false;

  const normalizedBorrower = borrowerName.trim().toLowerCase();
  const normalizedCandidateDue = normalizeImportDueDate(returnDate).dueDate;

  const exactSingleMatch = openLoans.some((loan) => {
    if (loan.borrower_name.trim().toLowerCase() !== normalizedBorrower) return false;
    if (!hasReturnDateField) return true;
    const existingDue = trimOrNull(loan.due_date) ?? null;
    return existingDue === normalizedCandidateDue;
  });
  if (exactSingleMatch) return true;

  // Match the semicolon-joined summary produced by exportItemsToCSV().
  const joinedBorrowers = openLoans
    .map((loan) => loan.borrower_name.trim().toLowerCase())
    .join('; ');
  if (normalizedBorrower !== joinedBorrowers) return false;

  if (openLoans.length > 1 || !hasReturnDateField) return true;

  const joinedDueDates = openLoans
    .map((loan) => trimOrNull(loan.due_date))
    .filter((d): d is string => Boolean(d))
    .join('; ');
  const normalizedRawReturn = trimOrNull(returnDate) ?? '';
  return (
    normalizedRawReturn === joinedDueDates ||
    (trimOrNull(openLoans[0].due_date) ?? null) === normalizedCandidateDue
  );
}

const IMPORT_MODES: ReadonlyArray<{
  value: ImportConflictMode;
  label: string;
  description: string;
}> = [
  {
    value: 'skip',
    label: 'Skip existing matches',
    description: 'Insert only new items; leave matching serials or item names untouched.',
  },
  {
    value: 'update',
    label: 'Update existing matches',
    description: 'Overwrite matching items (undoable) and insert new items.',
  },
  {
    value: 'duplicate',
    label: 'Import all as new',
    description: 'Insert every row with a fresh item ID without matching existing gear.',
  },
];

/**
 * Admin-only CSV/JSON Import Wizard with header-mapped column resolution,
 * auto-created categories/locations, optional active `loans` backfill, and
 * `qty = 0` preservation.
 */
export function ImportWizardDialog({
  open,
  onOpenChange,
  items,
  categories,
  locations,
  equipmentTypes,
}: ImportWizardDialogProps) {
  const { role, user, profile } = useAuth();
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const resolvedEquipmentTypes =
    equipmentTypes ??
    queryClient.getQueryData<EquipmentType[]>(queryKeys.equipmentTypes) ??
    EMPTY_EQUIPMENT_TYPES;

  const [selectedFileName, setSelectedFileName] = useState<string | null>(null);
  const [parsedRows, setParsedRows] = useState<ParsedImportItem[]>([]);
  const [parseError, setParseError] = useState<string | null>(null);
  const [importMode, setImportMode] = useState<ImportConflictMode>('skip');
  const [isImporting, setIsImporting] = useState(false);

  const resetWizardState = useCallback(() => {
    setSelectedFileName(null);
    setParsedRows([]);
    setParseError(null);
    setImportMode('skip');
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  }, []);

  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen) {
      if (isImporting) return;
      resetWizardState();
    }
    onOpenChange(nextOpen);
  };

  const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setSelectedFileName(file.name);
    setParseError(null);

    try {
      const content = await readFileAsText(file);
      const isJson =
        file.name.trim().toLowerCase().endsWith('.json') ||
        file.type === 'application/json';

      const parsed = isJson
        ? parseJsonImportPayload(content, categories, resolvedEquipmentTypes)
        : mapCsvRowsByHeader(parseCSV(content));

      if (parsed.length === 0) {
        throw new Error('No valid equipment rows were found in this file.');
      }

      setParsedRows(parsed);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Unable to parse the selected import file.';
      setParsedRows([]);
      setParseError(message);
    }
  };

  const previewSummary = useMemo(() => {
    const existingTopCategories = new Set(
      categories
        .filter((cat) => cat.parent_id === null)
        .map((cat) => cat.name.trim().toLowerCase())
    );
    const existingLocationNames = new Set(
      locations.map((loc) => loc.name.trim().toLowerCase())
    );
    const existingEquipmentTypeNames = new Set(
      resolvedEquipmentTypes.map((et) => et.name.trim().toLowerCase())
    );

    const newCategoryNames = new Set<string>();
    const newLocationNames = new Set<string>();
    const newEquipmentTypeNames = new Set<string>();
    let matchedCount = 0;
    let loanEligibleCount = 0;
    let loanSkippedZeroQtyCount = 0;
    let existingLoansSkippedCount = 0;

    for (const row of parsedRows) {
      const catKey = row.category.trim().toLowerCase();
      if (catKey && !existingTopCategories.has(catKey)) {
        newCategoryNames.add(row.category.trim());
      }

      const locName = trimOrNull(row.location);
      if (locName && !existingLocationNames.has(locName.toLowerCase())) {
        newLocationNames.add(locName);
      }

      const typeName = trimOrNull(row.equipment_type);
      if (typeName && !existingEquipmentTypeNames.has(typeName.toLowerCase())) {
        newEquipmentTypeNames.add(typeName);
      }

      const matchedExisting =
        importMode === 'duplicate' ? undefined : findMatchingInventoryItem(row, items);
      if (matchedExisting) {
        matchedCount += 1;
      }

      if (matchedExisting && importMode === 'skip') {
        continue;
      }

      const rowQty =
        matchedExisting &&
        importMode === 'update' &&
        !row.providedFields.includes('qty')
          ? matchedExisting.qty
          : row.qty;

      const matchedActiveLoans =
        matchedExisting && importMode === 'update' ? (matchedExisting.activeLoans ?? []) : [];
      const matchedActiveLoanIds = new Set(matchedActiveLoans.map((loan) => loan.id));

      if (row.loans && row.loans.length > 0) {
        for (const loan of row.loans) {
          if (loan.id && matchedActiveLoanIds.has(loan.id)) {
            existingLoansSkippedCount += 1;
            continue;
          }
          if (rowQty >= loan.qty_loaned) {
            loanEligibleCount += 1;
          } else {
            loanSkippedZeroQtyCount += 1;
          }
        }
      } else {
        const borrowerName = trimOrNull(row.borrower);
        if (borrowerName) {
          if (
            matchedExisting &&
            importMode === 'update' &&
            matchesExistingActiveLoan(
              borrowerName,
              row.returnDate,
              row.providedFields.includes('returnDate'),
              matchedActiveLoans
            )
          ) {
            existingLoansSkippedCount += 1;
            continue;
          }
          if (rowQty >= 1) {
            loanEligibleCount += 1;
          } else {
            loanSkippedZeroQtyCount += 1;
          }
        }
      }
    }

    return {
      totalRows: parsedRows.length,
      matchedCount,
      newCategories: [...newCategoryNames],
      newLocations: [...newLocationNames],
      newEquipmentTypes: [...newEquipmentTypeNames],
      loanEligibleCount,
      loanSkippedZeroQtyCount,
      existingLoansSkippedCount,
    };
  }, [categories, importMode, items, locations, parsedRows, resolvedEquipmentTypes]);

  const handleStartImport = async () => {
    if (!isSupabaseConfigured) {
      setParseError('Supabase is not configured.');
      return;
    }
    if (role !== 'admin') {
      setParseError('Only administrators can import inventory items.');
      return;
    }
    if (parsedRows.length === 0) return;

    setIsImporting(true);
    setParseError(null);

    const committedInsertedIds: string[] = [];
    const committedUpdatedItems: ImportHistoryPayload['updatedItems'] = [];
    let anyDbWriteSucceeded = false;
    let historyLogged = false;
    const now = new Date();
    const nowIso = now.toISOString();
    const actorName = deriveActorName(profile, user);
    const actorEmail = user?.email ?? profile?.email ?? 'unknown';

    const invalidateAllCaches = async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.inventory(role) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.categories }),
        queryClient.invalidateQueries({ queryKey: queryKeys.locations }),
        queryClient.invalidateQueries({ queryKey: queryKeys.equipmentTypes }),
        queryClient.invalidateQueries({ queryKey: queryKeys.loans }),
        queryClient.invalidateQueries({ queryKey: queryKeys.history }),
      ]);
    };

    try {
      const workingCategories = [...categories];
      const workingLocations = [...locations];
      const workingEquipmentTypes = [...resolvedEquipmentTypes];

      const getNextCategoryOrder = (parentId: string | null) => {
        let maxOrder = 0;
        for (const cat of workingCategories) {
          if (cat.parent_id === parentId && cat.sort_order > maxOrder) {
            maxOrder = cat.sort_order;
          }
        }
        return maxOrder + 10;
      };

      const getNextLocationOrder = () => {
        let maxOrder = 0;
        for (const loc of workingLocations) {
          if (loc.sort_order > maxOrder) {
            maxOrder = loc.sort_order;
          }
        }
        return maxOrder + 10;
      };

      const getNextEquipmentTypeOrder = () => {
        let maxOrder = 0;
        for (const et of workingEquipmentTypes) {
          if (et.sort_order > maxOrder) {
            maxOrder = et.sort_order;
          }
        }
        return maxOrder + 10;
      };

      const ensureCategoryRecord = async (
        name: string,
        parent: Category | null
      ): Promise<Category> => {
        const trimmed = name.trim() || 'Others';
        const parentId = parent?.id ?? null;
        const findMatch = (list: readonly Category[]) =>
          list.find(
            (cat) =>
              cat.parent_id === parentId &&
              cat.name.trim().toLowerCase() === trimmed.toLowerCase()
          );

        const existing = findMatch(workingCategories);
        if (existing) return existing;

        const color = parent
          ? parent.color
          : getCategoryColor(trimmed, workingCategories);

        const { data, error } = await supabase
          .from('categories')
          .insert([
            {
              name: trimmed,
              parent_id: parentId,
              color,
              icon: parent?.icon ?? 'tag',
              sort_order: getNextCategoryOrder(parentId),
            },
          ])
          .select('*')
          .single();

        if (error) {
          if (isUniqueConstraintError(error)) {
            const { data: refreshed, error: refetchErr } = await supabase
              .from('categories')
              .select('*');
            if (!refetchErr && refreshed) {
              workingCategories.splice(0, workingCategories.length, ...refreshed);
              const concurrentMatch = findMatch(workingCategories);
              if (concurrentMatch) return concurrentMatch;
            }
          }
          throw new Error(`Failed to create category "${trimmed}": ${error.message}`);
        }

        anyDbWriteSucceeded = true;
        workingCategories.push(data);
        return data;
      };

      const ensureLocationRecord = async (
        name: string | null
      ): Promise<LocationRecord | null> => {
        const trimmed = trimOrNull(name);
        if (!trimmed) return null;

        const findMatch = (list: readonly LocationRecord[]) =>
          list.find((loc) => loc.name.trim().toLowerCase() === trimmed.toLowerCase());

        const existing = findMatch(workingLocations);
        if (existing) return existing;

        const { data, error } = await supabase
          .from('locations')
          .insert([
            {
              name: trimmed,
              description: null,
              sort_order: getNextLocationOrder(),
            },
          ])
          .select('*')
          .single();

        if (error) {
          if (isUniqueConstraintError(error)) {
            const { data: refreshed, error: refetchErr } = await supabase
              .from('locations')
              .select('*');
            if (!refetchErr && refreshed) {
              workingLocations.splice(0, workingLocations.length, ...refreshed);
              const concurrentMatch = findMatch(workingLocations);
              if (concurrentMatch) return concurrentMatch;
            }
          }
          throw new Error(`Failed to create location "${trimmed}": ${error.message}`);
        }

        anyDbWriteSucceeded = true;
        workingLocations.push(data);
        return data;
      };

      const ensureEquipmentTypeRecord = async (
        name: string | null
      ): Promise<EquipmentType | null> => {
        const trimmed = trimOrNull(name);
        if (!trimmed) return null;

        const findMatch = (list: readonly EquipmentType[]) =>
          list.find((et) => et.name.trim().toLowerCase() === trimmed.toLowerCase());

        const existing = findMatch(workingEquipmentTypes);
        if (existing) return existing;

        const color = getEquipmentTypeColor(trimmed, workingEquipmentTypes);
        const { data, error } = await supabase
          .from('equipment_types')
          .insert([
            {
              name: trimmed,
              color,
              icon: 'tag',
              sort_order: getNextEquipmentTypeOrder(),
            },
          ])
          .select('*')
          .single();

        if (error) {
          if (isUniqueConstraintError(error)) {
            const { data: refreshed, error: refetchErr } = await supabase
              .from('equipment_types')
              .select('*');
            if (!refetchErr && refreshed) {
              workingEquipmentTypes.splice(0, workingEquipmentTypes.length, ...refreshed);
              const concurrentMatch = findMatch(workingEquipmentTypes);
              if (concurrentMatch) return concurrentMatch;
            }
          }
          throw new Error(
            `Failed to create equipment type "${trimmed}": ${error.message}`
          );
        }

        anyDbWriteSucceeded = true;
        workingEquipmentTypes.push(data);
        return data;
      };

      const queueRowLoans = (
        row: ParsedImportItem,
        itemId: string,
        effectiveQty: number,
        existingOnLoan: number,
        matchedActiveLoanIds?: ReadonlySet<string>,
        matchedActiveLoans?: readonly LoanRecord[]
      ) => {
        const hasReturnDateField = row.providedFields.includes('returnDate');
        if (row.loans && row.loans.length > 0) {
          for (const loan of row.loans) {
            loanCandidates.push({
              itemId,
              itemName: row.item,
              qty: effectiveQty,
              existingOnLoan,
              borrower: loan.borrower_name,
              borrowerContact: loan.borrower_contact,
              qtyLoaned: loan.qty_loaned,
              returnDate: loan.due_date,
              notes: loan.notes,
              checkedOutAt: loan.checked_out_at,
              checkedOutBy: loan.checked_out_by,
              sourceLoanId: loan.id,
              matchedActiveLoanIds,
              matchedActiveLoans,
              hasReturnDateField: true,
            });
          }
          return;
        }

        const borrowerName = trimOrNull(row.borrower);
        if (borrowerName) {
          loanCandidates.push({
            itemId,
            itemName: row.item,
            qty: effectiveQty,
            existingOnLoan,
            borrower: borrowerName,
            qtyLoaned: 1,
            returnDate: row.returnDate,
            matchedActiveLoanIds,
            matchedActiveLoans,
            hasReturnDateField,
          });
        }
      };

      const insertedPayloads: InventoryInsert[] = [];
      const loanCandidates: QueuedLoanCandidate[] = [];
      let skippedExistingCount = 0;

      for (let index = 0; index < parsedRows.length; index++) {
        const row = parsedRows[index];
        const matched =
          importMode === 'duplicate'
            ? undefined
            : findMatchingInventoryItem(row, items);

        if (matched && importMode === 'skip') {
          skippedExistingCount += 1;
          continue;
        }

        const providedSet = new Set(row.providedFields);

        if (matched && importMode === 'update') {
          const prevSnapshot = buildImportPrevSnapshot(matched);
          const updatePayload: InventoryUpdate = {
            updated_at: nowIso,
          };

          if (providedSet.has('item')) {
            updatePayload.item = row.item;
          }

          let resolvedTopCategory: Category | null = null;
          if (providedSet.has('category')) {
            resolvedTopCategory = await ensureCategoryRecord(row.category, null);
            updatePayload.category = resolvedTopCategory.name;
            updatePayload.category_id = resolvedTopCategory.id;
          } else {
            resolvedTopCategory =
              (matched.category_id
                ? workingCategories.find((c) => c.id === matched.category_id)
                : undefined) ??
              workingCategories.find(
                (c) =>
                  c.parent_id === null &&
                  c.name.trim().toLowerCase() === matched.category.trim().toLowerCase()
              ) ??
              null;
          }

          if (providedSet.has('subcategory')) {
            if (row.subcategory && resolvedTopCategory) {
              const subCat = await ensureCategoryRecord(
                row.subcategory,
                resolvedTopCategory
              );
              updatePayload.subcategory_id = subCat.id;
            } else if (row.subcategory_id) {
              const existingSub = workingCategories.find(
                (c) => c.id === row.subcategory_id
              );
              updatePayload.subcategory_id = existingSub?.id ?? null;
            } else {
              updatePayload.subcategory_id = null;
            }
          }

          if (providedSet.has('location')) {
            const locationRecord = await ensureLocationRecord(row.location);
            updatePayload.location = locationRecord?.name ?? row.location ?? null;
            updatePayload.location_id = locationRecord?.id ?? null;
          }

          if (providedSet.has('equipment_type')) {
            if (row.equipment_type) {
              const typeRecord = await ensureEquipmentTypeRecord(row.equipment_type);
              updatePayload.equipment_type = typeRecord?.name ?? row.equipment_type;
              updatePayload.equipment_type_id = typeRecord?.id ?? null;
            } else if (row.equipment_type_id) {
              const existingType = workingEquipmentTypes.find(
                (et) => et.id === row.equipment_type_id
              );
              updatePayload.equipment_type = existingType?.name ?? null;
              updatePayload.equipment_type_id = existingType?.id ?? null;
            } else {
              updatePayload.equipment_type = null;
              updatePayload.equipment_type_id = null;
            }
          }

          if (providedSet.has('brand')) updatePayload.brand = row.brand;
          if (providedSet.has('qty')) updatePayload.qty = row.qty;
          if (providedSet.has('min_qty')) updatePayload.min_qty = row.min_qty;
          if (providedSet.has('condition')) updatePayload.condition = row.condition;
          if (providedSet.has('owner')) updatePayload.owner = row.owner;
          if (providedSet.has('remarks')) updatePayload.remarks = row.remarks;
          if (providedSet.has('serial')) updatePayload.serial = row.serial;
          if (providedSet.has('description')) updatePayload.description = row.description;
          if (providedSet.has('image_filename')) {
            updatePayload.image_filename = row.image_filename;
          }
          if (providedSet.has('dateChecked') && row.dateChecked) {
            updatePayload.dateChecked = row.dateChecked;
          }
          if (providedSet.has('checkedBy') && row.checkedBy) {
            updatePayload.checkedBy = row.checkedBy;
          }

          const { error: updateError } = await supabase
            .from('inventory')
            .update(updatePayload)
            .eq('id', matched.id);

          if (updateError) {
            throw new Error(`Failed to update "${row.item}": ${updateError.message}`);
          }

          anyDbWriteSucceeded = true;
          committedUpdatedItems.push({
            id: matched.id,
            prev_data: prevSnapshot,
          });

          const effectiveQty = providedSet.has('qty') ? row.qty : matched.qty;
          const matchedActiveLoans = matched.activeLoans ?? [];
          const activeLoanIds = new Set(
            matchedActiveLoans.map((loan) => loan.id)
          );
          queueRowLoans(
            row,
            matched.id,
            effectiveQty,
            matched.qty_on_loan,
            activeLoanIds,
            matchedActiveLoans
          );
        } else {
          const topCategory = await ensureCategoryRecord(row.category, null);
          let subCategory: Category | null = null;
          if (row.subcategory) {
            subCategory = await ensureCategoryRecord(row.subcategory, topCategory);
          } else if (row.subcategory_id) {
            subCategory =
              workingCategories.find((c) => c.id === row.subcategory_id) ?? null;
          }
          const locationRecord = await ensureLocationRecord(row.location);
          let equipmentTypeRecord: EquipmentType | null = null;
          if (row.equipment_type) {
            equipmentTypeRecord = await ensureEquipmentTypeRecord(row.equipment_type);
          } else if (row.equipment_type_id) {
            equipmentTypeRecord =
              workingEquipmentTypes.find((et) => et.id === row.equipment_type_id) ?? null;
          }

          const newId = `item_${Date.now()}_${index}_${Math.random().toString(36).slice(2, 6)}`;
          const insertPayload: InventoryInsert = {
            id: newId,
            item: row.item,
            category: topCategory.name,
            category_id: topCategory.id,
            subcategory_id: subCategory?.id ?? null,
            equipment_type: equipmentTypeRecord?.name ?? row.equipment_type ?? null,
            equipment_type_id: equipmentTypeRecord?.id ?? null,
            brand: row.brand,
            qty: row.qty,
            min_qty: row.min_qty,
            condition: row.condition,
            owner: row.owner,
            location: locationRecord?.name ?? row.location ?? null,
            location_id: locationRecord?.id ?? null,
            remarks: row.remarks,
            serial: row.serial,
            description: row.description,
            image_filename: row.image_filename,
            updated_at: nowIso,
            checkedBy: row.checkedBy ?? actorName,
            dateChecked: row.dateChecked ?? formatDisplayDate(now),
            checked_at: nowIso,
            deleted_at: null,
          };

          insertedPayloads.push(insertPayload);
          queueRowLoans(row, newId, row.qty, 0);
        }
      }

      if (insertedPayloads.length > 0) {
        const { error: insertError } = await supabase
          .from('inventory')
          .insert(insertedPayloads);

        if (insertError) {
          throw new Error(`Failed to insert imported items: ${insertError.message}`);
        }

        anyDbWriteSucceeded = true;
        committedInsertedIds.push(...insertedPayloads.map((entry) => entry.id));
      }

      const loanInserts: LoanInsert[] = [];
      const assignedLoanCountByItemId = new Map<string, number>();
      let skippedLoansCount = 0;
      let skippedExistingLoansCount = 0;

      for (const candidate of loanCandidates) {
        if (
          candidate.sourceLoanId &&
          candidate.matchedActiveLoanIds?.has(candidate.sourceLoanId)
        ) {
          skippedExistingLoansCount += 1;
          continue;
        }

        if (
          !candidate.sourceLoanId &&
          candidate.matchedActiveLoans &&
          matchesExistingActiveLoan(
            candidate.borrower,
            candidate.returnDate,
            candidate.hasReturnDateField ?? true,
            candidate.matchedActiveLoans
          )
        ) {
          skippedExistingLoansCount += 1;
          continue;
        }

        const alreadyAssigned = assignedLoanCountByItemId.get(candidate.itemId) ?? 0;
        const availableCapacity = candidate.qty - candidate.existingOnLoan - alreadyAssigned;
        if (
          candidate.qty < 1 ||
          candidate.qtyLoaned < 1 ||
          candidate.qtyLoaned > availableCapacity
        ) {
          skippedLoansCount += 1;
          continue;
        }

        const { dueDate, unparsedNote } = normalizeImportDueDate(candidate.returnDate);
        const combinedNotes = [trimOrNull(candidate.notes), unparsedNote]
          .filter((part): part is string => Boolean(part))
          .join(' · ');

        assignedLoanCountByItemId.set(
          candidate.itemId,
          alreadyAssigned + candidate.qtyLoaned
        );
        loanInserts.push({
          item_id: candidate.itemId,
          borrower_name: candidate.borrower,
          borrower_contact: candidate.borrowerContact ?? null,
          qty_loaned: candidate.qtyLoaned,
          checked_out_at: candidate.checkedOutAt ?? nowIso,
          due_date: dueDate,
          returned_at: null,
          checked_out_by: candidate.checkedOutBy ?? actorName,
          returned_by: null,
          notes: combinedNotes || null,
        });
      }

      if (loanInserts.length > 0) {
        const { error: loanError } = await supabase
          .from('loans')
          .insert(loanInserts);

        if (loanError) {
          throw new Error(`Items imported, but loan creation failed: ${loanError.message}`);
        }

        anyDbWriteSucceeded = true;
      }

      if (committedInsertedIds.length > 0 || committedUpdatedItems.length > 0) {
        const importPayload: ImportHistoryPayload = {
          insertedIds: committedInsertedIds,
          updatedItems: committedUpdatedItems,
        };

        const historyEntry: HistoryInsert = {
          id: createHistoryId(),
          action: 'import',
          item_id: 'batch_import',
          item_data: importPayload,
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

        historyLogged = true;
        anyDbWriteSucceeded = true;
      }

      await invalidateAllCaches();

      const parts = [
        `${committedInsertedIds.length} added`,
        `${committedUpdatedItems.length} updated`,
      ];
      if (skippedExistingCount > 0) {
        parts.push(`${skippedExistingCount} skipped`);
      }
      if (loanInserts.length > 0) {
        parts.push(`${loanInserts.length} ${loanInserts.length === 1 ? 'loan' : 'loans'} created`);
      }
      if (skippedExistingLoansCount > 0) {
        parts.push(
          `${skippedExistingLoansCount} existing ${skippedExistingLoansCount === 1 ? 'loan' : 'loans'} skipped`
        );
      }
      if (skippedLoansCount > 0) {
        parts.push(`${skippedLoansCount} ${skippedLoansCount === 1 ? 'loan' : 'loans'} skipped (qty 0 / no capacity)`);
      }

      toast.success(`Import complete: ${parts.join(', ')}.`);
      resetWizardState();
      onOpenChange(false);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Unable to complete import.';

      if (
        !historyLogged &&
        (committedInsertedIds.length > 0 || committedUpdatedItems.length > 0)
      ) {
        try {
          const partialHistoryEntry: HistoryInsert = {
            id: createHistoryId(),
            action: 'import',
            item_id: 'batch_import',
            item_data: {
              insertedIds: committedInsertedIds,
              updatedItems: committedUpdatedItems,
            } satisfies ImportHistoryPayload,
            prev_data: null,
            user_email: actorEmail,
            undone: false,
            timestamp: nowIso,
          };
          const { error: fallbackHistoryErr } = await supabase
            .from('history_log')
            .insert([partialHistoryEntry]);
          if (!fallbackHistoryErr) {
            historyLogged = true;
            anyDbWriteSucceeded = true;
          }
        } catch {
          // Preserve the primary import error if fallback logging also fails.
        }
      }

      if (anyDbWriteSucceeded) {
        try {
          await invalidateAllCaches();
        } catch {
          // Preserve the primary import error.
        }
      }

      setParseError(message);
    } finally {
      setIsImporting(false);
    }
  };

  const previewSlice = parsedRows.slice(0, PREVIEW_ROW_LIMIT);

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileSpreadsheet className="size-5 text-primary" aria-hidden="true" />
            <span>Import Equipment Data</span>
          </DialogTitle>
          <DialogDescription>
            Upload a CSV spreadsheet or JSON backup. CSV columns are matched by header name in any
            order (requires an <span className="font-mono font-semibold text-foreground">Item</span> or{' '}
            <span className="font-mono font-semibold text-foreground">Equipment</span> column;
            optional <span className="font-mono">Borrower</span> &amp;{' '}
            <span className="font-mono">Return Date</span> create active loans when Qty &ge; 1).
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5">
          {/* File Picker */}
          <div className="space-y-2 rounded-xl border border-dashed border-border bg-secondary/40 p-4">
            <Label htmlFor="import-wizard-file">Select CSV or JSON file</Label>
            <Input
              ref={fileInputRef}
              id="import-wizard-file"
              type="file"
              accept=".csv,.json,text/csv,application/json"
              disabled={isImporting}
              onChange={(event) => void handleFileChange(event)}
              className="cursor-pointer bg-card file:mr-3 file:rounded-md file:border-0 file:bg-primary/10 file:px-3 file:py-1 file:font-mono file:text-xs file:font-semibold file:text-primary"
            />
            {selectedFileName && !parseError && (
              <p className="flex items-center gap-1.5 font-mono text-xs text-muted-foreground">
                <CheckCircle2 className="size-3.5 text-success" aria-hidden="true" />
                <span>Loaded {selectedFileName}</span>
              </p>
            )}
          </div>

          {/* Inline Error Banner */}
          {parseError && (
            <div
              role="alert"
              className="flex items-start gap-2.5 rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive"
            >
              <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
              <span>{parseError}</span>
            </div>
          )}

          {/* Parsed Summary, Conflict Mode & Preview */}
          {parsedRows.length > 0 && (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="secondary">
                  {previewSummary.totalRows}{' '}
                  {previewSummary.totalRows === 1 ? 'row' : 'rows'} parsed
                </Badge>
                {previewSummary.matchedCount > 0 && (
                  <Badge variant="outline">
                    {previewSummary.matchedCount} existing{' '}
                    {previewSummary.matchedCount === 1 ? 'match' : 'matches'}
                  </Badge>
                )}
                {previewSummary.newCategories.length > 0 && (
                  <Badge variant="outline">
                    +{previewSummary.newCategories.length} new{' '}
                    {previewSummary.newCategories.length === 1 ? 'category' : 'categories'}
                  </Badge>
                )}
                {previewSummary.newLocations.length > 0 && (
                  <Badge variant="outline">
                    +{previewSummary.newLocations.length} new{' '}
                    {previewSummary.newLocations.length === 1 ? 'location' : 'locations'}
                  </Badge>
                )}
                {previewSummary.newEquipmentTypes.length > 0 && (
                  <Badge variant="outline">
                    +{previewSummary.newEquipmentTypes.length} new{' '}
                    {previewSummary.newEquipmentTypes.length === 1
                      ? 'equipment type'
                      : 'equipment types'}
                  </Badge>
                )}
                {previewSummary.loanEligibleCount > 0 && (
                  <Badge variant="loaned">
                    {previewSummary.loanEligibleCount} active{' '}
                    {previewSummary.loanEligibleCount === 1 ? 'loan' : 'loans'} to create
                  </Badge>
                )}
                {previewSummary.existingLoansSkippedCount > 0 && (
                  <Badge variant="outline">
                    {previewSummary.existingLoansSkippedCount} existing{' '}
                    {previewSummary.existingLoansSkippedCount === 1 ? 'loan' : 'loans'} preserved
                  </Badge>
                )}
              </div>

              {previewSummary.loanSkippedZeroQtyCount > 0 && (
                <div className="flex items-start gap-2.5 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-xs text-foreground">
                  <AlertTriangle
                    className="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-400"
                    aria-hidden="true"
                  />
                  <span>
                    {previewSummary.loanSkippedZeroQtyCount}{' '}
                    {previewSummary.loanSkippedZeroQtyCount === 1 ? 'row includes' : 'rows include'}{' '}
                    a Borrower with <span className="font-mono font-semibold">Qty = 0</span>. The
                    equipment row will be imported with <span className="font-mono">qty: 0</span>,
                    and the active loan record will be skipped so loan capacity constraints remain
                    valid.
                  </span>
                </div>
              )}

              {/* Duplicate Handling Mode */}
              <div className="space-y-2">
                <p className="font-mono text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Duplicate Handling Mode
                </p>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                  {IMPORT_MODES.map((mode) => {
                    const selected = importMode === mode.value;
                    return (
                      <label
                        key={mode.value}
                        className={cn(
                          'flex cursor-pointer flex-col gap-1 rounded-lg border p-3 text-xs transition-colors',
                          selected
                            ? 'border-primary bg-primary/8 text-foreground'
                            : 'border-border bg-card text-muted-foreground hover:bg-accent/50'
                        )}
                      >
                        <span className="flex items-center gap-2 font-semibold text-foreground">
                          <input
                            type="radio"
                            name="importMode"
                            value={mode.value}
                            checked={selected}
                            disabled={isImporting}
                            onChange={() => setImportMode(mode.value)}
                            className="accent-primary"
                          />
                          <span>{mode.label}</span>
                        </span>
                        <span className="pl-5 text-[11px] leading-snug text-muted-foreground">
                          {mode.description}
                        </span>
                      </label>
                    );
                  })}
                </div>
              </div>

              {/* Preview Table */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <span className="font-mono text-[11px] font-semibold uppercase tracking-wider">
                    Preview
                  </span>
                  {parsedRows.length > PREVIEW_ROW_LIMIT && (
                    <span className="font-mono text-[11px]">
                      Showing first {PREVIEW_ROW_LIMIT} of {parsedRows.length} rows
                    </span>
                  )}
                </div>

                <div className="max-h-60 overflow-auto rounded-lg border border-border">
                  <Table>
                    <TableHeader>
                      <TableRow className="hover:bg-transparent">
                        <TableHead>Equipment</TableHead>
                        <TableHead>Category</TableHead>
                        <TableHead>Qty</TableHead>
                        <TableHead>Condition</TableHead>
                        <TableHead>Location</TableHead>
                        <TableHead>Borrower</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {previewSlice.map((row, idx) => {
                        const condMeta = CONDITION_META[row.condition];
                        const hasBorrower = Boolean(trimOrNull(row.borrower));
                        const skippedZeroLoan = hasBorrower && row.qty === 0;

                        return (
                          <TableRow key={`${row.item}-${idx}`}>
                            <TableCell className="font-medium text-foreground">
                              {row.item}
                              {row.serial && (
                                <span className="block font-mono text-[10px] text-muted-foreground">
                                  SN: {row.serial}
                                </span>
                              )}
                            </TableCell>
                            <TableCell className="text-xs">
                              {row.category}
                              {row.subcategory && (
                                <span className="block font-mono text-[10px] text-muted-foreground">
                                  {row.subcategory}
                                </span>
                              )}
                              {row.equipment_type && (
                                <span className="block font-mono text-[10px] text-primary">
                                  {row.equipment_type}
                                </span>
                              )}
                            </TableCell>
                            <TableCell className="font-mono text-xs font-semibold">
                              {row.qty}
                              {row.min_qty !== null && (
                                <span className="block text-[10px] font-normal text-muted-foreground">
                                  Min: {row.min_qty}
                                </span>
                              )}
                            </TableCell>
                            <TableCell>
                              <Badge variant={condMeta.badgeVariant}>
                                {condMeta.label}
                              </Badge>
                            </TableCell>
                            <TableCell className="text-xs text-muted-foreground">
                              {row.location ?? '—'}
                            </TableCell>
                            <TableCell className="text-xs">
                              {hasBorrower ? (
                                <div className="space-y-0.5">
                                  <span className="font-medium text-foreground">
                                    {row.borrower}
                                  </span>
                                  {row.returnDate && (
                                    <span className="block font-mono text-[10px] text-muted-foreground">
                                      Due: {row.returnDate}
                                    </span>
                                  )}
                                  {skippedZeroLoan && (
                                    <Badge variant="outline" className="text-[9px]">
                                      Loan skipped (Qty 0)
                                    </Badge>
                                  )}
                                </div>
                              ) : (
                                <span className="text-muted-foreground">—</span>
                              )}
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
              </div>
            </>
          )}
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            disabled={isImporting}
            onClick={() => handleOpenChange(false)}
          >
            Cancel
          </Button>
          <Button
            type="button"
            disabled={isImporting || parsedRows.length === 0}
            onClick={() => void handleStartImport()}
          >
            {isImporting ? (
              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            ) : (
              <Upload className="size-4" aria-hidden="true" />
            )}
            <span>
              {isImporting
                ? 'Importing...'
                : `Start Import (${parsedRows.length})`}
            </span>
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
