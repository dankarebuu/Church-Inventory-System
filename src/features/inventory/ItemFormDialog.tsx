import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { AlertCircle, ImagePlus, Loader2, X } from 'lucide-react';
import { Controller, useForm } from 'react-hook-form';
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
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { sortCategories } from '@/features/categories/useCategories';
import { sortLocations } from '@/features/locations/useLocations';
import { parseImages } from '@/lib/utils';
import type { Category, LocationRecord } from '@/types/database';
import {
  itemFormSchema,
  MAX_GEAR_PHOTOS,
  validatePhotoFiles,
  type ItemFormInput,
  type ItemFormValues,
} from './schemas';
import {
  useItemMutations,
  type EnrichedInventoryItem,
  type SaveItemInput,
} from './useInventory';

export interface ItemFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  item?: EnrichedInventoryItem | null;
  categories: readonly Category[];
  locations: readonly LocationRecord[];
  onSave?: (input: SaveItemInput) => Promise<unknown>;
  isSaving?: boolean;
}

interface PendingPhoto {
  id: string;
  file: File;
  previewUrl: string;
}

const NONE_OPTION = '__none__';

function buildDefaultFormValues(
  item: EnrichedInventoryItem | null | undefined,
  topCategories: readonly Category[],
  sortedLocations: readonly LocationRecord[]
): ItemFormInput {
  if (!item) {
    return {
      item: '',
      category: '',
      category_id: null,
      subcategory_id: null,
      brand: '',
      qty: 1,
      condition: 'working',
      owner: 'Church Property',
      location: '',
      location_id: null,
      serial: '',
      description: '',
      remarks: '',
    };
  }

  const matchedCat =
    (item.category_id ? topCategories.find((c) => c.id === item.category_id) : undefined) ??
    topCategories.find(
      (c) => c.name.trim().toLowerCase() === (item.category ?? '').trim().toLowerCase()
    );

  const matchedLoc =
    (item.location_id ? sortedLocations.find((l) => l.id === item.location_id) : undefined) ??
    sortedLocations.find(
      (l) => l.name.trim().toLowerCase() === (item.location ?? '').trim().toLowerCase()
    );

  return {
    item: item.item,
    category: matchedCat?.name ?? item.category ?? '',
    category_id: matchedCat?.id ?? item.category_id ?? null,
    subcategory_id: item.subcategory_id ?? null,
    brand: item.brand ?? '',
    qty: item.qty ?? 0,
    condition: item.condition,
    owner: item.owner ?? '',
    location: matchedLoc?.name ?? item.location ?? '',
    location_id: matchedLoc?.id ?? item.location_id ?? null,
    serial: item.serial ?? '',
    description: item.description ?? '',
    remarks: item.remarks ?? '',
  };
}

/**
 * Admin Add/Edit equipment modal using React Hook Form + Zod v4, cascading
 * Category -> Subcategory + Location selectors with text-column sync, zero-safe
 * quantity inputs, and strict `URL.revokeObjectURL` lifecycle cleanup.
 */
