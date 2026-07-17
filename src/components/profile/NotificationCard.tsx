import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Bell, BellOff, BellRing, RefreshCw, AlertTriangle, Loader2 } from 'lucide-react';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { toast } from 'sonner';
import {
  getNotificationPermission,
  requestNotificationPermission,
  subscribeToPush,
  unsubscribeFromPush,
  checkPushSubscriptionStatus,
} from '@/utils/sadhanaNotification';

type Status = 'loading' | 'unsupported' | 'not-setup' | 'enabled' | 'not-saved' | 'blocked';

export default function NotificationCard() {
  const [status, setStatus] = useState<Status>('loading');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    checkStatus();
  }, []);

  const checkStatus = async () => {
    setStatus('loading');

    if (typeof Notification === 'undefined' || !('serviceWorker' in navigator) || !('PushManager' in window)) {
      setStatus('unsupported');
      return;
    }

    const perm = getNotificationPermission();
    if (perm === 'unsupported') { setStatus('unsupported'); return; }
    if (perm === 'denied') { setStatus('blocked'); return; }
    if (perm === 'default') { setStatus('not-setup'); return; }

    // Permission is granted — check if push sub exists
    const hasSub = await checkPushSubscriptionStatus();
    if (hasSub) {
      setStatus('enabled');
    } else {
      setStatus('not-saved');
    }
  };

  const handleEnable = async () => {
    setBusy(true);
    try {
      const perm = await requestNotificationPermission();
      if (perm === 'denied') { setStatus('blocked'); return; }
      if (perm !== 'granted') { toast.error('Permission not granted'); return; }

      const ok = await subscribeToPush();
      if (ok) {
        toast.success('Notifications enabled!');
        setStatus('enabled');
      } else {
        setStatus('not-saved');
        toast.error('Failed to save subscription');
      }
    } catch {
      toast.error('Something went wrong');
    } finally { setBusy(false); }
  };

  const handleRefresh = async () => {
    setBusy(true);
    try {
      const ok = await subscribeToPush();
      if (ok) toast.success('Subscription refreshed');
      else toast.error('Failed to refresh');
      await checkStatus();
    } finally { setBusy(false); }
  };

  const handleDisable = async () => {
    setBusy(true);
    try {
      await unsubscribeFromPush();
      toast.success('Notifications disabled');
      setStatus('not-setup');
    } catch {
      toast.error('Failed to disable');
    } finally { setBusy(false); }
  };

  const handleRetry = async () => {
    setBusy(true);
    try {
      const ok = await subscribeToPush();
      if (ok) {
        toast.success('Subscription saved!');
        setStatus('enabled');
      } else {
        toast.error('Still unable to save — try reloading the page');
      }
    } finally { setBusy(false); }
  };

  if (status === 'loading') {
    return (
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Bell className="w-4 h-4" /> Notifications
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="w-4 h-4 animate-spin" /> Checking…
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base flex items-center gap-2">
            <Bell className="w-4 h-4" /> Notifications
          </CardTitle>
          {status === 'enabled' && <Badge variant="secondary" className="text-xs bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400">Enabled ✅</Badge>}
          {status === 'not-saved' && <Badge variant="secondary" className="text-xs bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400">Not Saved ⚠️</Badge>}
          {status === 'blocked' && <Badge variant="secondary" className="text-xs bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400">Blocked ❌</Badge>}
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {status === 'unsupported' && (
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <BellOff className="w-4 h-4" />
              <span>Notifications are not supported in this browser.</span>
            </div>
            <p className="text-xs text-muted-foreground">Try using Chrome, Firefox, or Edge on desktop/Android for push notifications.</p>
          </div>
        )}

        {status === 'not-setup' && (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Get reminded to fill your Sadhana at 9:20 PM, 10:20 PM, and 7:40 AM.
            </p>
            <Button onClick={handleEnable} disabled={busy} className="w-full">
              {busy ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <BellRing className="w-4 h-4 mr-2" />}
              Enable Notifications
            </Button>
          </div>
        )}

        {status === 'enabled' && (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              You'll receive reminders at:
            </p>
            <ul className="text-sm space-y-1">
              <li className="flex items-center gap-2">
                <span className="text-primary font-medium">9:20 PM</span>
                <span className="text-muted-foreground text-xs">— First reminder</span>
              </li>
              <li className="flex items-center gap-2">
                <span className="text-primary font-medium">10:20 PM</span>
                <span className="text-muted-foreground text-xs">— Second reminder</span>
              </li>
              <li className="flex items-center gap-2">
                <span className="text-primary font-medium">7:40 AM</span>
                <span className="text-muted-foreground text-xs">— Morning deadline</span>
              </li>
            </ul>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={handleRefresh} disabled={busy}>
                {busy ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : <RefreshCw className="w-3 h-3 mr-1" />}
                Refresh
              </Button>
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button variant="outline" size="sm" className="text-destructive hover:text-destructive" disabled={busy}>
                    <BellOff className="w-3 h-3 mr-1" /> Disable
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Disable Notifications?</AlertDialogTitle>
                    <AlertDialogDescription>
                      You won't receive sadhana reminders anymore. You can re-enable anytime.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction onClick={handleDisable}>Disable</AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </div>
          </div>
        )}

        {status === 'not-saved' && (
          <div className="space-y-3">
            <div className="flex items-start gap-2 text-sm text-amber-600 dark:text-amber-400">
              <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
              <span>Permission granted but subscription wasn't saved. Notifications may not work from the server.</span>
            </div>
            <div className="text-xs text-muted-foreground space-y-1">
              <p><strong>Troubleshooting:</strong></p>
              <ul className="list-disc pl-4 space-y-0.5">
                <li>Refresh the page and try again</li>
                <li>Make sure you have a stable internet connection</li>
                <li>Try logging out and back in</li>
              </ul>
            </div>
            <Button onClick={handleRetry} disabled={busy} size="sm">
              {busy ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : <RefreshCw className="w-3 h-3 mr-1" />}
              Retry
            </Button>
          </div>
        )}

        {status === 'blocked' && (
          <div className="space-y-2">
            <div className="flex items-start gap-2 text-sm text-destructive">
              <BellOff className="w-4 h-4 mt-0.5 shrink-0" />
              <span>Notifications are blocked in your browser.</span>
            </div>
            <div className="text-xs text-muted-foreground space-y-1">
              <p><strong>To unblock:</strong></p>
              <ul className="list-disc pl-4 space-y-0.5">
                <li><strong>Chrome:</strong> Click the lock icon in the address bar → Site settings → Notifications → Allow</li>
                <li><strong>Safari:</strong> Settings → Notifications → Find this site → Allow</li>
                <li><strong>Android:</strong> Tap the ⋮ menu → Settings → Site settings → Notifications</li>
              </ul>
              <p className="mt-1">After unblocking, refresh this page.</p>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
