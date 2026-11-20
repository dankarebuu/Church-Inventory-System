import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';

export interface OnlineStatus {
  isOnline: boolean;
  isOffline: boolean;
}

function readNavigatorOnline(): boolean {
  if (typeof navigator === 'undefined') return true;
  return navigator.onLine !== false;
}

/**
 * Reactive browser connectivity hook tracking `navigator.onLine` and window
 * `online` / `offline` events. Automatically invalidates active TanStack Query
 * caches when transitioning `offline -> online` so stale views resync cleanly.
 */
export function useOnlineStatus(): OnlineStatus {
  const queryClient = useQueryClient();
  const [isOnline, setIsOnline] = useState<boolean>(readNavigatorOnline);
  const wasOnlineRef = useRef<boolean>(isOnline);

  useEffect(() => {
    const currentOnline = readNavigatorOnline();
    wasOnlineRef.current = currentOnline;
    setIsOnline(currentOnline);

    if (typeof window === 'undefined') return;

    const handleOffline = () => {
      wasOnlineRef.current = false;
      setIsOnline(false);
    };

    const handleOnline = () => {
      const transitionedFromOffline = !wasOnlineRef.current;
      wasOnlineRef.current = true;
      setIsOnline(true);

      if (transitionedFromOffline) {
        void queryClient.invalidateQueries();
      }
    };

    window.addEventListener('offline', handleOffline);
    window.addEventListener('online', handleOnline);

    return () => {
      window.removeEventListener('offline', handleOffline);
      window.removeEventListener('online', handleOnline);
    };
  }, [queryClient]);

  return {
    isOnline,
    isOffline: !isOnline,
  };
}
