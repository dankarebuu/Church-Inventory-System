import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import { App, createAppQueryClient } from './App';

const PRELOAD_RELOAD_KEY = 'steward:preload-reload-at';
const PRELOAD_RELOAD_COOLDOWN_MS = 15_000;

if (typeof window !== 'undefined') {
  window.addEventListener('vite:preloadError', (event) => {
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      return;
    }
    try {
      const lastReloadRaw = window.sessionStorage.getItem(PRELOAD_RELOAD_KEY);
      const lastReloadAt = lastReloadRaw ? Number(lastReloadRaw) : 0;
      const now = Date.now();
      if (Number.isFinite(lastReloadAt) && now - lastReloadAt < PRELOAD_RELOAD_COOLDOWN_MS) {
        return;
      }
      window.sessionStorage.setItem(PRELOAD_RELOAD_KEY, String(now));
    } catch {
      // Ignore storage failures and still attempt a single clean reload.
    }
    event.preventDefault();
    window.location.reload();
  });
}

const queryClient = createAppQueryClient();
const rootElement = document.getElementById('root');

if (rootElement) {
  createRoot(rootElement).render(
    <StrictMode>
      <App queryClient={queryClient} />
    </StrictMode>
  );
}