export function ItemFormDialog({
  open,
  onOpenChange,
  item = null,
  categories,
  locations,
  onSave,
  isSaving: externalIsSaving,
}: ItemFormDialogProps) {
  const { saveItem: hookSaveItem, isSaving: hookIsSaving } = useItemMutations();
  const isSubmittingSave = externalIsSaving ?? hookIsSaving;

  const topCategories = useMemo(
    () => sortCategories(categories.filter((cat) => cat.parent_id === null)),
    [categories]
  );
  const sortedLocations = useMemo(() => sortLocations(locations), [locations]);

  const [existingPhotos, setExistingPhotos] = useState<string[]>([]);
  const [pendingPhotos, setPendingPhotos] = useState<PendingPhoto[]>([]);
  const [photoError, setPhotoError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const activeObjectUrlsRef = useRef<Set<string>>(new Set());

  const revokeObjectUrl = useCallback((url: string) => {
    if (activeObjectUrlsRef.current.has(url)) {
      activeObjectUrlsRef.current.delete(url);
      URL.revokeObjectURL(url);
    }
  }, []);

  const revokeAllObjectUrls = useCallback(() => {
    for (const url of activeObjectUrlsRef.current) {
      URL.revokeObjectURL(url);
    }
    activeObjectUrlsRef.current.clear();
  }, []);

  const {
    register,
    control,
    handleSubmit,
    reset,
    watch,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<ItemFormInput, unknown, ItemFormValues>({
    resolver: zodResolver(itemFormSchema),
    defaultValues: buildDefaultFormValues(item, topCategories, sortedLocations),
  });

  const selectedCategoryId = watch('category_id');
  const selectedCategoryText = watch('category');

  const subcategories = useMemo(() => {
    if (!selectedCategoryId) return [];
    return sortCategories(categories.filter((cat) => cat.parent_id === selectedCategoryId));
  }, [categories, selectedCategoryId]);

  useEffect(() => {
    if (open) {
      revokeAllObjectUrls();
      setPendingPhotos([]);
      setExistingPhotos(parseImages(item?.image_filename));
      setPhotoError(null);
      setSubmitError(null);
      reset(buildDefaultFormValues(item, topCategories, sortedLocations));
    } else {
      revokeAllObjectUrls();
      setPendingPhotos([]);
      setPhotoError(null);
      setSubmitError(null);
    }
  }, [open, item, topCategories, sortedLocations, reset, revokeAllObjectUrls]);

  useEffect(() => {
    return () => {
      revokeAllObjectUrls();
    };
  }, [revokeAllObjectUrls]);

  const handleCategoryChange = (nextVal: string) => {
    if (nextVal === NONE_OPTION) {
      setValue('category_id', null, { shouldValidate: true, shouldDirty: true });
      setValue('category', '', { shouldValidate: true, shouldDirty: true });
      setValue('subcategory_id', null, { shouldDirty: true });
      return;
    }

    const matched = topCategories.find((cat) => cat.id === nextVal);
    setValue('category_id', matched ? matched.id : null, {
      shouldValidate: true,
      shouldDirty: true,
    });
    setValue('category', matched ? matched.name : '', {
      shouldValidate: true,
      shouldDirty: true,
    });

    const currentSubId = watch('subcategory_id');
    const subStillValid = categories.some(
      (cat) => cat.id === currentSubId && cat.parent_id === nextVal
    );
    if (!subStillValid) {
      setValue('subcategory_id', null, { shouldDirty: true });
    }
  };

  const handleLocationChange = (nextVal: string) => {
    if (nextVal === NONE_OPTION) {
      setValue('location_id', null, { shouldDirty: true });
      setValue('location', '', { shouldDirty: true });
      return;
    }

    const matched = sortedLocations.find((loc) => loc.id === nextVal);
    setValue('location_id', matched ? matched.id : null, { shouldDirty: true });
    setValue('location', matched ? matched.name : '', { shouldDirty: true });
  };

  const handleFilesSelected = (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []);
    event.target.value = '';
    if (files.length === 0) return;

    const currentCount = existingPhotos.length + pendingPhotos.length;
    const validation = validatePhotoFiles(files, currentCount);
    if (!validation.valid) {
      setPhotoError(validation.error);
      toast.error(validation.error ?? 'Invalid photo selection.');
      return;
    }

    setPhotoError(null);
    const additions: PendingPhoto[] = files.map((file, idx) => {
      const previewUrl = URL.createObjectURL(file);
      activeObjectUrlsRef.current.add(previewUrl);
      return {
        id: `pending-${Date.now()}-${idx}-${Math.random().toString(36).slice(2, 7)}`,
        file,
        previewUrl,
      };
    });

    setPendingPhotos((prev) => [...prev, ...additions]);
  };

  const handleRemovePendingPhoto = (id: string) => {
    setPendingPhotos((prev) => {
      const target = prev.find((photo) => photo.id === id);
      if (target) {
        revokeObjectUrl(target.previewUrl);
      }
      return prev.filter((photo) => photo.id !== id);
    });
    setPhotoError(null);
  };

  const handleRemoveExistingPhoto = (index: number) => {
    setExistingPhotos((prev) => prev.filter((_, idx) => idx !== index));
    setPhotoError(null);
  };

  const onValidSubmit = async (values: ItemFormValues) => {
    setSubmitError(null);

    const matchedCat = values.category_id
      ? topCategories.find((cat) => cat.id === values.category_id)
      : undefined;
    const matchedLoc = values.location_id
      ? sortedLocations.find((loc) => loc.id === values.location_id)
      : undefined;

    const syncedValues: ItemFormValues = {
      ...values,
      category: matchedCat ? matchedCat.name : values.category,
      location: matchedLoc ? matchedLoc.name : values.location,
    };

    try {
      const saveFn = onSave ?? hookSaveItem;
      await saveFn({
        values: syncedValues,
        existingItem: item,
        existingPhotos,
        newPhotoFiles: pendingPhotos.map((p) => p.file),
      });

      toast.success(item ? `Updated "${syncedValues.item}"` : `Added "${syncedValues.item}"`);
      revokeAllObjectUrls();
      setPendingPhotos([]);
      onOpenChange(false);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Unable to save equipment item.';
      setSubmitError(message);
      toast.error(message);
    }
  };

  const totalPhotoCount = existingPhotos.length + pendingPhotos.length;
  const busy = isSubmitting || isSubmittingSave;

  const handleDialogOpenChange = (nextOpen: boolean) => {
    if (!nextOpen) {
      revokeAllObjectUrls();
      setPendingPhotos([]);
      setPhotoError(null);
      setSubmitError(null);
    }
    onOpenChange(nextOpen);
  };

  return (
    <Dialog open={open} onOpenChange={handleDialogOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{item ? 'Edit Equipment Item' : 'Add Equipment Item'}</DialogTitle>
          <DialogDescription>
            {item
              ? 'Update gear specifications, storage location, condition, or photos.'
              : 'Log a new equipment item into the WINGMACC band inventory.'}
          </DialogDescription>
        </DialogHeader>

        {submitError && (
          <div
            role="alert"
            className="flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive"
          >
            <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            <span>{submitError}</span>
          </div>
        )}

        <form onSubmit={(e) => void handleSubmit(onValidSubmit)(e)} className="grid gap-4" noValidate>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="grid gap-1.5 sm:col-span-2">
              <Label htmlFor="item-name-input">Item Name *</Label>
              <Input
                id="item-name-input"
                placeholder="e.g. Shure SM58 Dynamic Mic"
                {...register('item')}
              />
              {errors.item && (
                <p className="text-xs text-destructive">{errors.item.message}</p>
              )}
            </div>

            <div className="grid gap-1.5">
              <Label htmlFor="item-category-select">Category *</Label>
              <Controller
                control={control}
                name="category_id"
                render={({ field }) => (
                  <Select
                    value={field.value ?? NONE_OPTION}
                    onValueChange={handleCategoryChange}
                  >
                    <SelectTrigger id="item-category-select" aria-label="Category">
                      <SelectValue placeholder="Select category" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NONE_OPTION}>
                        {selectedCategoryText && !field.value
                          ? `Legacy: ${selectedCategoryText}`
                          : 'Select category...'}
                      </SelectItem>
                      {topCategories.map((cat) => (
                        <SelectItem key={cat.id} value={cat.id}>
                          {cat.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
              {errors.category && (
                <p className="text-xs text-destructive">{errors.category.message}</p>
              )}
            </div>

            <div className="grid gap-1.5">
              <Label htmlFor="item-subcategory-select">Subcategory (Optional)</Label>
              <Controller
                control={control}
                name="subcategory_id"
                render={({ field }) => (
                  <Select
                    value={field.value ?? NONE_OPTION}
                    onValueChange={(val) =>
                      field.onChange(val === NONE_OPTION ? null : val)
                    }
                    disabled={!selectedCategoryId || subcategories.length === 0}
                  >
                    <SelectTrigger id="item-subcategory-select" aria-label="Subcategory">
                      <SelectValue
                        placeholder={
                          subcategories.length === 0
                            ? 'No subcategories'
                            : 'None / General'
                        }
                      />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NONE_OPTION}>None / General</SelectItem>
                      {subcategories.map((sub) => (
                        <SelectItem key={sub.id} value={sub.id}>
                          {sub.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
            </div>

            <div className="grid gap-1.5">
              <Label htmlFor="item-brand-input">Brand / Model</Label>
              <Input
                id="item-brand-input"
                placeholder="e.g. Pearl, Shure, Nord"
                {...register('brand')}
              />
            </div>

            <div className="grid gap-1.5">
              <Label htmlFor="item-serial-input">Serial Number</Label>
              <Input
                id="item-serial-input"
                placeholder="Optional serial / asset tag"
                {...register('serial')}
              />
            </div>

            <div className="grid gap-1.5">
              <Label htmlFor="item-qty-input">Quantity *</Label>
              <Input
                id="item-qty-input"
                type="number"
                min={0}
                step={1}
                {...register('qty')}
              />
              {errors.qty && (
                <p className="text-xs text-destructive">{errors.qty.message}</p>
              )}
            </div>

            <div className="grid gap-1.5">
              <Label htmlFor="item-condition-select">Condition *</Label>
              <Controller
                control={control}
                name="condition"
                render={({ field }) => (
                  <Select value={field.value ?? 'working'} onValueChange={field.onChange}>
                    <SelectTrigger id="item-condition-select" aria-label="Condition">
                      <SelectValue placeholder="Select condition" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="working">Working</SelectItem>
                      <SelectItem value="repair">Needs Repair</SelectItem>
                      <SelectItem value="missing">Missing</SelectItem>
                    </SelectContent>
                  </Select>
                )}
              />
            </div>

            <div className="grid gap-1.5">
              <Label htmlFor="item-location-select">Storage Location</Label>
              <Controller
                control={control}
                name="location_id"
                render={({ field }) => (
                  <Select
                    value={field.value ?? NONE_OPTION}
                    onValueChange={handleLocationChange}
                  >
                    <SelectTrigger id="item-location-select" aria-label="Location">
                      <SelectValue placeholder="Select location" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NONE_OPTION}>Unassigned</SelectItem>
                      {sortedLocations.map((loc) => (
                        <SelectItem key={loc.id} value={loc.id}>
                          {loc.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
            </div>

            <div className="grid gap-1.5">
              <Label htmlFor="item-owner-input">Owner / Custodian</Label>
              <Input
                id="item-owner-input"
                placeholder="e.g. Church Property"
                {...register('owner')}
              />
            </div>

            <div className="grid gap-1.5 sm:col-span-2">
              <Label htmlFor="item-description-input">Description</Label>
              <Textarea
                id="item-description-input"
                rows={2}
                placeholder="Specs, included accessories, cable lengths, case notes..."
                {...register('description')}
              />
            </div>

            <div className="grid gap-1.5 sm:col-span-2">
              <Label htmlFor="item-remarks-input">Remarks</Label>
              <Textarea
                id="item-remarks-input"
                rows={2}
                placeholder="Latest inspection notes or repair reminders..."
                {...register('remarks')}
              />
            </div>
          </div>

          {/* Photo Uploader (Up to 4 photos, 5 MB max each) */}
          <div className="space-y-2.5 rounded-xl border border-border bg-secondary/35 p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <Label htmlFor="item-photos-input">
                  Upload Photos ({totalPhotoCount} / {MAX_GEAR_PHOTOS})
                </Label>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Up to 4 images, max 5 MB per photo.
                </p>
              </div>
              <label
                htmlFor="item-photos-input"
                className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-input bg-card px-3 py-1.5 text-xs font-medium text-foreground shadow-xs transition-colors hover:bg-accent"
              >
                <ImagePlus className="size-3.5" aria-hidden="true" />
                <span>Select Photos</span>
              </label>
              <input
                id="item-photos-input"
                type="file"
                accept="image/*"
                multiple
                disabled={totalPhotoCount >= MAX_GEAR_PHOTOS || busy}
                onChange={handleFilesSelected}
                className="sr-only"
              />
            </div>

            {photoError && (
              <p role="alert" className="text-xs text-destructive">
                {photoError}
              </p>
            )}

            {totalPhotoCount > 0 && (
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                {existingPhotos.map((url, idx) => (
                  <div
                    key={`${url}-${idx}`}
                    className="group relative overflow-hidden rounded-lg border border-border bg-card"
                  >
                    <img
                      src={url}
                      alt={`Existing equipment photo ${idx + 1}`}
                      className="h-24 w-full object-cover"
                    />
                    <button
                      type="button"
                      onClick={() => handleRemoveExistingPhoto(idx)}
                      aria-label={`Remove photo ${idx + 1}`}
                      className="absolute right-1.5 top-1.5 rounded-full bg-black/70 p-1 text-white transition-colors hover:bg-destructive"
                    >
                      <X className="size-3.5" aria-hidden="true" />
                    </button>
                  </div>
                ))}

                {pendingPhotos.map((photo, idx) => (
                  <div
                    key={photo.id}
                    className="group relative overflow-hidden rounded-lg border border-primary/40 bg-card"
                  >
                    <img
                      src={photo.previewUrl}
                      alt={`Selected photo preview ${idx + 1}`}
                      className="h-24 w-full object-cover"
                    />
                    <button
                      type="button"
                      onClick={() => handleRemovePendingPhoto(photo.id)}
                      aria-label={`Remove photo ${photo.file.name}`}
                      className="absolute right-1.5 top-1.5 rounded-full bg-black/70 p-1 text-white transition-colors hover:bg-destructive"
                    >
                      <X className="size-3.5" aria-hidden="true" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          <DialogFooter className="pt-2">
            <Button
              type="button"
              variant="outline"
              disabled={busy}
              onClick={() => handleDialogOpenChange(false)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={busy}>
              {busy && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}
              <span>{item ? 'Save Changes' : 'Add Equipment'}</span>
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
