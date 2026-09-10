import { useReactiveLoader } from '@/hooks/useReactiveLoader';
import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Mail, CheckCircle2, Clock, AlertTriangle, Zap, ShieldCheck, Settings, Plus, Trash2, Save, Sparkles, BellRing, Send, RefreshCw, Loader2 } from 'lucide-react';
import { sendPushNotifications, getPushSubscriptionStats, type GetPushSubscriptionStatsOutputType } from '@/lib/endpoints-sdk';
import { TimePicker } from '@/components/ui/time-picker';
import { toast } from 'sonner';
import {
  getPwNotificationConfig,
  savePwNotificationConfig,
  getDefaultSadhanaNotificationConfig,
  type PwSadhanaNotificationConfig,
} from '@/utils/sadhanaNotification';
import { useUserProfile } from '@/contexts/UserProfileContext';

const ROUNDS = [
  {
    round: 1 as const,
    label: 'Round 1 — Tonight Push',
    time: '9:00 PM IST',
    description: 'Direct device push nudge before sleeping',
    icon: '🌙',
  },
  {
    round: 2 as const,
    label: 'Round 2 — Early Morning Push',
    time: '4:45 AM IST',
    description: "Missed yesterday? Direct push alert",
    icon: '🌅',
  },
  {
    round: 3 as const,
    label: 'Round 3 — Final Push Alert',
    time: '9:15 AM IST',
    description: "Last chance device push alert for yesterday",
    icon: '🚨',
  },
];

function getSmartRound(): 1 | 2 | 3 {
  const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
  const istDate = new Date(Date.now() + IST_OFFSET_MS);
  const hour = istDate.getUTCHours();
  if (hour >= 0 && hour < 6) return 2;
  if (hour >= 6 && hour < 12) return 3;
  return 1;
}

function getISTTimeString(): string {
  const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
  const istDate = new Date(Date.now() + IST_OFFSET_MS);
  const h = istDate.getUTCHours();
  const m = istDate.getUTCMinutes();
  const ampm = h >= 12 ? 'PM' : 'AM';
  const displayH = h % 12 === 0 ? 12 : h % 12;
  const displayM = m.toString().padStart(2, '0');
  return `${displayH}:${displayM} ${ampm} IST`;
}

type RoundResult = {
  sent: number;
  skipped: number;
  date: string;
  recipients: { name: string; email: string }[];
};

interface SendRemindersPanelProps {
  segment?: 'PW' | 'FOLK';
}

