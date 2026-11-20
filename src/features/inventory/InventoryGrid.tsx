import { useMemo, useState } from 'react';
import {
  ChevronDown,
  Edit2,
  Eye,
  MapPin,
  MessageSquare,
  Package,
  Trash2,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { getCategoryColor } from '@/features/categories/useCategories';
import {
  DEFAULT_EQUIPMENT_TYPE_COLOR,
  getEquipmentTypeColor,
} from '@/features/equipmentTypes/useEquipmentTypes';
import type { EnrichedInventoryItem } from '@/features/inventory/useInventory';
import { cn, parseImages, trimOrNull } from '@/lib/utils';
import type {
  Category,
  EquipmentType,
  ItemCondition,
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

export type InventoryGroupBy = 'type' | 'rig';

export interface InventoryGridProps {
  items: readonly EnrichedInventoryItem[];
  role: UserRole;
  categories: readonly Category[];
  locations: readonly LocationRecord[];
  equipmentTypes?: readonly EquipmentType[];
  commentCounts?: Readonly<Record<string, number>>;
  groupBy?: InventoryGroupBy;
  selectionMode?: boolean;
  selectedIds?: ReadonlySet<string>;
  onToggleSelect?: (itemId: string) => void;
  onSelectItem: (item: EnrichedInventoryItem) => void;
  onQuickCheck?: (item: EnrichedInventoryItem, condition: ItemCondition) => void;
  onEdit?: (item: EnrichedInventoryItem) => void;
  onDelete?: (item: EnrichedInventoryItem) => void;
  isChecking?: boolean;
  isOffline?: boolean;
}

interface ItemGroup {
  key: string;
  label: string;
  color: string;
  sortOrder: number;
  isUnassigned?: boolean;
  items: EnrichedInventoryItem[];
}

const EMPTY_EQUIPMENT_TYPES: EquipmentType[] = [];
const EMPTY_COMMENT_COUNTS: Record<string, number> = {};
const UNASSIGNED_TYPE_KEY = '__unassigned_type__';

/**
 * Collapsible color-band card grid preserving WINGMACC's `.band` left accent
 * stripe, Equipment Type / Rig grouping, low-stock & comment indicators,
 * Admin multi-select checkboxes, and role-gated inline check-off & CRUD actions.
 */
export function InventoryGrid({
  items,
  role,
  categories,
  locations,
  equipmentTypes = EMPTY_EQUIPMENT_TYPES,
  commentCounts = EMPTY_COMMENT_COUNTS,
  groupBy = 'type',
  selectionMode = false,
  selectedIds,
  onToggleSelect,
  onSelectItem,
  onQuickCheck,
  onEdit,
  onDelete,
  isChecking = false,
  isOffline = false,
}: InventoryGridProps) {
  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>({});

  const canCheck = role === 'member' || role === 'admin';
  const canAdmin = role === 'admin';

  const groups = useMemo<ItemGroup[]>(() => {
    const map = new Map<string, ItemGroup>();

    if (groupBy === 'type') {
      const typeById = new Map(equipmentTypes.map((et) => [et.id, et]));
      const typeByLowerName = new Map(
        equipmentTypes.map((et) => [et.name.trim().toLowerCase(), et])
      );

      for (const item of items) {
        const matchedById = item.equipment_type_id
          ? typeById.get(item.equipment_type_id)
          : undefined;
        const textName = trimOrNull(item.equipment_type);
        const matchedByName =
          !matchedById && !item.equipment_type_id && textName
            ? typeByLowerName.get(textName.toLowerCase())
            : undefined;
        const matchedType = matchedById ?? matchedByName;

        let key: string;
        let label: string;
        let color: string;
        let sortOrder: number;
        let isUnassigned = false;

        if (matchedType) {
          key = matchedType.id;
          label = matchedType.name;
          color =
            matchedType.color ||
            getEquipmentTypeColor(matchedType.name, equipmentTypes, matchedType.id);
          sortOrder = matchedType.sort_order ?? 0;
        } else if (textName) {
          key = `name:${textName.toLowerCase()}`;
          label = textName;
          color = getEquipmentTypeColor(textName, equipmentTypes, item.equipment_type_id);
          sortOrder = 9998;
        } else {
          key = UNASSIGNED_TYPE_KEY;
          label = 'Unassigned Type';
          color = DEFAULT_EQUIPMENT_TYPE_COLOR;
          sortOrder = 99999;
          isUnassigned = true;
        }

        const existing = map.get(key);
        if (existing) {
          existing.items.push(item);
        } else {
          map.set(key, {
            key,
            label,
            color,
            sortOrder,
            isUnassigned,
            items: [item],
          });
        }
      }

      return [...map.values()].sort((a, b) => {
        if (Boolean(a.isUnassigned) !== Boolean(b.isUnassigned)) {
          return a.isUnassigned ? 1 : -1;
        }
        const orderDiff = a.sortOrder - b.sortOrder;
        if (orderDiff !== 0) return orderDiff;
        return a.label.localeCompare(b.label);
      });
    }

    for (const item of items) {
      const label = resolveCategoryName(item, categories);
      const matchedCat =
        (item.category_id ? categories.find((c) => c.id === item.category_id) : undefined) ??
        categories.find(
          (c) =>
            c.parent_id === null &&
            c.name.trim().toLowerCase() === label.trim().toLowerCase()
        );
      const key = matchedCat?.id ?? `name:${label.toLowerCase()}`;
      const color = getCategoryColor(label, categories, item.category_id);
      const sortOrder = matchedCat?.sort_order ?? 9999;

      const existing = map.get(key);
      if (existing) {
        existing.items.push(item);
      } else {
        map.set(key, {
          key,
          label,
          color,
          sortOrder,
          items: [item],
        });
      }
    }

    return [...map.values()].sort((a, b) => {
      const orderDiff = a.sortOrder - b.sortOrder;
      if (orderDiff !== 0) return orderDiff;
      return a.label.localeCompare(b.label);
    });
  }, [items, categories, equipmentTypes, groupBy]);

  const toggleGroup = (collapseKey: string) => {
    setCollapsedGroups((prev) => ({
      ...prev,
      [collapseKey]: !prev[collapseKey],
    }));
  };

  return (
    <div className="space-y-8">
      {groups.map((group) => {
        const collapseKey = `${groupBy}:${group.key}`;
        const isCollapsed = Boolean(collapsedGroups[collapseKey]);

        return (
          <section key={collapseKey} aria-label={`${group.label} equipment group`}>
            <button
              type="button"
              onClick={() => toggleGroup(collapseKey)}
              aria-expanded={!isCollapsed}
              className="group mb-3 flex w-full items-center gap-2.5 text-left transition-opacity hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-md py-1"
            >
              <span
                aria-hidden="true"
                className="size-2.5 shrink-0 rounded-full"
                style={{ backgroundColor: group.color }}
              />
              <h2 className="font-display text-sm font-semibold uppercase tracking-[0.06em] text-foreground">
                {group.label}
              </h2>
              <span className="font-mono text-xs text-muted-foreground">
                ({group.items.length})
              </span>
              <span className="h-px flex-1 bg-border" aria-hidden="true" />
              <ChevronDown
                className={cn(
                  'size-4 shrink-0 text-muted-foreground transition-transform duration-200',
                  isCollapsed && '-rotate-90'
                )}
                aria-hidden="true"
              />
            </button>

            {!isCollapsed && (
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
                {group.items.map((item) => {
                  const conditionMeta = CONDITION_META[item.condition];
                  const categoryName = resolveCategoryName(item, categories);
                  const categoryColor = getCategoryColor(
                    categoryName,
                    categories,
                    item.category_id
                  );
                  const subcategoryName = resolveSubcategoryName(item, categories);
                  const equipmentTypeName = resolveEquipmentTypeName(item, equipmentTypes);
                  const equipmentTypeColor = equipmentTypeName
                    ? getEquipmentTypeColor(
                        equipmentTypeName,
                        equipmentTypes,
                        item.equipment_type_id
                      )
                    : DEFAULT_EQUIPMENT_TYPE_COLOR;
                  const locationName = resolveLocationName(item, locations);
                  const photos = parseImages(item.image_filename);
                  const lowStock = isLowStock(item);
                  const commentCount =
                    role !== 'guest' ? (commentCounts[item.id] ?? 0) : 0;
                  const isSelected = Boolean(selectionMode && selectedIds?.has(item.id));

                  return (
                    <article
                      key={item.id}
                      onClick={() =>
                        selectionMode && onToggleSelect
                          ? onToggleSelect(item.id)
                          : onSelectItem(item)
                      }
                      className={cn(
                        'group relative flex cursor-pointer flex-col justify-between overflow-hidden rounded-xl border border-border bg-card p-4 pl-5 text-card-foreground shadow-card transition-all hover:border-border/80 hover:shadow-hover',
                        isSelected && 'border-primary/70 bg-primary/[0.03] ring-2 ring-primary/35'
                      )}
                    >
                      {/* WINGMACC color band */}
                      <div
                        aria-hidden="true"
                        className="band absolute inset-y-0 left-0 w-1.5"
                        style={{ backgroundColor: group.color }}
                      />

                      <div className="space-y-3">
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex min-w-0 flex-1 items-start gap-2.5">
                            {selectionMode && (
                              <div
                                className="pt-0.5"
                                onClick={(event) => event.stopPropagation()}
                              >
                                <input
                                  type="checkbox"
                                  checked={isSelected}
                                  onChange={() => onToggleSelect?.(item.id)}
                                  aria-label={`Select ${item.item}`}
                                  className="size-4 cursor-pointer rounded border-border accent-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                                />
                              </div>
                            )}

                            <div className="min-w-0 flex-1">
                              <h3 className="font-display truncate text-base font-semibold leading-snug text-foreground">
                                {item.item}
                              </h3>
                              <p className="mt-0.5 truncate font-mono text-[11px] text-muted-foreground">
                                {[
                                  item.brand,
                                  subcategoryName,
                                  item.serial ? `SN: ${item.serial}` : null,
                                ]
                                  .filter((part): part is string => Boolean(part && part.trim()))
                                  .join(' · ') || 'No brand or serial logged'}
                              </p>
                            </div>
                          </div>

                          <div className="flex shrink-0 flex-col items-end gap-1">
                            <Badge variant={conditionMeta.badgeVariant}>
                              {conditionMeta.label}
                            </Badge>
                            {item.qty_on_loan > 0 && <Badge variant="loaned">On Loan</Badge>}
                            {lowStock && <Badge variant="lowStock">Low Stock</Badge>}
                          </div>
                        </div>

                        {(equipmentTypeName || groupBy === 'type') && (
                          <div className="flex flex-wrap items-center gap-1.5">
                            {equipmentTypeName && (
                              <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-secondary/60 px-2 py-0.5 font-mono text-[10px] font-medium text-foreground">
                                <span
                                  aria-hidden="true"
                                  className="size-1.5 shrink-0 rounded-full"
                                  style={{ backgroundColor: equipmentTypeColor }}
                                />
                                <span className="max-w-[140px] truncate">
                                  {equipmentTypeName}
                                </span>
                              </span>
                            )}
                            {groupBy === 'type' && (
                              <span className="inline-flex items-center gap-1.5 rounded-full border border-border/70 bg-background/70 px-2 py-0.5 font-mono text-[10px] text-muted-foreground">
                                <span
                                  aria-hidden="true"
                                  className="size-1.5 shrink-0 rounded-full"
                                  style={{ backgroundColor: categoryColor }}
                                />
                                <span className="max-w-[140px] truncate">{categoryName}</span>
                              </span>
                            )}
                          </div>
                        )}

                        <div className="grid grid-cols-2 gap-2 rounded-lg bg-secondary/50 px-3 py-2 text-xs">
                          <div className="flex min-w-0 items-center gap-1.5">
                            <Package
                              className="size-3.5 shrink-0 text-muted-foreground"
                              aria-hidden="true"
                            />
                            <span className="text-muted-foreground">Avail:</span>
                            <span className="font-mono font-semibold text-foreground">
                              {`${item.available_qty} / ${item.qty}`}
                            </span>
                          </div>

                          <div className="flex min-w-0 items-center justify-end gap-1.5">
                            <MapPin
                              className="size-3.5 shrink-0 text-muted-foreground"
                              aria-hidden="true"
                            />
                            <span className="truncate font-medium text-foreground">
                              {locationName}
                            </span>
                          </div>
                        </div>

                        {item.remarks && (
                          <p className="line-clamp-2 text-xs leading-relaxed text-muted-foreground">
                            {item.remarks}
                          </p>
                        )}
                      </div>

                      <div
                        className="mt-4 space-y-2.5 border-t border-dashed border-border pt-3"
                        onClick={(event) => event.stopPropagation()}
                      >
                        {canCheck && (
                          <QuickCheckButtons
                            item={item}
                            onQuickCheck={onQuickCheck}
                            disabled={isChecking || isOffline}
                            layout="grid"
                          />
                        )}

                        <div className="flex items-center justify-between gap-2">
                          <div className="min-w-0 truncate font-mono text-[11px] text-muted-foreground">
                            {canCheck && item.checkedBy ? (
                              <span>
                                Checked {formatLastCheckedDate(item)} · {item.checkedBy}
                              </span>
                            ) : (
                              <span>Checked {formatLastCheckedDate(item)}</span>
                            )}
                          </div>

                          <div className="flex shrink-0 items-center gap-1">
                            {commentCount > 0 && (
                              <span
                                aria-label={`${commentCount} ${commentCount === 1 ? 'note' : 'notes'}`}
                                className="mr-0.5 inline-flex items-center gap-1 rounded bg-secondary px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground"
                              >
                                <MessageSquare className="size-3" aria-hidden="true" />
                                <span>{commentCount}</span>
                              </span>
                            )}

                            {photos.length > 0 && (
                              <span className="mr-1 rounded bg-secondary px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
                                {photos.length} img
                              </span>
                            )}

                            <Button
                              type="button"
                              size="icon"
                              variant="ghost"
                              className="size-8 text-muted-foreground hover:text-foreground"
                              aria-label={`View ${item.item}`}
                              title="View details"
                              onClick={() => onSelectItem(item)}
                            >
                              <Eye className="size-4" aria-hidden="true" />
                            </Button>

                            {canAdmin && (
                              <>
                                <Button
                                  type="button"
                                  size="icon"
                                  variant="ghost"
                                  className="size-8 text-muted-foreground hover:text-foreground"
                                  aria-label={`Edit ${item.item}`}
                                  title="Edit item"
                                  disabled={isOffline}
                                  onClick={() => onEdit?.(item)}
                                >
                                  <Edit2 className="size-4" aria-hidden="true" />
                                </Button>
                                <Button
                                  type="button"
                                  size="icon"
                                  variant="ghost"
                                  className="size-8 text-muted-foreground hover:text-destructive"
                                  aria-label={`Move ${item.item} to Trash`}
                                  title="Move to Trash"
                                  disabled={isOffline}
                                  onClick={() => onDelete?.(item)}
                                >
                                  <Trash2 className="size-4" aria-hidden="true" />
                                </Button>
                              </>
                            )}
                          </div>
                        </div>
                      </div>
                    </article>
                  );
                })}
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}
