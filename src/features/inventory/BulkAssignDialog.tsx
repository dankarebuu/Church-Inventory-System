import { useEffect, useMemo, useRef, useState } from 'react';
import { AlertCircle, Layers, Loader2, WifiOff } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { sortCategories } from '@/features/categories/useCategories';
import { sortEquipmentTypes } from '@/features/equipmentTypes/useEquipmentTypes';
import { sortLocations } from '@/features/locations/useLocations';
import type { Category, EquipmentType, LocationRecord } from '@/types/database';
import { type BulkUpdateItemsInput, useItemMutations } from './useInventory';

export interface BulkAssignDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  selectedIds: readonly string[];
  categories: readonly Category[];
  locations: readonly LocationRecord[];
  equipmentTypes?: readonly EquipmentType[];
  onSuccess?: () => void;
  isOffline?: boolean;
}

const UNCHANGED_OPTION = '__unchanged__';
const CLEAR_OPTION = '__clear__';
const NONE_OPTION = '__none__';
const EMPTY_EQUIPMENT_TYPES: EquipmentType[] = [];

/**
 * Admin-only modal for bulk-assigning Rig Category (with optional Subcategory),
 * Equipment Type, and/or Storage Location across multiple selected items.
 */
export function BulkAssignDialog({
  open,
  onOpenChange,
  selectedIds,
  categories,
  locations,
  equipmentTypes = EMPTY_EQUIPMENT_TYPES,
  onSuccess,
  isOffline = false,
}: BulkAssignDialogProps) {
  const { bulkUpdateItems, isBulkUpdating } = useItemMutations();

  const [categoryChoice, setCategoryChoice] = useState(UNCHANGED_OPTION);
  const [subcategoryChoice, setSubcategoryChoice] = useState(UNCHANGED_OPTION);
  const [equipmentTypeChoice, setEquipmentTypeChoice] = useState(UNCHANGED_OPTION);
  const [locationChoice, setLocationChoice] = useState(UNCHANGED_OPTION);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const wasOpenRef = useRef(false);

  useEffect(() => {
    if (!open) {
      wasOpenRef.current = false;
      setSubmitError(null);
      return;
    }

    if (wasOpenRef.current) return;
    wasOpenRef.current = true;
    setCategoryChoice(UNCHANGED_OPTION);
    setSubcategoryChoice(UNCHANGED_OPTION);
    setEquipmentTypeChoice(UNCHANGED_OPTION);
    setLocationChoice(UNCHANGED_OPTION);
    setSubmitError(null);
  }, [open]);

  const topCategories = useMemo(
    () => sortCategories(categories.filter((cat) => cat.parent_id === null)),
    [categories]
  );

  const subcategories = useMemo(() => {
    if (categoryChoice === UNCHANGED_OPTION) return [];
    return sortCategories(categories.filter((cat) => cat.parent_id === categoryChoice));
  }, [categories, categoryChoice]);

  const sortedEquipmentTypes = useMemo(
    () => sortEquipmentTypes(equipmentTypes),
    [equipmentTypes]
  );
  const sortedLocations = useMemo(() => sortLocations(locations), [locations]);

  const hasAnyChange =
    categoryChoice !== UNCHANGED_OPTION ||
    equipmentTypeChoice !== UNCHANGED_OPTION ||
    locationChoice !== UNCHANGED_OPTION;

  const handleCategoryChange = (nextVal: string) => {
    setCategoryChoice(nextVal);
    setSubcategoryChoice(UNCHANGED_OPTION);
    if (submitError) setSubmitError(null);
  };

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (isOffline || isBulkUpdating) return;

    if (selectedIds.length === 0) {
      setSubmitError('Select at least one inventory item to update.');
      return;
    }

    if (!hasAnyChange) {
      setSubmitError('Choose at least one field to update.');
      return;
    }

    setSubmitError(null);

    const payload: BulkUpdateItemsInput = {
      itemIds: selectedIds,
    };

    if (categoryChoice !== UNCHANGED_OPTION) {
      const matchedCat = topCategories.find((cat) => cat.id === categoryChoice);
      payload.category_id = matchedCat ? matchedCat.id : categoryChoice;
      payload.category = matchedCat ? matchedCat.name : undefined;

      if (subcategoryChoice === NONE_OPTION) {
        payload.subcategory_id = null;
      } else if (subcategoryChoice !== UNCHANGED_OPTION) {
        payload.subcategory_id = subcategoryChoice;
      }
    }

    if (equipmentTypeChoice === CLEAR_OPTION) {
      payload.equipment_type_id = null;
      payload.equipment_type = null;
    } else if (equipmentTypeChoice !== UNCHANGED_OPTION) {
      const matchedType = sortedEquipmentTypes.find((et) => et.id === equipmentTypeChoice);
      payload.equipment_type_id = matchedType ? matchedType.id : equipmentTypeChoice;
      payload.equipment_type = matchedType ? matchedType.name : null;
    }

    if (locationChoice === CLEAR_OPTION) {
      payload.location_id = null;
      payload.location = null;
    } else if (locationChoice !== UNCHANGED_OPTION) {
      const matchedLoc = sortedLocations.find((loc) => loc.id === locationChoice);
      payload.location_id = matchedLoc ? matchedLoc.id : locationChoice;
      payload.location = matchedLoc ? matchedLoc.name : null;
    }

    try {
      const result = await bulkUpdateItems(payload);
      if (result.updatedCount > 0) {
        const skippedNote =
          result.skippedCount > 0 ? ` (${result.skippedCount} already matched)` : '';
        toast.success(
          `Updated ${result.updatedCount} ${result.updatedCount === 1 ? 'item' : 'items'}${skippedNote}.`
        );
      } else {
        toast.success('Selected items already match the chosen assignments.');
      }
      onSuccess?.();
      onOpenChange(false);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Unable to apply bulk updates.';
      setSubmitError(message);
      toast.error(message);
    }
  };

  const selectedLabel = `${selectedIds.length} ${selectedIds.length === 1 ? 'item' : 'items'} selected`;

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => !isBulkUpdating && onOpenChange(nextOpen)}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-primary/30 bg-primary/10 px-2.5 py-0.5 font-sans text-xs font-semibold tabular-nums text-primary">
              <Layers className="size-3" aria-hidden="true" />
              <span>{selectedLabel}</span>
            </span>
          </div>
          <DialogTitle className="mt-1">Bulk Assign Equipment</DialogTitle>
          <DialogDescription>
            Update Rig Category, Equipment Type, or Storage Location across all checked items.
            Fields left as &ldquo;Leave unchanged&rdquo; keep their current values.
          </DialogDescription>
        </DialogHeader>

        {isOffline && (
          <div
            role="status"
            className="flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50/80 px-3 py-2 text-xs text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200"
          >
            <WifiOff className="size-3.5 shrink-0" aria-hidden="true" />
            <span>You are offline. Bulk updates cannot be applied until connection returns.</span>
          </div>
        )}

        {submitError && (
          <div
            role="alert"
            className="flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive"
          >
            <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            <span>{submitError}</span>
          </div>
        )}

        <form onSubmit={(e) => void handleSubmit(e)} className="grid gap-4" noValidate>
          <div className="grid gap-1.5">
            <Label htmlFor="bulk-category-select">Rig Category</Label>
            <Select
              value={categoryChoice}
              onValueChange={handleCategoryChange}
              disabled={isBulkUpdating}
            >
              <SelectTrigger id="bulk-category-select" aria-label="Rig Category">
                <SelectValue placeholder="Leave unchanged" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={UNCHANGED_OPTION}>Leave unchanged</SelectItem>
                {topCategories.map((cat) => (
                  <SelectItem key={cat.id} value={cat.id}>
                    {cat.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="bulk-subcategory-select">Subcategory (Optional)</Label>
            <Select
              value={subcategoryChoice}
              onValueChange={(nextVal) => {
                setSubcategoryChoice(nextVal);
                if (submitError) setSubmitError(null);
              }}
              disabled={
                isBulkUpdating ||
                categoryChoice === UNCHANGED_OPTION ||
                subcategories.length === 0
              }
            >
              <SelectTrigger id="bulk-subcategory-select" aria-label="Subcategory">
                <SelectValue
                  placeholder={
                    categoryChoice === UNCHANGED_OPTION
                      ? 'Select a rig category first'
                      : subcategories.length === 0
                        ? 'No subcategories'
                        : 'Leave unchanged'
                  }
                />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={UNCHANGED_OPTION}>Leave unchanged</SelectItem>
                <SelectItem value={NONE_OPTION}>None / General</SelectItem>
                {subcategories.map((sub) => (
                  <SelectItem key={sub.id} value={sub.id}>
                    {sub.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="bulk-equipment-type-select">Equipment Type</Label>
            <Select
              value={equipmentTypeChoice}
              onValueChange={(nextVal) => {
                setEquipmentTypeChoice(nextVal);
                if (submitError) setSubmitError(null);
              }}
              disabled={isBulkUpdating}
            >
              <SelectTrigger id="bulk-equipment-type-select" aria-label="Equipment Type">
                <SelectValue placeholder="Leave unchanged" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={UNCHANGED_OPTION}>Leave unchanged</SelectItem>
                <SelectItem value={CLEAR_OPTION}>Clear / Unassigned</SelectItem>
                {sortedEquipmentTypes.map((et) => (
                  <SelectItem key={et.id} value={et.id}>
                    {et.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="bulk-location-select">Storage Location</Label>
            <Select
              value={locationChoice}
              onValueChange={(nextVal) => {
                setLocationChoice(nextVal);
                if (submitError) setSubmitError(null);
              }}
              disabled={isBulkUpdating}
            >
              <SelectTrigger id="bulk-location-select" aria-label="Storage Location">
                <SelectValue placeholder="Leave unchanged" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={UNCHANGED_OPTION}>Leave unchanged</SelectItem>
                <SelectItem value={CLEAR_OPTION}>Clear / Unassigned</SelectItem>
                {sortedLocations.map((loc) => (
                  <SelectItem key={loc.id} value={loc.id}>
                    {loc.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <DialogFooter className="pt-2">
            <Button
              type="button"
              variant="outline"
              disabled={isBulkUpdating}
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={
                !hasAnyChange ||
                selectedIds.length === 0 ||
                isBulkUpdating ||
                isOffline
              }
            >
              {isBulkUpdating && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}
              <span>{isBulkUpdating ? 'Applying...' : 'Apply Changes'}</span>
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
