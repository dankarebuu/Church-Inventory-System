import { useState, type Dispatch, type SetStateAction } from 'react';
import type { RegisterSWOptions } from 'vite-plugin-pwa/types';

export type { RegisterSWOptions };

/**
 * Default Vitest mock for `virtual:pwa-register/react` so components mounting
 * `PwaUpdatePrompt` run cleanly without the Vite PWA build plugin loaded.
 */
export function useRegisterSW(_options?: RegisterSWOptions): {
  needRefresh: [boolean, Dispatch<SetStateAction<boolean>>];
  offlineReady: [boolean, Dispatch<SetStateAction<boolean>>];
  updateServiceWorker: (reloadPage?: boolean) => Promise<void>;
} {
  const needRefresh = useState(false);
  const offlineReady = useState(false);

  return {
    needRefresh,
    offlineReady,
    updateServiceWorker: async () => {},
  };
}
