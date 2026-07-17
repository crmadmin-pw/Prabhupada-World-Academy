import { useEffect, useState } from 'react';
import { Bell, X, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import {
  getNotificationPermission,
  requestNotificationPermission,
  subscribeToPush,
} from '@/utils/sadhanaNotification';

const DISMISS_KEY = 'push_banner_dismissed';

export default function PushNotificationBanner() {
  const [visible, setVisible] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    // Don't show if dismissed, unsupported, or already enabled
    if (localStorage.getItem(DISMISS_KEY)) return;
    if (typeof Notification === 'undefined' || !('PushManager' in window)) return;
    const perm = getNotificationPermission();
    if (perm === 'granted' || perm === 'denied') return;
    setVisible(true);
  }, []);

  if (!visible) return null;

  const handleEnable = async () => {
    setBusy(true);
    try {
      const perm = await requestNotificationPermission();
      if (perm === 'denied') {
        toast.error('Notifications blocked — you can unblock in browser settings');
        setVisible(false);
        return;
      }
      if (perm !== 'granted') { setBusy(false); return; }
      const ok = await subscribeToPush();
      if (ok) toast.success('Push notifications enabled! 🔔');
      else toast.error('Could not save subscription — try again from Profile');
      setVisible(false);
    } catch {
      toast.error('Something went wrong');
    } finally { setBusy(false); }
  };

  const handleDismiss = () => {
    localStorage.setItem(DISMISS_KEY, '1');
    setVisible(false);
  };

  return (
    <div className="mb-4 flex items-center gap-3 rounded-lg border border-primary/20 bg-primary/5 px-4 py-3">
      <Bell className="w-5 h-5 text-primary shrink-0" />
      <p className="flex-1 text-sm text-foreground">
        <span className="font-medium">Never miss your Sadhana</span>
        <span className="text-muted-foreground"> — enable push reminders to get notified at 9:20 PM & 10:20 PM!</span>
      </p>
      <Button size="sm" onClick={handleEnable} disabled={busy} className="shrink-0">
        {busy ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : null}
        Enable
      </Button>
      <button
        onClick={handleDismiss}
        className="text-muted-foreground hover:text-foreground transition-colors p-1 rounded"
        aria-label="Dismiss"
      >
        <X className="w-4 h-4" />
      </button>
    </div>
  );
}
