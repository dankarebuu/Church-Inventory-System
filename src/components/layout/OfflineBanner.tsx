import { WifiOff } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface OfflineBannerProps {
  isOffline: boolean;
  lastSyncedAt?: string | null;
  className?: string;
}

export interface OfflineNoticeProps {
  message: string;
  className?: string;
}

/**
 * Compact inline amber notice rendered on pages or drawers when offline so
 * users understand why mutation controls are disabled.
 */
export function OfflineNotice({ message, className }: OfflineNoticeProps) {
  return (
    <div
      role="status"
      className={cn(
        'no-print flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50/80 px-3 py-2 text-xs text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200',
        className
      )}
    >
      <WifiOff className="size-3.5 shrink-0" aria-hidden="true" />
      <span>{message}</span>
    </div>
  );
}

function formatLastSyncedTimestamp(iso: string | null | undefined): string | null {
  if (!iso || !iso.trim()) return null;
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return null;

  return parsed.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

/**
 * Amber view-only banner rendered at the top of `AppShell` whenever the device
 * is offline, surfacing the last synced catalog snapshot timestamp if present.
 */
export function OfflineBanner({
  isOffline,
  lastSyncedAt,
  className,
}: OfflineBannerProps) {
  if (!isOffline) return null;

  const formattedTime = formatLastSyncedTimestamp(lastSyncedAt);

  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        'no-print flex items-start gap-2.5 border-b border-amber-300/70 bg-amber-50/95 px-4 py-2.5 text-xs font-medium text-amber-950 dark:border-amber-500/30 dark:bg-amber-500/12 dark:text-amber-200 sm:items-center sm:px-6',
        className
      )}
    >
      <WifiOff className="mt-0.5 size-4 shrink-0 text-amber-700 dark:text-amber-300 sm:mt-0" aria-hidden="true" />
      <p className="leading-relaxed">
        Offline — View-Only Mode{formattedTime ? ` (last synced ${formattedTime})` : ''}. Edits,
        check-offs, loans, and comments will re-enable when back online.
      </p>
    </div>
  );
}
