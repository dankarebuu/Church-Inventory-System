import { useEffect, useMemo, useRef, useState } from 'react';
import { AlertCircle, Check, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { OfflineNotice } from '@/components/layout/OfflineBanner';
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
import { cn } from '@/lib/utils';
import type { Category } from '@/types/database';
import {
  CURATED_CATEGORY_ICONS,
  resolveCategoryIcon,
  WINGMACC_COLOR_SWATCHES,
} from './categoryUi';
import {
  DEFAULT_CATEGORY_COLOR,
  normalizeCategoryColor,
  sortCategories,
  useCategoryMutations,
} from './useCategories';

export interface CategoryDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  category?: Category | null;
  defaultParentId?: string | null;
  categories: readonly Category[];
  isOffline?: boolean;
}

const NONE_PARENT = '__none__';

function resolveInitialCategoryForm(
  category: Category | null | undefined,
  defaultParentId: string | null | undefined,
  categories: readonly Category[]
): {
  name: string;
  parentId: string | null;
  color: string;
  icon: string;
} {
  if (category) {
    return {
      name: category.name,
      parentId: category.parent_id,
      color: category.color || DEFAULT_CATEGORY_COLOR,
      icon: category.icon?.trim() || 'tag',
    };
  }

  const parent = defaultParentId
    ? categories.find((cat) => cat.id === defaultParentId && cat.parent_id === null)
    : undefined;

  return {
    name: '',
    parentId: parent?.id ?? null,
    color: parent?.color ?? '#2563EB',
    icon: parent?.icon?.trim() || 'tag',
  };
}

/**
 * Admin modal for creating or editing 2-level categories and subcategories,
 * featuring WINGMACC color swatches + hex input, a curated 12-icon picker,
 * and a parent category selector.
 */
