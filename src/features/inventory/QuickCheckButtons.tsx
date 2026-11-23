import { Button } from '@/components/ui/button';
import type { EnrichedInventoryItem } from '@/features/inventory/useInventory';
import { cn } from '@/lib/utils';
import type { ItemCondition } from '@/types/database';
import { QUICK_CHECK_ACTIONS } from './inventoryUi';

export interface QuickCheckButtonsProps {
  item: EnrichedInventoryItem;
  onQuickCheck?: (item: EnrichedInventoryItem, condition: ItemCondition) => Promise<void> | void;
  disabled?: boolean;
  layout?: 'inline' | 'grid';
  size?: 'default' | 'checklist';
}

/**
 * Shared OK / Fix / Lost condition check-off button group used across Table,
 * Grid, Detail Drawer, and Sunday Checklist views for Members and Admins.
 */
export function QuickCheckButtons({
  item,
  onQuickCheck,
  disabled = false,
  layout = 'inline',
  size = 'default',
}: QuickCheckButtonsProps) {
  const isChecklistSize = size === 'checklist';

  return (
    <div
      className={cn(
        layout === 'grid'
          ? isChecklistSize
            ? 'grid grid-cols-3 gap-2'
            : 'grid grid-cols-3 gap-1.5'
          : 'flex flex-wrap items-center gap-1.5'
      )}
    >
      {QUICK_CHECK_ACTIONS.map((action) => {
        const Icon = action.icon;
        const isActive = item.condition === action.condition;

        return (
          <Button
            key={action.condition}
            type="button"
            size="sm"
            variant="outline"
            disabled={disabled}
            aria-label={action.ariaLabel}
            aria-pressed={isActive}
            onClick={() => void onQuickCheck?.(item, action.condition)}
            className={cn(
              'font-sans font-semibold transition-[transform,scale,background-color,border-color,color,box-shadow] duration-150 ease-out enabled:active:scale-[0.96]',
              isChecklistSize
                ? 'h-11 min-h-11 px-3 text-xs font-semibold'
                : cn('text-xs md:text-[11px]', layout === 'grid' ? 'h-9 px-2 md:h-8' : 'h-8 px-2.5 md:h-7 md:px-2'),
              isActive ? action.activeClassName : action.hoverClassName
            )}
          >
            <Icon
              className={isChecklistSize ? 'size-4' : layout === 'grid' ? 'size-3.5' : 'size-3'}
              aria-hidden="true"
            />
            <span>{action.label}</span>
          </Button>
        );
      })}
    </div>
  );
}
