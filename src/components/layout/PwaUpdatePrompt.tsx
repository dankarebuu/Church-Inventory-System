import { useState } from 'react';
import { RefreshCw, X } from 'lucide-react';
import { useRegisterSW } from 'virtual:pwa-register/react';
import { Button } from '@/components/ui/button';

/**
 * Non-intrusive Service Worker update toast prompting users to reload when a
 * newer production build of WINGMACC Gear is waiting to activate.
 */
export function PwaUpdatePrompt() {
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW();
  const [isUpdating, setIsUpdating] = useState(false);

  if (!needRefresh) return null;

  const handleReload = async () => {
    if (isUpdating) return;
    setIsUpdating(true);
    try {
      await updateServiceWorker(true);
    } catch {
      setIsUpdating(false);
    }
  };

  return (
    <div
      role="status"
      aria-live="polite"
      className="no-print fixed bottom-20 left-4 right-4 z-50 flex items-center justify-between gap-3 rounded-xl border border-primary/40 bg-card/95 p-3.5 text-card-foreground shadow-modal backdrop-blur-md sm:bottom-5 sm:left-auto sm:right-5 sm:w-96"
    >
      <div className="flex min-w-0 items-start gap-2.5">
        <span
          aria-hidden="true"
          className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/12 text-primary"
        >
          <RefreshCw className="size-4" />
        </span>
        <div className="min-w-0">
          <p className="font-display text-sm font-semibold text-foreground">Update Ready</p>
          <p className="text-xs text-muted-foreground">
            A newer version of WINGMACC Gear is available.
          </p>
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-1.5">
        <Button
          type="button"
          size="sm"
          disabled={isUpdating}
          onClick={() => void handleReload()}
        >
          {isUpdating ? 'Reloading...' : 'Reload'}
        </Button>
        <Button
          type="button"
          size="icon"
          variant="ghost"
          className="size-8 text-muted-foreground hover:text-foreground"
          aria-label="Dismiss update notification"
          disabled={isUpdating}
          onClick={() => setNeedRefresh(false)}
        >
          <X className="size-4" aria-hidden="true" />
        </Button>
      </div>
    </div>
  );
}
