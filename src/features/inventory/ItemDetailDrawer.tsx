import { useEffect, useState } from 'react';
import {
  ArrowLeftRight,
  ChevronLeft,
  ChevronRight,
  Edit2,
  ImageOff,
  Maximize2,
  RotateCcw,
  Trash2,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { getCategoryColor } from '@/features/categories/useCategories';
import type { EnrichedInventoryItem } from '@/features/inventory/useInventory';
import { cn, formatDisplayDate, parseImages } from '@/lib/utils';
import type {
  Category,
  ItemCondition,
  LoanRecord,
  LocationRecord,
  UserRole,
} from '@/types/database';
import {
  CONDITION_META,
  isLoanDateOverdue,
  resolveCategoryName,
  resolveLocationName,
  resolveSubcategoryName,
} from './inventoryUi';
import { QuickCheckButtons } from './QuickCheckButtons';
import { ZoomLightbox } from './ZoomLightbox';

export interface ItemDetailDrawerProps {
  item: EnrichedInventoryItem | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  role: UserRole;
  categories: readonly Category[];
  locations?: readonly LocationRecord[];
  onQuickCheck?: (item: EnrichedInventoryItem, condition: ItemCondition) => Promise<void> | void;
  isChecking?: boolean;
  onEdit?: (item: EnrichedInventoryItem) => void;
  onDelete?: (item: EnrichedInventoryItem) => void;
  onCheckout?: (item: EnrichedInventoryItem) => void;
  onReturnLoan?: (loan: LoanRecord, item: EnrichedInventoryItem) => void;
}

/**
 * Slide-over equipment detail drawer with multi-photo carousel, ZoomLightbox
 * trigger, full specs, role-isolated loan details, quick checks, and CRUD actions.
 */
export function ItemDetailDrawer({
  item,
  open,
  onOpenChange,
  role,
  categories,
  locations = [],
  onQuickCheck,
  isChecking = false,
  onEdit,
  onDelete,
  onCheckout,
  onReturnLoan,
}: ItemDetailDrawerProps) {
  const [photoIndex, setPhotoIndex] = useState(0);
  const [lightboxOpen, setLightboxOpen] = useState(false);

  const photos = parseImages(item?.image_filename);

  useEffect(() => {
    setPhotoIndex(0);
    setLightboxOpen(false);
  }, [item?.id, open]);

  if (!item) return null;

  const canCheck = role === 'member' || role === 'admin';
  const canAdmin = role === 'admin';
  const conditionMeta = CONDITION_META[item.condition];
  const categoryName = resolveCategoryName(item, categories);
  const subcategoryName = resolveSubcategoryName(item, categories);
  const locationName = resolveLocationName(item, locations);
  const categoryColor = getCategoryColor(categoryName, categories, item.category_id);
  const safePhotoIndex = Math.min(photoIndex, Math.max(photos.length - 1, 0));
  const currentPhoto = photos[safePhotoIndex] ?? null;
  const activeLoans = item.activeLoans ?? [];

  const stepPhoto = (delta: number) => {
    if (photos.length <= 1) return;
    setPhotoIndex((prev) => (prev + delta + photos.length) % photos.length);
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="w-full max-w-xl gap-0 overflow-y-auto p-0"
        onEscapeKeyDown={(event) => {
          if (lightboxOpen) {
            event.preventDefault();
          }
        }}
        onPointerDownOutside={(event) => {
          if (lightboxOpen) {
            event.preventDefault();
          }
        }}
      >
        <div
          aria-hidden="true"
          className="h-1.5 w-full shrink-0"
          style={{ backgroundColor: categoryColor }}
        />

        <SheetHeader className="border-b border-border px-6 py-5 pr-14">
          <div className="flex flex-wrap items-center gap-2">
            <span
              className="inline-flex items-center gap-1.5 rounded-full border border-border bg-secondary/60 px-2.5 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-wider text-foreground"
            >
              <span
                aria-hidden="true"
                className="size-2 rounded-full"
                style={{ backgroundColor: categoryColor }}
              />
              {categoryName}
              {subcategoryName ? ` / ${subcategoryName}` : ''}
            </span>
            <Badge variant={conditionMeta.badgeVariant}>{conditionMeta.label}</Badge>
            {item.qty_on_loan > 0 && <Badge variant="loaned">On Loan</Badge>}
          </div>

          <SheetTitle className="mt-1 text-xl">{item.item}</SheetTitle>
          <SheetDescription>
            {[item.brand, item.serial ? `Serial: ${item.serial}` : null]
              .filter((part): part is string => Boolean(part && part.trim()))
              .join(' · ') || 'WINGMACC Band Equipment Record'}
          </SheetDescription>
        </SheetHeader>

        <div className="flex-1 space-y-6 p-6">
          {/* Multi-photo Carousel */}
          <div className="space-y-2.5">
            {currentPhoto ? (
              <div className="group relative overflow-hidden rounded-xl border border-border bg-secondary/40">
                <button
                  type="button"
                  onClick={() => setLightboxOpen(true)}
                  aria-label={`Open full preview of ${item.item}`}
                  className="block w-full cursor-zoom-in focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <img
                    src={currentPhoto}
                    alt={`${item.item} photo ${safePhotoIndex + 1}`}
                    className="h-56 w-full object-contain bg-black/5 dark:bg-black/30"
                  />
                </button>

                <div className="pointer-events-none absolute right-2.5 top-2.5 inline-flex items-center gap-1 rounded-md bg-black/65 px-2 py-1 font-mono text-[10px] font-medium text-white">
                  <Maximize2 className="size-3" aria-hidden="true" />
                  <span>Zoom</span>
                </div>

                {photos.length > 1 && (
                  <>
                    <Button
                      type="button"
                      size="icon"
                      variant="secondary"
                      aria-label="Previous photo"
                      onClick={() => stepPhoto(-1)}
                      className="absolute left-2.5 top-1/2 size-8 -translate-y-1/2 rounded-full opacity-90 shadow-card"
                    >
                      <ChevronLeft className="size-4" aria-hidden="true" />
                    </Button>
                    <Button
                      type="button"
                      size="icon"
                      variant="secondary"
                      aria-label="Next photo"
                      onClick={() => stepPhoto(1)}
                      className="absolute right-2.5 top-1/2 size-8 -translate-y-1/2 rounded-full opacity-90 shadow-card"
                    >
                      <ChevronRight className="size-4" aria-hidden="true" />
                    </Button>
                  </>
                )}
              </div>
            ) : (
              <div className="flex h-36 flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border bg-secondary/30 text-muted-foreground">
                <ImageOff className="size-6 opacity-60" aria-hidden="true" />
                <span className="font-mono text-xs">No equipment photos uploaded</span>
              </div>
            )}

            {photos.length > 1 && (
              <div className="flex items-center gap-2 overflow-x-auto pb-1">
                {photos.map((url, idx) => (
                  <button
                    key={`${url}-${idx}`}
                    type="button"
                    onClick={() => setPhotoIndex(idx)}
                    aria-label={`View photo ${idx + 1}`}
                    className={cn(
                      'relative h-14 w-16 shrink-0 overflow-hidden rounded-lg border transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                      idx === safePhotoIndex
                        ? 'border-primary ring-2 ring-primary/25'
                        : 'border-border opacity-75 hover:opacity-100'
                    )}
                  >
                    <img
                      src={url}
                      alt={`${item.item} thumbnail ${idx + 1}`}
                      className="h-full w-full object-cover"
                    />
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Quick Condition Check (Member & Admin only) */}
          {canCheck && (
            <div className="space-y-2 rounded-xl border border-border bg-secondary/35 p-4">
              <div className="flex items-center justify-between gap-2">
                <h3 className="font-mono text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Quick Sunday Check
                </h3>
                {item.checkedBy && (
                  <span className="font-mono text-[11px] text-muted-foreground">
                    Checked by {item.checkedBy} ·{' '}
                    {formatDisplayDate(item.dateChecked ?? item.checked_at)}
                  </span>
                )}
              </div>
              <QuickCheckButtons
                item={item}
                onQuickCheck={onQuickCheck}
                disabled={isChecking}
                layout="grid"
              />
            </div>
          )}

          {/* Equipment Specs */}
          <div className="space-y-3">
            <h3 className="font-mono text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              Equipment Specifications
            </h3>
            <dl className="grid grid-cols-2 gap-3 rounded-xl border border-border bg-card p-4 text-sm">
              <div>
                <dt className="font-mono text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Availability
                </dt>
                <dd className="mt-0.5 font-mono font-semibold text-foreground">
                  {`${item.available_qty} / ${item.qty}`} available
                </dd>
              </div>
              <div>
                <dt className="font-mono text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Location
                </dt>
                <dd className="mt-0.5 font-medium text-foreground">{locationName}</dd>
              </div>
              <div>
                <dt className="font-mono text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Owner
                </dt>
                <dd className="mt-0.5 font-medium text-foreground">{item.owner || '—'}</dd>
              </div>
              <div>
                <dt className="font-mono text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Last Checked
                </dt>
                <dd className="mt-0.5 font-medium text-foreground">
                  {formatDisplayDate(item.dateChecked ?? item.checked_at)}
                </dd>
              </div>
              {item.description && (
                <div className="col-span-2 border-t border-border pt-3">
                  <dt className="font-mono text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                    Description
                  </dt>
                  <dd className="mt-1 whitespace-pre-line text-sm text-foreground">
                    {item.description}
                  </dd>
                </div>
              )}
              {item.remarks && (
                <div className="col-span-2 border-t border-border pt-3">
                  <dt className="font-mono text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                    Remarks
                  </dt>
                  <dd className="mt-1 whitespace-pre-line text-sm text-foreground">
                    {item.remarks}
                  </dd>
                </div>
              )}
            </dl>
          </div>

          {/* Loans Section — Role-Isolated */}
          <div className="space-y-3">
            <div className="flex items-center justify-between gap-2">
              <h3 className="font-mono text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                Loans & Check-Out
              </h3>
              {canCheck && (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={item.available_qty <= 0}
                  onClick={() => onCheckout?.(item)}
                >
                  <ArrowLeftRight className="size-3.5" aria-hidden="true" />
                  <span>Check Out</span>
                </Button>
              )}
            </div>

            {!canCheck ? (
              <div className="rounded-xl border border-border bg-secondary/35 p-4 text-sm">
                {item.qty_on_loan > 0 ? (
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="loaned">On Loan</Badge>
                    <span className="text-muted-foreground">
                      {item.qty_on_loan} {item.qty_on_loan === 1 ? 'unit' : 'units'} currently
                      checked out ({item.available_qty} available).
                    </span>
                  </div>
                ) : (
                  <p className="text-muted-foreground">
                    {item.qty > 0
                      ? `All ${item.qty} ${item.qty === 1 ? 'unit is' : 'units are'} available in storage.`
                      : '0 units logged in stock.'}
                  </p>
                )}
              </div>
            ) : activeLoans.length === 0 ? (
              <div className="rounded-xl border border-dashed border-border bg-secondary/25 p-4 text-sm text-muted-foreground">
                No active loans for this item. {item.available_qty} of {item.qty} available to
                check out.
              </div>
            ) : (
              <div className="space-y-2.5">
                {activeLoans.map((loan) => {
                  const overdue = isLoanDateOverdue(loan.due_date, loan.returned_at);
                  return (
                    <div
                      key={loan.id}
                      className={cn(
                        'flex flex-col gap-2 rounded-xl border p-3.5 text-sm',
                        overdue
                          ? 'border-destructive/40 bg-destructive/5'
                          : 'border-border bg-card'
                      )}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="font-semibold text-foreground">
                              {loan.borrower_name}
                            </span>
                            <Badge variant="loaned">Qty {loan.qty_loaned}</Badge>
                            {overdue && <Badge variant="repair">Overdue</Badge>}
                          </div>
                          {loan.borrower_contact && (
                            <p className="mt-0.5 font-mono text-xs text-muted-foreground">
                              {loan.borrower_contact}
                            </p>
                          )}
                        </div>

                        {onReturnLoan && (
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            onClick={() => onReturnLoan(loan, item)}
                          >
                            <RotateCcw className="size-3.5" aria-hidden="true" />
                            <span>Return</span>
                          </Button>
                        )}
                      </div>

                      <div className="flex flex-wrap gap-x-4 gap-y-1 font-mono text-[11px] text-muted-foreground">
                        <span>Out: {formatDisplayDate(loan.checked_out_at)}</span>
                        <span>Due: {loan.due_date ? formatDisplayDate(loan.due_date) : 'No due date'}</span>
                      </div>

                      {loan.notes && (
                        <p className="text-xs text-muted-foreground">{loan.notes}</p>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {canAdmin && (
          <SheetFooter className="border-t border-border bg-card/90 px-6 py-4">
            <Button
              type="button"
              variant="outline"
              onClick={() => onEdit?.(item)}
            >
              <Edit2 className="size-4" aria-hidden="true" />
              <span>Edit</span>
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={() => onDelete?.(item)}
            >
              <Trash2 className="size-4" aria-hidden="true" />
              <span>Trash</span>
            </Button>
          </SheetFooter>
        )}

        <ZoomLightbox
          open={lightboxOpen}
          images={photos}
          initialIndex={safePhotoIndex}
          title={item.item}
          onClose={() => setLightboxOpen(false)}
        />
      </SheetContent>
    </Sheet>
  );
}
