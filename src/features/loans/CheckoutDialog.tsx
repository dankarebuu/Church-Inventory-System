import { useEffect, useMemo, useRef, useState } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { AlertCircle, ArrowLeftRight, Loader2 } from 'lucide-react';
import { Controller, useForm } from 'react-hook-form';
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
import { Textarea } from '@/components/ui/textarea';
import type { EnrichedInventoryItem } from '@/features/inventory/useInventory';
import {
  createCheckoutSchema,
  type CheckoutFormInput,
  type CheckoutFormValues,
} from './schemas';
import { useLoanMutations, type CheckoutItemInput } from './useLoans';

export interface CheckoutDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  items: readonly EnrichedInventoryItem[];
  preselectedItem?: EnrichedInventoryItem | null;
  onCheckout?: (input: CheckoutItemInput) => Promise<unknown>;
  isSubmitting?: boolean;
  isOffline?: boolean;
}

function buildDefaultValues(preselectedItemId: string | null): CheckoutFormInput {
  return {
    item_id: preselectedItemId ?? '',
    borrower_name: '',
    borrower_contact: '',
    qty_loaned: 1,
    due_date: '',
    notes: '',
  };
}

/**
 * Equipment check-out modal with live `Available: X / Y` tracking, partial
 * quantity validation (`1..available_qty`), and refetch-safe form state.
 */
