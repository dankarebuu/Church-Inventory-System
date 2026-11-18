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
}

/**
 * Shared OK / Fix / Lost condition check-off button group used across Table,
 * Grid, and Detail Drawer views for authenticated Members and Admins.
 */
export function QuickCheckButtons({
  item,
  onQuickCheck,
  disabled = false,
  layout = 'inline',
}: QuickCheckButtonsProps) {
  return (
    <div
      className={cn(
        layout === 'grid' ? 'grid grid-cols-3 gap-1.5' : 'flex flex-wrap items-center gap-1.5'
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
              'font-mono text-[11px]',
              layout === 'grid' ? 'h-8 px-2' : 'h-7 px-2',
              isActive && action.activeClassName
            )}
          >
            <Icon className={layout === 'grid' ? 'size-3.5' : 'size-3'} aria-hidden="true" />
            <span>{action.label}</span>
          </Button>
        );
      })}
    </div>
  );
}
