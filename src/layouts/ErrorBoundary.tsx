import React from 'react';

const RELOAD_TS_KEY = 'folk_error_reload_ts';
const RELOAD_COOLDOWN_MS = 30_000;

async function nukeAndReload() {
  try {
    // Unregister all service workers
    if ('serviceWorker' in navigator) {
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.map(r => r.unregister()));
    }
    // Clear all caches
    if ('caches' in window) {
      const keys = await caches.keys();
      await Promise.all(keys.map(k => caches.delete(k)));
    }
  } catch { /* best-effort */ }

  // Clear app-specific storage caches
  try {
    for (const key of Object.keys(sessionStorage)) {
      if (key !== RELOAD_TS_KEY) sessionStorage.removeItem(key);
    }
    for (const key of Object.keys(localStorage)) {
      if (key.startsWith('pwa_') || key.startsWith('svc_') || key.startsWith('folk_cache_')) {
        localStorage.removeItem(key);
      }
    }
  } catch { /* best-effort */ }

  window.location.replace(window.location.origin + '?_bust=' + Date.now());
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export default class ErrorBoundary extends React.Component<{ children: React.ReactNode }, State> {
  state: State = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }

  componentDidCatch() {
    // Auto-reload once on first crash (with cooldown to prevent infinite loops)
    try {
      const lastReload = parseInt(sessionStorage.getItem(RELOAD_TS_KEY) ?? '0', 10);
      if (Date.now() - lastReload > RELOAD_COOLDOWN_MS) {
        sessionStorage.setItem(RELOAD_TS_KEY, String(Date.now()));
        nukeAndReload();
      }
    } catch { /* storage may be unavailable */ }
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen flex items-center justify-center p-4">
          <div className="text-center max-w-sm">
            <h2 className="text-xl font-semibold text-destructive mb-2">Something went wrong</h2>
            <p className="text-sm text-muted-foreground mb-4">
              {this.state.error?.message || 'An unexpected error occurred'}
            </p>
            <button
              className="px-4 py-2 rounded bg-primary text-primary-foreground"
              onClick={() => nukeAndReload()}
            >
              Reload App
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