export function CheckoutDialog({
  open,
  onOpenChange,
  items,
  preselectedItem = null,
  onCheckout,
  isSubmitting: externalIsSubmitting,
  isOffline = false,
}: CheckoutDialogProps) {
  const { checkoutItem: hookCheckoutItem, isCheckingOut: hookIsCheckingOut } =
    useLoanMutations();
  const isMutationPending = externalIsSubmitting ?? hookIsCheckingOut;

  const [submitError, setSubmitError] = useState<string | null>(null);

  const availableItems = useMemo(
    () => items.filter((entry) => entry.available_qty > 0),
    [items]
  );

  const selectableItems = useMemo(() => {
    if (!preselectedItem) return availableItems;
    const livePreselected = items.find((entry) => entry.id === preselectedItem.id) ?? preselectedItem;
    if (availableItems.some((entry) => entry.id === livePreselected.id)) {
      return availableItems;
    }
    return [livePreselected, ...availableItems];
  }, [availableItems, items, preselectedItem]);

  const wasOpenRef = useRef(false);
  const initializedTargetIdRef = useRef<string | null | undefined>(undefined);
  const currentTargetId = preselectedItem?.id ?? null;

  // Placeholder schema during initialization; updated reactively below via resolver ref/closure.
  const [selectedItemIdState, setSelectedItemIdState] = useState<string>(
    currentTargetId ?? ''
  );

  const selectedItem = useMemo(() => {
    const id = selectedItemIdState;
    if (!id) return null;
    return (
      items.find((entry) => entry.id === id) ??
      (preselectedItem?.id === id ? preselectedItem : null)
    );
  }, [items, preselectedItem, selectedItemIdState]);

  const selectedAvailableQty = selectedItem?.available_qty ?? 0;
  const schemaMaxQty = selectedItem ? selectedAvailableQty : Number.MAX_SAFE_INTEGER;

  const checkoutSchema = useMemo(
    () => createCheckoutSchema(schemaMaxQty),
    [schemaMaxQty]
  );

  const {
    register,
    control,
    handleSubmit,
    reset,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<CheckoutFormInput, unknown, CheckoutFormValues>({
    resolver: zodResolver(checkoutSchema),
    defaultValues: buildDefaultValues(currentTargetId),
  });

  const watchedItemId = watch('item_id');

  useEffect(() => {
    setSelectedItemIdState(watchedItemId ?? '');
  }, [watchedItemId]);

  useEffect(() => {
    if (!open) {
      if (wasOpenRef.current) {
        setSubmitError(null);
      }
      wasOpenRef.current = false;
      initializedTargetIdRef.current = undefined;
      return;
    }

    const isOpening = !wasOpenRef.current;
    const targetChanged = currentTargetId !== initializedTargetIdRef.current;
    if (!isOpening && !targetChanged) {
      return;
    }

    wasOpenRef.current = true;
    initializedTargetIdRef.current = currentTargetId;
    setSubmitError(null);
    setSelectedItemIdState(currentTargetId ?? '');
    reset(buildDefaultValues(currentTargetId));
  }, [open, currentTargetId, reset]);

  const onValidSubmit = async (values: CheckoutFormValues) => {
    if (isOffline) return;
    setSubmitError(null);

    const targetItem =
      items.find((entry) => entry.id === values.item_id) ??
      (preselectedItem?.id === values.item_id ? preselectedItem : null);

    if (!targetItem) {
      setSubmitError('Selected equipment item could not be found.');
      return;
    }

    try {
      const checkoutFn = onCheckout ?? hookCheckoutItem;
      await checkoutFn({
        ...values,
        itemName: targetItem.item,
        maxAvailableQty: targetItem.available_qty,
      });

      toast.success(
        `Checked out ${values.qty_loaned} × "${targetItem.item}" to ${values.borrower_name}.`
      );
      onOpenChange(false);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Unable to complete gear check-out.';
      setSubmitError(message);
      toast.error(message);
    }
  };

  const busy = isSubmitting || isMutationPending;
  const noAvailableItems = selectableItems.length === 0;
  const preselectedOutOfStock = Boolean(
    selectedItem && selectedItem.available_qty <= 0
  );

  const handleDialogOpenChange = (nextOpen: boolean) => {
    if (!nextOpen) {
      setSubmitError(null);
    }
    onOpenChange(nextOpen);
  };

  return (
    <Dialog open={open} onOpenChange={handleDialogOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Check Out Gear</DialogTitle>
          <DialogDescription>
            Record borrower details, quantity loaned, and optional return due date.
          </DialogDescription>
        </DialogHeader>

        {isOffline && (
          <OfflineNotice message="You are offline. Equipment check-outs cannot be submitted until connection returns." />
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

        {noAvailableItems && (
          <div
            role="status"
            className="rounded-lg border border-border bg-secondary/40 p-3 text-sm text-muted-foreground"
          >
            No equipment items currently have available units to check out.
          </div>
        )}

        <form
          onSubmit={(event) => void handleSubmit(onValidSubmit)(event)}
          className="grid gap-4"
          noValidate
        >
          <div className="grid gap-1.5">
            <Label htmlFor="checkout-item-select">Equipment Item *</Label>
            <Controller
              control={control}
              name="item_id"
              render={({ field }) => (
                <Select
                  value={field.value}
                  onValueChange={(nextValue) => {
                    field.onChange(nextValue);
                    setSelectedItemIdState(nextValue);
                  }}
                  disabled={Boolean(preselectedItem) || noAvailableItems}
                >
                  <SelectTrigger id="checkout-item-select" aria-label="Equipment Item">
                    <SelectValue placeholder="Select available equipment..." />
                  </SelectTrigger>
                  <SelectContent>
                    {selectableItems.map((entry) => (
                      <SelectItem key={entry.id} value={entry.id}>
                        {entry.item} ({entry.available_qty} / {entry.qty} available)
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            />
            {errors.item_id && (
              <p className="text-xs text-destructive">{errors.item_id.message}</p>
            )}
          </div>

          {selectedItem && (
            <div
              className="flex items-center justify-between gap-3 rounded-lg border border-border bg-secondary/40 px-3.5 py-2.5 text-xs"
              data-testid="checkout-availability-banner"
            >
              <span className="truncate font-medium text-foreground">
                {selectedItem.item}
              </span>
              <span className="shrink-0 font-mono font-semibold text-foreground">
                Available: {selectedItem.available_qty} / {selectedItem.qty}
              </span>
            </div>
          )}

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="grid gap-1.5 sm:col-span-2">
              <Label htmlFor="checkout-borrower-name">Borrower Name *</Label>
              <Input
                id="checkout-borrower-name"
                placeholder="e.g. Joel Santos"
                {...register('borrower_name')}
              />
              {errors.borrower_name && (
                <p className="text-xs text-destructive">{errors.borrower_name.message}</p>
              )}
            </div>

            <div className="grid gap-1.5 sm:col-span-2">
              <Label htmlFor="checkout-borrower-contact">Borrower Contact</Label>
              <Input
                id="checkout-borrower-contact"
                placeholder="Phone number or email (optional)"
                {...register('borrower_contact')}
              />
              {errors.borrower_contact && (
                <p className="text-xs text-destructive">
                  {errors.borrower_contact.message}
                </p>
              )}
            </div>

            <div className="grid gap-1.5">
              <Label htmlFor="checkout-qty-loaned">Quantity *</Label>
              <Input
                id="checkout-qty-loaned"
                type="number"
                min={1}
                max={selectedItem ? Math.max(selectedItem.available_qty, 1) : undefined}
                step={1}
                {...register('qty_loaned')}
              />
              {errors.qty_loaned && (
                <p className="text-xs text-destructive">{errors.qty_loaned.message}</p>
              )}
            </div>

            <div className="grid gap-1.5">
              <Label htmlFor="checkout-due-date">Due Date</Label>
              <Input id="checkout-due-date" type="date" {...register('due_date')} />
              {errors.due_date && (
                <p className="text-xs text-destructive">{errors.due_date.message}</p>
              )}
            </div>

            <div className="grid gap-1.5 sm:col-span-2">
              <Label htmlFor="checkout-notes">Notes</Label>
              <Textarea
                id="checkout-notes"
                rows={2}
                placeholder="Event, ministry team, or return reminders..."
                {...register('notes')}
              />
              {errors.notes && (
                <p className="text-xs text-destructive">{errors.notes.message}</p>
              )}
            </div>
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
            <Button
              type="submit"
              disabled={busy || noAvailableItems || preselectedOutOfStock || isOffline}
            >
              {busy ? (
                <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              ) : (
                <ArrowLeftRight className="size-4" aria-hidden="true" />
              )}
              <span>{busy ? 'Checking Out...' : 'Confirm Check Out'}</span>
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
