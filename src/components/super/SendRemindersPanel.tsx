import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Mail, CheckCircle2, Clock, AlertTriangle, Zap } from 'lucide-react';
import { triggerSadhanaReminders } from 'zite-endpoints-sdk';
import { toast } from 'sonner';

const ROUNDS = [
  {
    round: 1 as const,
    label: 'Round 1 — Tonight',
    time: '9:00 PM IST',
    description: 'Gentle nudge to fill before sleeping',
    icon: '🌙',
  },
  {
    round: 2 as const,
    label: 'Round 2 — Early Morning',
    time: '4:45 AM IST',
    description: "Missed yesterday? Fill it now",
    icon: '🌅',
  },
  {
    round: 3 as const,
    label: 'Round 3 — Final',
    time: '9:15 AM IST',
    description: "Last chance for yesterday's entry",
    icon: '🚨',
  },
];

/** Pick the right round based on current IST time:
 *  6:00 AM – 11:59 PM  → Round 1 (evening reminder for today)
 *  12:00 AM – 5:59 AM  → Round 2 (early morning for yesterday)
 *  (Round 3 is always manual — it's a narrow 9:15 AM window)
 *
 *  Practical rule:
 *   hour 0–5   → Round 2  (middle of night / early morning)
 *   hour 6–11  → Round 3  (morning, last chance for yesterday)
 *   hour 12–23 → Round 1  (afternoon / evening, remind for today)
 */
function getSmartRound(): 1 | 2 | 3 {
  const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
  const istDate = new Date(Date.now() + IST_OFFSET_MS);
  const hour = istDate.getUTCHours(); // UTC hours of IST-shifted time
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

export default function SendRemindersPanel() {
  const [confirmRound, setConfirmRound] = useState<1 | 2 | 3 | null>(null);
  const [smartConfirm, setSmartConfirm] = useState(false);
  const [loading, setLoading] = useState<1 | 2 | 3 | 'smart' | null>(null);
  const [results, setResults] = useState<Record<number, RoundResult>>({});

  const handleSend = async (round: 1 | 2 | 3, isSmart = false) => {
    setConfirmRound(null);
    setSmartConfirm(false);
    setLoading(isSmart ? 'smart' : round);
    try {
      const result = await triggerSadhanaReminders({ round });
      setResults(prev => ({ ...prev, [round]: result }));
      toast.success(`Round ${round} sent — ${result.sent} email${result.sent !== 1 ? 's' : ''} delivered`);
    } catch (err: any) {
      toast.error(err?.message || 'Failed to send reminders');
    } finally {
      setLoading(null);
    }
  };

  const smartRound = getSmartRound();
  const smartRoundInfo = ROUNDS.find(r => r.round === smartRound)!;
  const pendingRound = ROUNDS.find(r => r.round === confirmRound);
  const isSmartLoading = loading === 'smart';

  return (
    <>
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Mail className="w-5 h-5 text-primary" />
              <CardTitle className="text-base">Sadhana Reminders</CardTitle>
            </div>
            {/* Smart Send Now button */}
            <Button
              size="sm"
              className="gap-1.5 shrink-0"
              disabled={isSmartLoading}
              onClick={() => setSmartConfirm(true)}
            >
              {isSmartLoading ? (
                <>
                  <span className="w-3 h-3 border-2 border-current border-t-transparent rounded-full animate-spin" />
                  Sending…
                </>
              ) : (
                <>
                  <Zap className="w-3.5 h-3.5" />
                  Send Now
                </>
              )}
            </Button>
          </div>
          <CardDescription>
            <strong>Send Now</strong> auto-picks the right round for the current IST time ({getISTTimeString()} → {smartRoundInfo.icon} {smartRoundInfo.label}).
            Or send a specific round manually below.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {ROUNDS.map(({ round, label, time, description, icon }) => {
            const result = results[round];
            const isLoading = loading === round;
            const isCurrentSmart = round === smartRound;

            return (
              <div
                key={round}
                className={`flex items-center justify-between gap-4 p-3 rounded-lg border bg-muted/30 ${isCurrentSmart ? 'border-primary/40 bg-primary/5' : 'border-border'}`}
              >
                <div className="flex items-start gap-3 min-w-0">
                  <span className="text-xl leading-none mt-0.5">{icon}</span>
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5">
                      <p className="text-sm font-medium truncate">{label}</p>
                      {isCurrentSmart && (
                        <Badge variant="secondary" className="text-[10px] px-1.5 py-0 h-4 font-normal">
                          Now
                        </Badge>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground">{description}</p>
                    <div className="flex items-center gap-1 mt-0.5">
                      <Clock className="w-3 h-3 text-muted-foreground" />
                      <span className="text-xs text-muted-foreground">{time}</span>
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  {result && (
                    <div className="flex items-center gap-1.5 text-xs">
                      <CheckCircle2 className="w-3.5 h-3.5 text-green-600" />
                      <span className="text-muted-foreground">
                        <span className="font-semibold text-foreground">{result.sent}</span> sent
                        {result.skipped > 0 && (
                          <span className="ml-1 text-destructive">({result.skipped} failed)</span>
                        )}
                      </span>
                    </div>
                  )}
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={isLoading || isSmartLoading}
                    onClick={() => setConfirmRound(round)}
                    className="shrink-0"
                  >
                    {isLoading ? (
                      <span className="flex items-center gap-1.5">
                        <span className="w-3 h-3 border-2 border-current border-t-transparent rounded-full animate-spin" />
                        Sending…
                      </span>
                    ) : result ? 'Resend' : 'Send'}
                  </Button>
                </div>
              </div>
            );
          })}

          {Object.keys(results).length > 0 && (
            <div className="pt-2 border-t border-border">
              <p className="text-xs font-medium text-muted-foreground mb-2">Recipients</p>
              <div className="flex flex-wrap gap-1.5">
                {Object.values(results).flatMap(r => r.recipients).map((rec, i) => (
                  <Badge key={i} variant="secondary" className="text-xs font-normal">
                    {rec.name || rec.email}
                  </Badge>
                ))}
                {Object.values(results).flatMap(r => r.recipients).length === 0 && (
                  <p className="text-xs text-muted-foreground flex items-center gap-1">
                    <CheckCircle2 className="w-3.5 h-3.5 text-green-600" />
                    All members have already submitted — no reminders needed!
                  </p>
                )}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Smart Send Now confirmation */}
      <AlertDialog open={smartConfirm} onOpenChange={open => !open && setSmartConfirm(false)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <Zap className="w-5 h-5 text-primary" />
              Send Now — {smartRoundInfo.icon} {smartRoundInfo.label}
            </AlertDialogTitle>
            <AlertDialogDescription>
              Based on the current time (<strong>{getISTTimeString()}</strong>), this will send{' '}
              <strong>{smartRoundInfo.label}</strong> reminders to all active members who haven't filled their Sadhana
              for {smartRound === 1 ? 'today' : 'yesterday'}.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => handleSend(smartRound, true)}>
              Send Reminders
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Manual round confirmation */}
      <AlertDialog open={confirmRound !== null} onOpenChange={open => !open && setConfirmRound(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <AlertTriangle className="w-5 h-5 text-amber-500" />
              Send {pendingRound?.label}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              This will send an email reminder to all active members who haven't filled their Sadhana
              for {pendingRound?.round === 1 ? 'today' : 'yesterday'}.
              Scheduled time: <strong>{pendingRound?.time}</strong>.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => confirmRound && handleSend(confirmRound)}>
              Send Reminders
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
