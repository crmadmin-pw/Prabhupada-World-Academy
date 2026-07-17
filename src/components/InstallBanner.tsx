import { useEffect, useState } from 'react';
import { X, Download, Upload, Monitor, Smartphone } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useIsPwaMode } from '@/hooks/useIsPwaMode';

const DISMISS_KEY = 'folk_install_dismissed';

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
};

type Platform = 'ios-safari' | 'ios-other' | 'android' | 'desktop';

function detectPlatform(): Platform {
  const ua = navigator.userAgent;
  const isIOS = /iphone|ipad|ipod/i.test(ua);
  if (isIOS) {
    const isIOSSafari = !/CriOS|FxiOS|OPiOS|mercury/i.test(ua);
    return isIOSSafari ? 'ios-safari' : 'ios-other';
  }
  if (/android/i.test(ua)) return 'android';
  return 'desktop';
}

export default function InstallBanner() {
  const isPwaMode = useIsPwaMode();
  const [dismissed, setDismissed] = useState(() => !!localStorage.getItem(DISMISS_KEY));
  const [visible, setVisible] = useState(false);
  const [installPrompt, setInstallPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const platform = detectPlatform();

  // Delay showing so it doesn't distract on first load
  useEffect(() => {
    if (dismissed || isPwaMode) return;
    const t = setTimeout(() => setVisible(true), 4000);
    return () => clearTimeout(t);
  }, [dismissed, isPwaMode]);

  useEffect(() => {
    const handler = (e: Event) => { e.preventDefault(); setInstallPrompt(e as BeforeInstallPromptEvent); };
    window.addEventListener('beforeinstallprompt', handler);
    return () => window.removeEventListener('beforeinstallprompt', handler);
  }, []);

  const handleDismiss = () => {
    localStorage.setItem(DISMISS_KEY, '1');
    setDismissed(true);
  };

  const handleInstall = async () => {
    if (!installPrompt) return;
    await installPrompt.prompt();
    const { outcome } = await installPrompt.userChoice;
    if (outcome === 'accepted') { localStorage.setItem(DISMISS_KEY, '1'); setDismissed(true); }
    setInstallPrompt(null);
  };

  if (isPwaMode || dismissed || !visible) return null;
  // Don't show on iOS if not Safari — they can't install anyway
  if (platform === 'ios-other') return null;

  const hasNativePrompt = !!installPrompt;
  const canShowInstallBtn = (platform === 'android' || platform === 'desktop') && hasNativePrompt;

  return (
    <div className="fixed bottom-4 left-3 right-3 z-50 sm:left-auto sm:right-4 sm:bottom-5 sm:w-[340px] animate-in slide-in-from-bottom-4 duration-300">
      <div className="rounded-2xl border border-border bg-card shadow-lg p-4">
        <div className="flex items-start gap-3">
          {/* Icon */}
          <div className="w-11 h-11 rounded-xl bg-primary flex items-center justify-center shrink-0 mt-0.5">
            {platform === 'ios-safari' ? (
              <Upload className="w-5 h-5 text-primary-foreground" />
            ) : platform === 'android' ? (
              <Smartphone className="w-5 h-5 text-primary-foreground" />
            ) : (
              <Monitor className="w-5 h-5 text-primary-foreground" />
            )}
          </div>

          <div className="flex-1 min-w-0">
            {/* Header */}
            <div className="flex items-center justify-between gap-2 mb-1">
              <p className="font-semibold text-sm text-foreground">Install the App</p>
              <button
                onClick={handleDismiss}
                className="text-muted-foreground hover:text-foreground transition-colors rounded-full p-0.5 -mt-0.5 -mr-0.5"
                aria-label="Dismiss"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Instructions */}
            {platform === 'ios-safari' && (
              <div className="space-y-1.5">
                <p className="text-xs text-muted-foreground">Add to your home screen for the full app experience:</p>
                <div className="flex items-center gap-2 text-xs text-foreground">
                  <span className="flex items-center justify-center w-5 h-5 rounded-full bg-primary/10 text-primary font-bold shrink-0 text-[10px]">1</span>
                  <span>Tap the <span className="font-semibold">Share</span> button <span className="inline-flex items-center gap-0.5 font-medium text-primary">(<Upload className="w-3 h-3 inline" />)</span> in Safari</span>
                </div>
                <div className="flex items-center gap-2 text-xs text-foreground">
                  <span className="flex items-center justify-center w-5 h-5 rounded-full bg-primary/10 text-primary font-bold shrink-0 text-[10px]">2</span>
                  <span>Tap <span className="font-semibold">"Add to Home Screen"</span></span>
                </div>
              </div>
            )}

            {platform === 'android' && !hasNativePrompt && (
              <p className="text-xs text-muted-foreground">
                Tap the <span className="font-semibold">⋮ menu</span> in your browser, then choose <span className="font-semibold">"Add to Home Screen"</span> or <span className="font-semibold">"Install app"</span>.
              </p>
            )}

            {platform === 'android' && hasNativePrompt && (
              <p className="text-xs text-muted-foreground">
                Install for fast home screen access, offline support, and a native app feel.
              </p>
            )}

            {platform === 'desktop' && !hasNativePrompt && (
              <p className="text-xs text-muted-foreground">
                Click the <span className="font-semibold">install icon</span> in your browser's address bar to add this app to your desktop.
              </p>
            )}

            {platform === 'desktop' && hasNativePrompt && (
              <p className="text-xs text-muted-foreground">
                Install as a desktop app for faster access and a cleaner experience.
              </p>
            )}

            {/* Actions */}
            <div className="flex items-center gap-2 mt-3">
              {canShowInstallBtn && (
                <Button size="sm" className="h-7 text-xs gap-1.5" onClick={handleInstall}>
                  <Download className="w-3.5 h-3.5" />
                  Install
                </Button>
              )}
              <Button size="sm" variant="ghost" className="h-7 text-xs text-muted-foreground" onClick={handleDismiss}>
                {platform === 'ios-safari' ? 'Got it' : 'Not now'}
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
