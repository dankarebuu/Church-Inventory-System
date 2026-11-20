import { useEffect, useRef, useState } from 'react';
import {
  AlertCircle,
  ArrowLeftRight,
  Camera,
  ChevronLeft,
  ChevronRight,
  Edit2,
  ImageOff,
  Loader2,
  Maximize2,
  RotateCcw,
  Trash2,
} from 'lucide-react';
import { toast } from 'sonner';
import { OfflineNotice } from '@/components/layout/OfflineBanner';
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
import { ItemCommentsSection } from '@/features/comments/ItemCommentsSection';
import { getEquipmentTypeColor } from '@/features/equipmentTypes/useEquipmentTypes';
import type { EnrichedInventoryItem } from '@/features/inventory/useInventory';
import { isLoanOverdue } from '@/features/loans/schemas';
import { cn, formatDisplayDate, parseImages } from '@/lib/utils';
import type {
  Category,
  EquipmentType,
  ItemCondition,
  LoanRecord,
  LocationRecord,
  UserRole,
} from '@/types/database';
import {
  CONDITION_META,
  formatLastCheckedDate,
  isLowStock,
  resolveCategoryName,
  resolveEquipmentTypeName,
  resolveLocationName,
  resolveSubcategoryName,
} from './inventoryUi';
import { QuickCheckButtons } from './QuickCheckButtons';
import { MAX_GEAR_PHOTOS, validatePhotoFiles } from './schemas';
import { ZoomLightbox } from './ZoomLightbox';

export interface ItemDetailDrawerProps {
  item: EnrichedInventoryItem | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  role: UserRole;
  categories: readonly Category[];
  locations?: readonly LocationRecord[];
  equipmentTypes?: readonly EquipmentType[];
  onQuickCheck?: (item: EnrichedInventoryItem, condition: ItemCondition) => Promise<void> | void;
  isChecking?: boolean;
  onEdit?: (item: EnrichedInventoryItem) => void;
  onDelete?: (item: EnrichedInventoryItem) => void;
  onCheckout?: (item: EnrichedInventoryItem) => void;
  onReturnLoan?: (loan: LoanRecord, item: EnrichedInventoryItem) => void;
  returningLoanId?: string | null;
  onAddPhoto?: (item: EnrichedInventoryItem, file: File) => Promise<void> | void;
  isUploadingPhoto?: boolean;
  isOffline?: boolean;
}

const EMPTY_LOCATIONS: LocationRecord[] = [];
const EMPTY_EQUIPMENT_TYPES: EquipmentType[] = [];

/**
 * Slide-over equipment detail drawer with multi-photo carousel, ZoomLightbox
 * trigger, quick camera/photo upload, full specs, role-isolated loans & comments,
 * quick checks, and CRUD actions.
 */