export default function SendRemindersPanel({ segment: segmentProp }: SendRemindersPanelProps = {}) {
  const { profile } = useUserProfile();

  const isPw = segmentProp
    ? segmentProp === 'PW'
    : (
        profile?.segment === 'PW' ||
        (profile as any)?.isPrabhupadaWorldUser ||
        (profile as any)?.isPwAdmin ||
        (profile?.role as string)?.toUpperCase()?.includes('PW') ||
        !((profile?.role as string)?.toUpperCase()?.includes('FOLK') || profile?.segment === 'FOLK')
      );
  const activeSegment: 'PW' | 'FOLK' = isPw ? 'PW' : 'FOLK';

  const [confirmRound, setConfirmRound] = useState<1 | 2 | 3 | null>(null);
  const [smartConfirm, setSmartConfirm] = useState(false);
  const [loading, setLoading] = useState<1 | 2 | 3 | 'smart' | null>(null);
  const [results, setResults] = useState<Record<number, RoundResult>>({});

  const [config, setConfig] = useState<PwSadhanaNotificationConfig>(() =>
    getDefaultSadhanaNotificationConfig(activeSegment)
  );
  const [newTimeInput, setNewTimeInput] = useState('21:20');
  const [pushStats, setPushStats] = useState<GetPushSubscriptionStatsOutputType | null>(null);
  const [loadingPushStats, setLoadingPushStats] = useState(true);

  const fetchStats = useReactiveLoader(async (read) => {
    !read.background && !read.cancelled && setLoadingPushStats(true);
    try {
      const stats = await read(() => getPushSubscriptionStats({ segment: activeSegment }));
      !read.cancelled && setPushStats(stats);
    } catch {
      if (read.cancelled) return;
      !read.cancelled && setPushStats({ totalSubscriptions: 0, subscribers: [] });
    } finally {
      !read.cancelled && setLoadingPushStats(false);
    }
  }, []);

  useEffect(() => {
    fetchStats();
    // Fetch DB config on mount
    getPwNotificationConfig(activeSegment).then((cfg) => {
      setConfig(cfg);
    }).catch(() => {});
  }, [activeSegment]);

  const handleSaveConfig = async () => {
    try {
      const updated = await savePwNotificationConfig({
        ...config,
        updatedBy: profile?.fullName || profile?.userId || `${activeSegment} Admin`,
      }, activeSegment);
      setConfig(updated);
      toast.success(`${activeSegment} Sadhana Notification Settings saved! 🛡️`);
    } catch {
      toast.error(`Failed to save ${activeSegment} Sadhana Notification Settings`);
    }
  };

  const handleAddTimeSlot = () => {
    if (!newTimeInput || !/^\d{2}:\d{2}$/.test(newTimeInput)) {
      toast.error('Please enter a valid 24h time format (HH:MM)');
      return;
    }
    if (config.times.includes(newTimeInput)) {
      toast.error('Time slot already added');
      return;
    }
    const updatedTimes = [...config.times, newTimeInput].sort();
    setConfig((prev: PwSadhanaNotificationConfig) => ({ ...prev, times: updatedTimes }));
  };

  const handleRemoveTimeSlot = (timeToRemove: string) => {
    if (config.times.length <= 1) {
      toast.error('At least one notification time slot is required');
      return;
    }
    setConfig((prev: PwSadhanaNotificationConfig) => ({ ...prev, times: prev.times.filter((t: string) => t !== timeToRemove) }));
  };

  const DAYS_OF_WEEK = [
    { label: 'Sun', value: 0 },
    { label: 'Mon', value: 1 },
    { label: 'Tue', value: 2 },
    { label: 'Wed', value: 3 },
    { label: 'Thu', value: 4 },
    { label: 'Fri', value: 5 },
    { label: 'Sat', value: 6 },
  ];

  const toggleCustomDay = (dayValue: number) => {
    const currentDays = config.customDays || [0, 1, 2, 3, 4, 5, 6];
    let updatedDays: number[];
    if (currentDays.includes(dayValue)) {
      if (currentDays.length <= 1) {
        toast.error('Select at least one day for the custom schedule');
        return;
      }
      updatedDays = currentDays.filter(d => d !== dayValue);
    } else {
      updatedDays = [...currentDays, dayValue].sort();
    }
    setConfig(prev => ({ ...prev, customDays: updatedDays }));
  };

  const handleSend = async (round: 1 | 2 | 3, isSmart = false) => {
    setConfirmRound(null);
    setSmartConfirm(false);
    setLoading(isSmart ? 'smart' : round);
    const slotMap: Record<number, 'night-1' | 'night-2' | 'morning'> = {
      1: 'night-1',
      2: 'night-2',
      3: 'morning',
    };
    try {
      // 1. Instantly calculate subscriber count from DB before sending
      const stats = await getPushSubscriptionStats({ segment: activeSegment });
      setPushStats(stats);

      // 2. Dispatch notifications
      const res = await sendPushNotifications({
        reminderSlot: slotMap[round],
        customTitle: config.title,
        customBody: config.body,
        segment: activeSegment,
      });

      const nativeSent = Number(res.sent || 0);
      const inAppRecipients = Number(res.inAppRecipients || 0);
      if (nativeSent > 0 || inAppRecipients > 0) {
        toast.success(
          <div className="flex flex-col gap-1.5 text-sm leading-5">
            <span className="font-semibold">Sadhana reminder sent</span>
            <span className="text-xs text-muted-foreground">
              Native <strong className="text-foreground">{nativeSent}</strong> device{nativeSent === 1 ? '' : 's'} accepted
              <span className="mx-1.5">•</span>
              In-app <strong className="text-foreground">{inAppRecipients}</strong> user{inAppRecipients === 1 ? '' : 's'} reached
            </span>
          </div>,
          { duration: 10000 }
        );
      } else if (stats.totalSubscriptions > 0) {
        toast.warning(
          'Sadhana reminder: Native 0 devices accepted • In-app 0 users reached',
          { duration: 10000 }
        );
      } else {
        toast.info('No eligible members or subscribed devices were found. No notification was sent.', { duration: 8000 });
      }

      setResults(prev => ({
        ...prev,
        [round]: {
          sent: res.sent,
          skipped: res.skipped || res.failed,
          date: new Date().toISOString().slice(0, 10),
          recipients: [],
        },
      }));
    } catch (err: any) {
      toast.error(err?.message || 'Failed to send web push notifications');
    } finally {
      setLoading(null);
    }
  };

  const smartRound = getSmartRound();
  const smartRoundInfo = ROUNDS.find(r => r.round === smartRound)!;
  const pendingRound = ROUNDS.find(r => r.round === confirmRound);
  const isSmartLoading = loading === 'smart';

  const format24To12 = (t24: string) => {
    const [hStr, mStr] = t24.split(':');
    const h = parseInt(hStr || '0', 10);
    const m = mStr || '00';
    const ampm = h >= 12 ? 'PM' : 'AM';
    const displayH = h % 12 === 0 ? 12 : h % 12;
    return `${displayH}:${m} ${ampm}`;
  };

  return (
    <div className="space-y-6">
      {/* High-Visibility Instant Notification Banner */}
      <div className="rounded-xl border border-primary/40 bg-gradient-to-r from-primary/10 via-primary/5 to-background p-4 shadow-sm space-y-3">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="space-y-1.5 min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <Zap className="w-5 h-5 text-amber-500 fill-amber-500/20 animate-pulse" />
              <h3 className="text-base font-bold text-foreground truncate">Send Notification Instantly</h3>
              <Badge variant="outline" className="text-[10px] bg-amber-500/10 text-amber-600 border-amber-500/30 whitespace-nowrap">
                Instant Dispatch
              </Badge>
            </div>
            <p className="text-xs text-muted-foreground">
              Trigger a push notification immediately to all registered member devices who haven't submitted their Sadhana report today.
            </p>
          </div>
          <Button
            size="default"
            onClick={async () => {
              await fetchStats();
              setSmartConfirm(true);
            }}
            disabled={loading === 'smart'}
            className="bg-primary text-primary-foreground font-semibold gap-2 shadow-md hover:shadow-lg transition-all shrink-0 cursor-pointer"
          >
            {loading === 'smart' ? (
              <>
                <span className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" />
                Sending Instantly…
              </>
            ) : (
              <>
                <Send className="w-4 h-4" />
                Send Notification Instantly
              </>
            )}
          </Button>
        </div>
      </div>

      <Card className="border-primary/30 bg-primary/5">
        <CardHeader className="pb-3">
          <div className="flex items-center gap-2">
            <ShieldCheck className="w-5 h-5 text-primary" />
            <CardTitle className="text-base font-semibold">{activeSegment} Admin Notification Settings</CardTitle>
          </div>
          <CardDescription>
            Manage automatic Sadhana reminders, custom times, and instant notifications for {activeSegment} users.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between rounded-lg border border-border bg-background p-3.5 shadow-sm">
            <div className="space-y-0.5">
              <div className="flex items-center gap-2">
                <Settings className="w-4 h-4 text-primary" />
                <Label className="text-sm font-medium">Automatic Push Notifications</Label>
              </div>
              <p className="text-xs text-muted-foreground">
                {config.enabled
                  ? 'Enabled — Automatic reminders will run for users at configured custom times.'
                  : 'Disabled — All automated push reminders for users are currently paused.'}
              </p>
            </div>
            <Switch
              checked={config.enabled}
              onCheckedChange={(val) => setConfig((prev: PwSadhanaNotificationConfig) => ({ ...prev, enabled: val }))}
              aria-label="Toggle Sadhana Notifications"
            />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2 rounded-lg border border-border bg-background p-3.5">
              <Label className="text-sm font-medium flex items-center gap-1.5">
                <Clock className="w-4 h-4 text-primary" />
                Custom Reminder Times (IST)
              </Label>
              <div className="flex flex-wrap gap-2 pt-1">
                {config.times.map((t: string) => (
                  <Badge key={t} variant="secondary" className="px-2.5 py-1 text-xs flex items-center gap-1.5">
                    {format24To12(t)} ({t})
                    <button
                      type="button"
                      onClick={() => handleRemoveTimeSlot(t)}
                      className="text-muted-foreground hover:text-destructive transition-colors ml-0.5"
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </Badge>
                ))}
              </div>
              <div className="flex items-center gap-2 pt-2">
                <TimePicker
                  value={newTimeInput}
                  onChange={(val) => setNewTimeInput(val)}
                  className="w-32"
                />
                <Button size="sm" variant="outline" onClick={handleAddTimeSlot} className="h-8 text-xs gap-1">
                  <Plus className="w-3.5 h-3.5" /> Add Time
                </Button>
              </div>
            </div>

            <div className="space-y-2 rounded-lg border border-border bg-background p-3.5">
              <Label className="text-sm font-medium">Notification Frequency</Label>
              <Select
                value={config.frequency}
                onValueChange={(val: any) => setConfig((prev: PwSadhanaNotificationConfig) => ({ ...prev, frequency: val }))}
              >
                <SelectTrigger className="h-9 text-xs">
                  <SelectValue>
                    {config.frequency === 'daily'
                      ? 'Daily'
                      : config.frequency === 'weekdays'
                      ? 'Weekdays Only'
                      : 'Custom Schedule'}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="daily">Daily</SelectItem>
                  <SelectItem value="weekdays">Weekdays Only</SelectItem>
                  <SelectItem value="custom">Custom Schedule</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                Determines when users are alerted to fill their Sadhana form.
              </p>

              {config.frequency === 'custom' && (
                <div className="space-y-1.5 pt-2 border-t border-border mt-2">
                  <Label className="text-xs font-medium text-foreground">Select Custom Schedule Days</Label>
                  <div className="flex flex-wrap gap-1">
                    {DAYS_OF_WEEK.map((day) => {
                      const selected = (config.customDays || [0, 1, 2, 3, 4, 5, 6]).includes(day.value);
                      return (
                        <Button
                          key={day.value}
                          type="button"
                          size="sm"
                          variant={selected ? 'default' : 'outline'}
                          onClick={() => toggleCustomDay(day.value)}
                          className={`h-7 px-2.5 text-xs font-medium ${
                            selected
                              ? 'bg-primary text-primary-foreground font-semibold shadow-xs'
                              : 'text-muted-foreground hover:text-foreground'
                          }`}
                        >
                          {day.label}
                        </Button>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          </div>

          <div className="space-y-3 rounded-lg border border-border bg-background p-3.5">
            <div className="space-y-1">
              <Label className="text-xs font-medium">Notification Title</Label>
              <Input
                value={config.title}
                onChange={(e) => setConfig((prev: PwSadhanaNotificationConfig) => ({ ...prev, title: e.target.value }))}
                className="h-8 text-xs"
                placeholder="e.g. 📿 Sadhana Reminder"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs font-medium">Notification Message Body</Label>
              <Textarea
                value={config.body}
                onChange={(e) => setConfig((prev: PwSadhanaNotificationConfig) => ({ ...prev, body: e.target.value }))}
                className="text-xs min-h-[60px]"
                placeholder="Message body shown on user devices"
              />
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-end gap-3 pt-3 border-t border-border">
            <Button size="sm" onClick={handleSaveConfig} className="gap-1.5">
              <Save className="w-4 h-4" />
              Save Notification Settings
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Push Notification Subscribers List Card - ALWAYS VISIBLE */}
      <Card className="border-border shadow-xs">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <BellRing className="w-4 h-4 text-primary" />
              <CardTitle className="text-sm font-semibold">Push Notification Subscribers</CardTitle>
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={fetchStats}
                disabled={loadingPushStats}
                className="h-7 px-2 text-xs text-muted-foreground hover:text-foreground"
                title="Refresh subscriber list"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${loadingPushStats ? 'animate-spin' : ''}`} />
              </Button>
              <Badge variant="outline" className="text-xs bg-primary/10 text-primary border-primary/20 font-bold">
                {loadingPushStats ? 'Loading...' : `${pushStats?.totalSubscriptions || 0} Subscriptions`}
              </Badge>
            </div>
          </div>
          <CardDescription className="text-xs">
            {loadingPushStats
              ? 'Checking eligible push notification devices...'
              : `${pushStats?.subscribers?.length || 0} eligible subscribed device${(pushStats?.subscribers?.length || 0) === 1 ? '' : 's'} can receive Sadhana reminders`}
          </CardDescription>
        </CardHeader>
        <CardContent className="pt-0 space-y-2">
          {loadingPushStats ? (
            <div className="flex items-center gap-2 text-xs text-muted-foreground py-2">
              <Loader2 className="w-4 h-4 animate-spin text-primary" />
              Fetching subscriber devices...
            </div>
          ) : pushStats?.subscribers && pushStats.subscribers.length > 0 ? (
            <details className="text-xs border border-border rounded-lg p-3 bg-background shadow-xs" open>
              <summary className="cursor-pointer text-xs font-semibold text-foreground hover:text-primary transition-colors py-0.5">
                View eligible devices ({pushStats.subscribers.length})
              </summary>
              <div className="mt-2.5 space-y-1.5 max-h-56 overflow-y-auto pt-2 border-t border-border">
                {pushStats.subscribers.map((s: any, i: number) => (
                  <div key={i} className="flex items-center justify-between text-xs py-1.5 px-2.5 rounded-md bg-muted/40 border border-border">
                    <span className="font-medium text-foreground">{s.name || 'Registered Device'}</span>
                    <span className="text-muted-foreground text-[11px] font-mono">{s.email}</span>
                  </div>
                ))}
              </div>
            </details>
          ) : (
            <div className="text-xs text-muted-foreground py-2 border border-dashed rounded-lg p-3 text-center">
              No registered push notification devices found yet. Member users can subscribe from their Dashboard or Profile.
            </div>
          )}
        </CardContent>
      </Card>

      <AlertDialog open={smartConfirm} onOpenChange={setSmartConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <Zap className="w-5 h-5 text-primary animate-pulse" />
              Send Instant Web Push Broadcast
            </AlertDialogTitle>
            <AlertDialogDescription className="space-y-3">
              <p>
                This will trigger direct Web Push Notifications ONLY to the registered devices of active members who have not filled their Sadhana report today.
              </p>
              {loadingPushStats ? (
                <div className="rounded-lg bg-muted p-3 text-xs flex items-center gap-2">
                  <Loader2 className="w-4 h-4 animate-spin text-primary" />
                  Checking subscriber devices...
                </div>
              ) : (
                <div className={`rounded-lg p-3 text-xs border ${
                  (pushStats?.totalSubscriptions || 0) > 0
                    ? 'bg-amber-500/10 border-amber-500/20 text-amber-800 dark:text-amber-300'
                    : 'bg-destructive/10 border-destructive/20 text-destructive dark:text-red-400 font-medium'
                }`}>
                  {(pushStats?.totalSubscriptions || 0) > 0 ? (
                    <>
                      <strong>Maximum Target Audience:</strong> Up to {pushStats?.totalSubscriptions || 0} registered device(s). Members who already submitted today's Sadhana will be excluded.
                    </>
                  ) : (
                    <>
                      No registered push devices found. Members who have not submitted can still receive an in-app reminder while the app is open.
                    </>
                  )}
                </div>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => handleSend(1, true)}
              disabled={loadingPushStats}
              className="bg-primary hover:bg-primary/95 text-primary-foreground font-semibold"
            >
              Send Push Broadcast Now
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
