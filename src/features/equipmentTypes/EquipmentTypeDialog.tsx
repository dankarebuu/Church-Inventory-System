import { useEffect, useRef, useState } from 'react';
import { AlertCircle, Check, Loader2 } from 'lucide-react';
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
  CURATED_CATEGORY_ICONS,
  resolveCategoryIcon,
  WINGMACC_COLOR_SWATCHES,
} from '@/features/categories/categoryUi';
import { cn } from '@/lib/utils';
import type { EquipmentType } from '@/types/database';
import {
  DEFAULT_EQUIPMENT_TYPE_COLOR,
  normalizeEquipmentTypeColor,
  useEquipmentTypeMutations,
} from './useEquipmentTypes';

export interface EquipmentTypeDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  equipmentType?: EquipmentType | null;
}

/**
 * Admin modal for creating or editing equipment types (`name`, `color`,
 * `icon`, and `sort_order`), mirroring CategoryDialog and LocationDialog.
 */
export function EquipmentTypeDialog({
  open,
  onOpenChange,
  equipmentType = null,
}: EquipmentTypeDialogProps) {
  const { createEquipmentType, updateEquipmentType, isSaving } =
    useEquipmentTypeMutations();

  const [name, setName] = useState('');
  const [color, setColor] = useState('#2563EB');
  const [icon, setIcon] = useState('tag');
  const [sortOrder, setSortOrder] = useState('');
  const [submitError, setSubmitError] = useState<string | null>(null);

  const wasOpenRef = useRef(false);
  const initializedIdRef = useRef<string | null>(null);
  const targetKey = equipmentType?.id ?? 'new';

  useEffect(() => {
    if (!open) {
      wasOpenRef.current = false;
      initializedIdRef.current = null;
      setSubmitError(null);
      return;
    }

    const isOpening = !wasOpenRef.current;
    const keyChanged = initializedIdRef.current !== targetKey;
    if (!isOpening && !keyChanged) {
      return;
    }

    wasOpenRef.current = true;
    initializedIdRef.current = targetKey;
    setName(equipmentType?.name ?? '');
    setColor(equipmentType?.color || '#2563EB');
    setIcon(equipmentType?.icon?.trim() || 'tag');
    setSortOrder(equipmentType ? String(equipmentType.sort_order ?? 0) : '');
    setSubmitError(null);
  }, [open, targetKey, equipmentType]);

  const isEditing = Boolean(equipmentType);
  const PreviewIcon = resolveCategoryIcon(icon);

  let previewColor = DEFAULT_EQUIPMENT_TYPE_COLOR;
  try {
    previewColor = normalizeEquipmentTypeColor(color);
  } catch {
    previewColor = DEFAULT_EQUIPMENT_TYPE_COLOR;
  }

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSubmitError(null);

    const trimmedName = name.trim();
    if (!trimmedName) {
      setSubmitError('Equipment type name is required.');
      return;
    }

    let validColor: string;
    try {
      validColor = normalizeEquipmentTypeColor(color);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Invalid hex color.';
      setSubmitError(msg);
      return;
    }

    const trimmedSort = sortOrder.trim();
    let parsedSortOrder: number | undefined;
    if (trimmedSort.length > 0) {
      const numericSort = Number(trimmedSort);
      if (!Number.isFinite(numericSort) || !Number.isInteger(numericSort)) {
        setSubmitError('Sort order must be a whole number.');
        return;
      }
      parsedSortOrder = numericSort === 0 ? 0 : numericSort;
    } else if (equipmentType) {
      parsedSortOrder = equipmentType.sort_order;
    }

    try {
      if (equipmentType) {
        await updateEquipmentType({
          id: equipmentType.id,
          name: trimmedName,
          color: validColor,
          icon,
          sort_order: parsedSortOrder,
          previousName: equipmentType.name,
        });
        toast.success(`Updated "${trimmedName}".`);
      } else {
        await createEquipmentType({
          name: trimmedName,
          color: validColor,
          icon,
          ...(parsedSortOrder !== undefined ? { sort_order: parsedSortOrder } : {}),
        });
        toast.success(`Added "${trimmedName}".`);
      }
      onOpenChange(false);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Unable to save equipment type.';
      setSubmitError(message);
      toast.error(message);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {isEditing ? 'Edit Equipment Type' : 'Add Equipment Type'}
          </DialogTitle>
          <DialogDescription>
            {isEditing
              ? 'Update equipment type label, badge swatch, icon, or display order. Linked gear syncs automatically.'
              : 'Classify gear by functional hardware type (e.g. Microphones, Cables & Cords, Instruments).'}
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
                {name.trim() || 'Equipment Type Preview'}
              </p>
              <p className="font-mono text-[11px] text-muted-foreground">
                {previewColor.toUpperCase()} · {icon}
                {sortOrder.trim() ? ` · Order ${sortOrder.trim()}` : ''}
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div className="grid gap-1.5 sm:col-span-2">
              <Label htmlFor="equipment-type-name-input">Type Name *</Label>
              <Input
                id="equipment-type-name-input"
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="e.g. Microphones, Cables & Cords"
                disabled={isSaving}
              />
            </div>

            <div className="grid gap-1.5">
              <Label htmlFor="equipment-type-sort-order-input">Sort Order</Label>
              <Input
                id="equipment-type-sort-order-input"
                type="number"
                step={1}
                value={sortOrder}
                onChange={(event) => setSortOrder(event.target.value)}
                placeholder="Auto"
                disabled={isSaving}
              />
            </div>
          </div>

          <div className="grid gap-2">
            <div className="flex items-center justify-between gap-2">
              <Label htmlFor="equipment-type-color-hex">Color Swatch & Hex</Label>
              <div className="flex items-center gap-2">
                <span
                  aria-hidden="true"
                  className="size-5 rounded border border-border shadow-xs"
                  style={{ backgroundColor: previewColor }}
                />
                <Input
                  id="equipment-type-color-hex"
                  aria-label="Hex Color"
                  value={color}
                  onChange={(event) => setColor(event.target.value)}
                  placeholder="#2563EB"
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
                    {selected && (
                      <Check className="size-4 text-white drop-shadow-xs" aria-hidden="true" />
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="grid gap-2">
            <Label>Equipment Type Icon</Label>
            <div
              role="group"
              aria-label="Equipment type icons"
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
            <Button type="submit" disabled={isSaving}>
              {isSaving && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}
              <span>{isEditing ? 'Save Changes' : 'Create Equipment Type'}</span>
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