export function ItemDetailDrawer({
  item,
  open,
  onOpenChange,
  role,
  categories,
  locations = EMPTY_LOCATIONS,
  equipmentTypes = EMPTY_EQUIPMENT_TYPES,
  onQuickCheck,
  isChecking = false,
  onEdit,
  onDelete,
  onCheckout,
  onReturnLoan,
  returningLoanId = null,
  onAddPhoto,
  isUploadingPhoto = false,
  isOffline = false,
}: ItemDetailDrawerProps) {
  const [photoIndex, setPhotoIndex] = useState(0);
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [photoUploadError, setPhotoUploadError] = useState<string | null>(null);
  const [lastItem, setLastItem] = useState<EnrichedInventoryItem | null>(item);
  const photoInputRef = useRef<HTMLInputElement | null>(null);

  if (item && item !== lastItem) {
    setLastItem(item);
  }

  const activeItem = item ?? lastItem;
  const isSheetOpen = Boolean(open && item);
  const photos = parseImages(activeItem?.image_filename);

  useEffect(() => {
    setPhotoIndex(0);
    setLightboxOpen(false);
    setPhotoUploadError(null);
  }, [item?.id, open]);

  const canCheck = role === 'member' || role === 'admin';
  const canAdmin = role === 'admin';
  const conditionMeta = activeItem ? CONDITION_META[activeItem.condition] : null;
  const categoryName = activeItem ? resolveCategoryName(activeItem, categories) : '';
  const subcategoryName = activeItem ? resolveSubcategoryName(activeItem, categories) : null;
  const locationName = activeItem ? resolveLocationName(activeItem, locations) : '';
  const equipmentTypeName = activeItem
    ? resolveEquipmentTypeName(activeItem, equipmentTypes)
    : null;
  const equipmentTypeColor =
    activeItem && equipmentTypeName
      ? getEquipmentTypeColor(equipmentTypeName, equipmentTypes, activeItem.equipment_type_id)
      : null;
  const lowStock = activeItem ? isLowStock(activeItem) : false;
  const categoryColor = activeItem
    ? getCategoryColor(categoryName, categories, activeItem.category_id)
    : '#64748b';
  const safePhotoIndex = Math.min(photoIndex, Math.max(photos.length - 1, 0));
  const currentPhoto = photos[safePhotoIndex] ?? null;
  const activeLoans = activeItem?.activeLoans ?? [];
  const canShowQuickPhoto = canCheck && photos.length < MAX_GEAR_PHOTOS;

  const stepPhoto = (delta: number) => {
    if (photos.length <= 1) return;
    setPhotoIndex((prev) => (prev + delta + photos.length) % photos.length);
  };

  const handleQuickPhotoSelected = async (
    event: React.ChangeEvent<HTMLInputElement>
  ) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file || !activeItem || !canCheck || isOffline || isUploadingPhoto) return;

    const validation = validatePhotoFiles([file], photos.length);
    if (!validation.valid) {
      const msg = validation.error ?? 'Invalid photo selection.';
      setPhotoUploadError(msg);
      toast.error(msg);
      return;
    }

    setPhotoUploadError(null);
    if (!onAddPhoto) return;
    try {
      await onAddPhoto(activeItem, file);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unable to upload photo.';
      setPhotoUploadError(msg);
    }
  };

  return (
    <Sheet open={isSheetOpen} onOpenChange={onOpenChange}>
      {activeItem && conditionMeta && (
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
              {activeItem.qty_on_loan > 0 && <Badge variant="loaned">On Loan</Badge>}
              {lowStock && <Badge variant="lowStock">Low Stock</Badge>}
            </div>

            <SheetTitle className="mt-1 text-xl">{activeItem.item}</SheetTitle>
            <SheetDescription>
              {[activeItem.brand, activeItem.serial ? `Serial: ${activeItem.serial}` : null]
                .filter((part): part is string => Boolean(part && part.trim()))
                .join(' · ') || 'WINGMACC Band Equipment Record'}
            </SheetDescription>
          </SheetHeader>

          <div className="flex-1 space-y-6 p-6">
            {isOffline && canCheck && (
              <OfflineNotice message="Offline read-only mode — condition checks, photos, loans, and edits are paused until connection returns." />
            )}

            {/* Multi-photo Carousel */}
            <div className="space-y-2.5">
              {currentPhoto ? (
                <div className="img-inset-outline group relative overflow-hidden rounded-xl border border-border bg-secondary/40">
                  <button
                    type="button"
                    onClick={() => setLightboxOpen(true)}
                    aria-label={`Open full preview of ${activeItem.item}`}
                    className="block w-full cursor-zoom-in focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <img
                      src={currentPhoto}
                      alt={`${activeItem.item} photo ${safePhotoIndex + 1}`}
                      className="h-56 w-full bg-black/5 object-contain dark:bg-black/30"
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
                        'img-inset-outline relative h-14 w-16 shrink-0 cursor-pointer overflow-hidden rounded-lg border transition-[border-color,opacity,box-shadow] duration-150 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                        idx === safePhotoIndex
                          ? 'border-primary ring-2 ring-primary/25'
                          : 'border-border opacity-75 hover:opacity-100'
                      )}
                    >
                      <img
                        src={url}
                        alt={`${activeItem.item} thumbnail ${idx + 1}`}
                        className="h-full w-full object-cover"
                      />
                    </button>
                  ))}
                </div>
              )}

              {canShowQuickPhoto && (
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono text-[11px] tabular-nums text-muted-foreground">
                      {photos.length} / {MAX_GEAR_PHOTOS} photos
                    </span>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={isUploadingPhoto || isOffline}
                      onClick={() => photoInputRef.current?.click()}
                    >
                      {isUploadingPhoto ? (
                        <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
                      ) : (
                        <Camera className="size-3.5" aria-hidden="true" />
                      )}
                      <span>{isUploadingPhoto ? 'Uploading...' : 'Take / Add Photo'}</span>
                    </Button>
                    <input
                      ref={photoInputRef}
                      type="file"
                      accept="image/*"
                      capture="environment"
                      className="hidden"
                      aria-label="Take or add equipment photo"
                      disabled={isUploadingPhoto || isOffline}
                      onChange={(event) => void handleQuickPhotoSelected(event)}
                    />
                  </div>
                  {photoUploadError && (
                    <div
                      role="alert"
                      className="flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive"
                    >
                      <AlertCircle className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
                      <span>{photoUploadError}</span>
                    </div>
                  )}
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
                  {activeItem.checkedBy && (
                    <span className="font-mono text-[11px] text-muted-foreground">
                      Checked by {activeItem.checkedBy} ·{' '}
                      {formatLastCheckedDate(activeItem)}
                    </span>
                  )}
                </div>
                <QuickCheckButtons
                  item={activeItem}
                  onQuickCheck={onQuickCheck}
                  disabled={isChecking || isOffline}
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
                  <dd className="mt-0.5 font-mono font-semibold tabular-nums text-foreground">
                    {`${activeItem.available_qty} / ${activeItem.qty}`} available
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
                  <dd className="mt-0.5 font-medium text-foreground">{activeItem.owner || '—'}</dd>
                </div>
                <div>
                  <dt className="font-mono text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                    Last Checked
                  </dt>
                  <dd className="mt-0.5 font-medium text-foreground">
                    {formatLastCheckedDate(activeItem)}
                  </dd>
                </div>
                <div>
                  <dt className="font-mono text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                    Equipment Type
                  </dt>
                  <dd className="mt-0.5 font-medium text-foreground">
                    {equipmentTypeName ? (
                      <span className="inline-flex items-center gap-1.5">
                        <span
                          aria-hidden="true"
                          className="size-2 shrink-0 rounded-full"
                          style={{ backgroundColor: equipmentTypeColor ?? undefined }}
                        />
                        <span>{equipmentTypeName}</span>
                      </span>
                    ) : (
                      '—'
                    )}
                  </dd>
                </div>
                {activeItem.min_qty !== null && activeItem.min_qty !== undefined && (
                  <div>
                    <dt className="font-mono text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                      Min Stock Alert
                    </dt>
                    <dd className="mt-0.5 flex flex-wrap items-center gap-2 font-mono font-semibold tabular-nums text-foreground">
                      <span>{activeItem.min_qty}</span>
                      {lowStock && <Badge variant="lowStock">Low Stock</Badge>}
                    </dd>
                  </div>
                )}
                {activeItem.description && (
                  <div className="col-span-2 border-t border-border pt-3">
                    <dt className="font-mono text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                      Description
                    </dt>
                    <dd className="mt-1 whitespace-pre-line text-sm text-foreground">
                      {activeItem.description}
                    </dd>
                  </div>
                )}
                {activeItem.remarks && (
                  <div className="col-span-2 border-t border-border pt-3">
                    <dt className="font-mono text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                      Remarks
                    </dt>
                    <dd className="mt-1 whitespace-pre-line text-sm text-foreground">
                      {activeItem.remarks}
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
                    disabled={activeItem.available_qty <= 0 || isOffline}
                    onClick={() => onCheckout?.(activeItem)}
                  >
                    <ArrowLeftRight className="size-3.5" aria-hidden="true" />
                    <span>Check Out</span>
                  </Button>
                )}
              </div>

              {!canCheck ? (
                <div className="rounded-xl border border-border bg-secondary/35 p-4 text-sm">
                  {activeItem.qty_on_loan > 0 ? (
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant="loaned">On Loan</Badge>
                      <span className="tabular-nums text-muted-foreground">
                        {activeItem.qty_on_loan}{' '}
                        {activeItem.qty_on_loan === 1 ? 'unit' : 'units'} currently checked out (
                        {activeItem.available_qty} available).
                      </span>
                    </div>
                  ) : (
                    <p className="tabular-nums text-muted-foreground">
                      {activeItem.qty > 0
                        ? `All ${activeItem.qty} ${activeItem.qty === 1 ? 'unit is' : 'units are'} available in storage.`
                        : '0 units logged in stock.'}
                    </p>
                  )}
                </div>
              ) : activeLoans.length === 0 ? (
                <div className="rounded-xl border border-dashed border-border bg-secondary/25 p-4 text-sm text-muted-foreground">
                  {activeItem.qty_on_loan > 0
                    ? `${activeItem.qty_on_loan} ${activeItem.qty_on_loan === 1 ? 'unit is' : 'units are'} currently on loan (${activeItem.available_qty} of ${activeItem.qty} available). Borrower details require a live connection.`
                    : `No active loans for this item. ${activeItem.available_qty} of ${activeItem.qty} available to check out.`}
                </div>
              ) : (
                <div className="space-y-2.5">
                  {activeLoans.map((loan) => {
                    const overdue = isLoanOverdue(loan.due_date, loan.returned_at);
                    const isReturningThisLoan = returningLoanId === loan.id;
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
                              disabled={isReturningThisLoan || isOffline}
                              onClick={() => onReturnLoan(loan, activeItem)}
                            >
                              {isReturningThisLoan ? (
                                <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
                              ) : (
                                <RotateCcw className="size-3.5" aria-hidden="true" />
                              )}
                              <span>{isReturningThisLoan ? 'Returning...' : 'Return'}</span>
                            </Button>
                          )}
                        </div>

                        <div className="flex flex-wrap gap-x-4 gap-y-1 font-mono text-[11px] text-muted-foreground">
                          <span>Out: {formatDisplayDate(loan.checked_out_at)}</span>
                          <span>
                            Due: {loan.due_date ? formatDisplayDate(loan.due_date) : 'No due date'}
                          </span>
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

            {/* Per-item Notes & Maintenance Log (Member & Admin only) */}
            {canCheck && (
              <div className="border-t border-border pt-6">
                <ItemCommentsSection itemId={activeItem.id} isOffline={isOffline} />
              </div>
            )}
          </div>

          {canAdmin && (
            <SheetFooter className="border-t border-border bg-card/90 px-6 py-4">
              <Button
                type="button"
                variant="outline"
                disabled={isOffline}
                onClick={() => onEdit?.(activeItem)}
              >
                <Edit2 className="size-4" aria-hidden="true" />
                <span>Edit</span>
              </Button>
              <Button
                type="button"
                variant="destructive"
                disabled={isOffline}
                onClick={() => onDelete?.(activeItem)}
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
            title={activeItem.item}
            onClose={() => setLightboxOpen(false)}
          />
        </SheetContent>
      )}
    </Sheet>
  );
}