export function CategoryDialog({
  open,
  onOpenChange,
  category = null,
  defaultParentId = null,
  categories,
  isOffline = false,
}: CategoryDialogProps) {
  const { createCategory, updateCategory, isSaving } = useCategoryMutations();

  const [name, setName] = useState('');
  const [parentId, setParentId] = useState<string | null>(null);
  const [color, setColor] = useState('#2563EB');
  const [icon, setIcon] = useState('tag');
  const [submitError, setSubmitError] = useState<string | null>(null);

  const wasOpenRef = useRef(false);
  const initializedKeyRef = useRef<string | null>(null);
  const latestCategoriesRef = useRef(categories);
  latestCategoriesRef.current = categories;

  const initKey = `${category?.id ?? 'new'}:${defaultParentId ?? 'root'}`;

  useEffect(() => {
    if (!open) {
      wasOpenRef.current = false;
      initializedKeyRef.current = null;
      setSubmitError(null);
      return;
    }

    const isOpening = !wasOpenRef.current;
    const keyChanged = initializedKeyRef.current !== initKey;
    if (!isOpening && !keyChanged) {
      return;
    }

    wasOpenRef.current = true;
    initializedKeyRef.current = initKey;

    const initial = resolveInitialCategoryForm(
      category,
      defaultParentId,
      latestCategoriesRef.current
    );
    setName(initial.name);
    setParentId(initial.parentId);
    setColor(initial.color);
    setIcon(initial.icon);
    setSubmitError(null);
  }, [open, initKey, category, defaultParentId]);

  const topLevelOptions = useMemo(
    () =>
      sortCategories(
        categories.filter((cat) => cat.parent_id === null && cat.id !== category?.id)
      ),
    [categories, category?.id]
  );

  const hasChildSubcategories = useMemo(
    () => (category ? categories.some((cat) => cat.parent_id === category.id) : false),
    [categories, category]
  );

  const isEditing = Boolean(category);
  const isSubcategoryMode = parentId !== null;
  const PreviewIcon = resolveCategoryIcon(icon);

  let previewColor = DEFAULT_CATEGORY_COLOR;
  try {
    previewColor = normalizeCategoryColor(color);
  } catch {
    previewColor = DEFAULT_CATEGORY_COLOR;
  }

  const dialogTitle = isEditing
    ? isSubcategoryMode
      ? 'Edit Subcategory'
      : 'Edit Category'
    : isSubcategoryMode
      ? 'Add Subcategory'
      : 'Add Category';

  const submitLabel = isEditing
    ? 'Save Changes'
    : isSubcategoryMode
      ? 'Create Subcategory'
      : 'Create Category';

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (isOffline) return;
    setSubmitError(null);

    const trimmedName = name.trim();
    if (!trimmedName) {
      setSubmitError('Category name is required.');
      return;
    }

    let validColor: string;
    try {
      validColor = normalizeCategoryColor(color);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Invalid hex color.';
      setSubmitError(msg);
      return;
    }

    try {
      if (category) {
        await updateCategory({
          id: category.id,
          name: trimmedName,
          parent_id: parentId,
          color: validColor,
          icon,
          previousName: category.name,
        });
        toast.success(`Updated "${trimmedName}".`);
      } else {
        await createCategory({
          name: trimmedName,
          parent_id: parentId,
          color: validColor,
          icon,
        });
        toast.success(
          isSubcategoryMode
            ? `Added subcategory "${trimmedName}".`
            : `Added category "${trimmedName}".`
        );
      }
      onOpenChange(false);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Unable to save category.';
      setSubmitError(message);
      toast.error(message);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{dialogTitle}</DialogTitle>
          <DialogDescription>
            {isEditing
              ? 'Update category label, parent group, accent swatch, or Lucide icon.'
              : 'Organize band equipment into top-level categories and nested subcategories.'}
          </DialogDescription>
        </DialogHeader>

        {isOffline && (
          <OfflineNotice message="You are offline. Category changes cannot be saved until connection returns." />
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
          <div className="flex items-center gap-3 rounded-xl border border-border bg-secondary/40 p-3">
            <span
              aria-hidden="true"
              className="flex size-10 shrink-0 items-center justify-center rounded-lg border border-border/60 text-white shadow-xs"
              style={{ backgroundColor: previewColor }}
            >
              <PreviewIcon className="size-5" />
            </span>
            <div className="min-w-0">
              <p className="font-display truncate text-sm font-semibold text-foreground">
                {name.trim() || 'Category Preview'}
              </p>
              <p className="font-sans text-xs text-muted-foreground">
                <code className="font-mono">{previewColor.toUpperCase()}</code> · {icon}
              </p>
            </div>
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="category-name-input">Category Name *</Label>
            <Input
              id="category-name-input"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder={isSubcategoryMode ? 'e.g. Snares, Condenser Mics' : 'e.g. Vocals, Drums'}
              disabled={isSaving}
            />
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="category-parent-select">Parent Category</Label>
            <Select
              value={parentId ?? NONE_PARENT}
              onValueChange={(value) => setParentId(value === NONE_PARENT ? null : value)}
              disabled={isSaving || hasChildSubcategories}
            >
              <SelectTrigger id="category-parent-select" aria-label="Parent Category">
                <SelectValue placeholder="None (Top-level category)" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE_PARENT}>None (Top-level category)</SelectItem>
                {topLevelOptions.map((opt) => (
                  <SelectItem key={opt.id} value={opt.id}>
                    {opt.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {hasChildSubcategories && (
              <p className="text-xs text-muted-foreground">
                Cannot nest a category that currently has subcategories.
              </p>
            )}
          </div>

          <div className="grid gap-2">
            <div className="flex items-center justify-between gap-2">
              <Label htmlFor="category-color-hex">Color Swatch & Hex</Label>
              <div className="flex items-center gap-2">
                <span
                  aria-hidden="true"
                  className="size-5 rounded border border-border shadow-xs"
                  style={{ backgroundColor: previewColor }}
                />
                <Input
                  id="category-color-hex"
                  aria-label="Hex Color"
                  value={color}
                  onChange={(event) => setColor(event.target.value)}
                  placeholder="#d97740"
                  className="h-8 w-28 font-mono text-xs"
                  disabled={isSaving}
                />
              </div>
            </div>

            <div className="flex flex-wrap gap-2" role="group" aria-label="Color palette">
              {WINGMACC_COLOR_SWATCHES.map((swatch) => {
                const selected = color.trim().toLowerCase() === swatch.hex.toLowerCase();
                return (
                  <button
                    key={swatch.hex}
                    type="button"
                    aria-label={`Select color ${swatch.label}`}
                    aria-pressed={selected}
                    disabled={isSaving}
                    onClick={() => setColor(swatch.hex)}
                    className={cn(
                      'flex size-8 cursor-pointer items-center justify-center rounded-lg border transition-transform hover:scale-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                      selected
                        ? 'border-foreground ring-2 ring-ring ring-offset-1 ring-offset-background'
                        : 'border-border/80'
                    )}
                    style={{ backgroundColor: swatch.hex }}
                    title={swatch.label}
                  >
                    {selected && <Check className="size-4 text-white drop-shadow-xs" aria-hidden="true" />}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="grid gap-2">
            <Label>Category Icon</Label>
            <div
              role="group"
              aria-label="Category icons"
              className="grid grid-cols-4 gap-2 sm:grid-cols-6"
            >
              {CURATED_CATEGORY_ICONS.map((opt) => {
                const IconComponent = opt.icon;
                const selected = icon.toLowerCase() === opt.value;
                return (
                  <button
                    key={opt.value}
                    type="button"
                    aria-label={opt.label}
                    aria-pressed={selected}
                    disabled={isSaving}
                    onClick={() => setIcon(opt.value)}
                    className={cn(
                      'flex cursor-pointer flex-col items-center justify-center gap-1 rounded-lg border px-2 py-2 text-[11px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                      selected
                        ? 'border-primary bg-primary/12 text-primary'
                        : 'border-border bg-card text-muted-foreground hover:bg-accent hover:text-foreground'
                    )}
                  >
                    <IconComponent className="size-4" aria-hidden="true" />
                    <span className="truncate">{opt.label}</span>
                  </button>
                );
              })}
            </div>
          </div>

          <DialogFooter className="pt-2">
            <Button
              type="button"
              variant="outline"
              disabled={isSaving}
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={isSaving || isOffline}>
              {isSaving && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}
              <span>{submitLabel}</span>
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
