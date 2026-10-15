import { useReactiveEffect } from '@/hooks/useReactiveEffect';
import { useState, useEffect } from 'react';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Card, CardContent } from '@/components/ui/card';
import { toast } from 'sonner';
import {
  User, Phone, Mail, MapPin, Calendar, Heart, Shield,
  Award, MessageSquare, Clock, ArrowRight, CheckCircle2,
  Activity, DollarSign, ExternalLink, Plus
} from 'lucide-react';
import { getUserCrmData, getOneToOneMeetings } from '@/lib/endpoints-sdk';
import { observeEndpointReads } from '@/lib/app-endpoints-sdk';
import { calculateDevoteeHealth } from '@/utils/devoteeHealthUtils';
import LogInteractionModal from './LogInteractionModal';
import { fmt } from '@/lib/fmt';

interface DevoteeProfileData {
  id: string;
  userId?: string;
  fullName: string;
  email?: string;
  phoneNumber?: string;
  ashrayLevel?: string;
  residencyName?: string;
  guideName?: string;
  groupName?: string;
  isBvsl?: boolean;
  isSadhanaMentor?: boolean;
  isScholar?: boolean;
  sadhanaPercent?: number;
  attendancePercent?: number;
}

interface Props {
  open: boolean;
  onClose: () => void;
  devotee: DevoteeProfileData | null;
}

export default function Devotee360Drawer({ open, onClose, devotee }: Props) {
  const [loading, setLoading] = useState(false);
  const [crmData, setCrmData] = useState<any>(null);
  const [meetings, setMeetings] = useState<any[]>([]);
  const [logModalOpen, setLogModalOpen] = useState(false);

  useReactiveEffect((read) => {
    if (!devotee || !open) return;

    const loadData = async () => {
      try {
        !read.background && !read.cancelled && setLoading(true);
        const [crmRes, meetingRes] = await Promise.all([
          read(() => getUserCrmData({ userId: devotee.userId || devotee.id })).catch(() => null),
          read(() => getOneToOneMeetings({ userDbId: devotee.id })).catch(() => null),
        ]);
        !read.cancelled && setCrmData(crmRes);
        if (meetingRes?.meetings) {
          !read.cancelled && setMeetings(meetingRes.meetings);
        }
      } catch (err) {
        console.error('Failed to load 360 CRM data:', err);
      } finally {
        !read.cancelled && setLoading(false);
      }
    };

    loadData();
  }, [devotee, open]);

  if (!devotee) return null;

  const health = calculateDevoteeHealth({
    sadhanaCompliancePercent: devotee.sadhanaPercent ?? 80,
    attendancePercent: devotee.attendancePercent ?? 75,
    daysSinceLastOneToOne: meetings.length > 0 ? 7 : 21,
    hasOverdueRentOrTrips: (crmData?.pendingRentCorrections || 0) > 0,
  });

  const whatsappUrl = devotee.phoneNumber
    ? `https://wa.me/${devotee.phoneNumber.replace(/\D/g, '')}`
    : null;

  return (
    <>
      <Sheet open={open} onOpenChange={(val) => !val && onClose()}>
        <SheetContent className="w-full sm:max-w-xl p-0 flex flex-col overflow-hidden">
          {/* Top Header Card */}
          <div className="p-5 border-b bg-gradient-to-r from-slate-900 to-indigo-950 text-white shrink-0">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 rounded-full bg-indigo-500/30 border border-indigo-400/40 flex items-center justify-center text-white text-xl font-bold">
                  {devotee.fullName.charAt(0).toUpperCase()}
                </div>
                <div>
                  <h3 className="text-lg font-bold text-white flex items-center gap-2">
                    {devotee.fullName}
                  </h3>
                  <div className="flex items-center gap-2 mt-1 flex-wrap">
                    <Badge variant="outline" className="text-xs bg-white/10 text-white border-white/20">
                      {devotee.ashrayLevel || 'No Ashray'}
                    </Badge>
                    <Badge className={`text-xs border ${health.badgeClass}`}>
                      {health.label} ({health.score}%)
                    </Badge>
                  </div>
                </div>
              </div>
            </div>

            {/* Contact Action Pills */}
            <div className="flex items-center gap-2 mt-4 pt-3 border-t border-white/10">
              {devotee.phoneNumber && (
                <a
                  href={`tel:${devotee.phoneNumber}`}
                  className="inline-flex items-center gap-1.5 text-xs bg-white/10 hover:bg-white/20 text-white px-3 py-1.5 rounded-md transition"
                >
                  <Phone className="w-3.5 h-3.5" />
                  Call
                </a>
              )}
              {whatsappUrl && (
                <a
                  href={whatsappUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1.5 text-xs bg-emerald-600/80 hover:bg-emerald-600 text-white px-3 py-1.5 rounded-md transition"
                >
                  <MessageSquare className="w-3.5 h-3.5" />
                  WhatsApp
                </a>
              )}
              <Button
                size="sm"
                variant="secondary"
                className="ml-auto text-xs gap-1 h-8 bg-indigo-500 text-white hover:bg-indigo-600 border-none"
                onClick={() => setLogModalOpen(true)}
              >
                <Plus className="w-3.5 h-3.5" />
                Log Touchpoint
              </Button>
            </div>
          </div>

          {/* Drawer Body Tabs */}
          <div className="flex-1 overflow-y-auto p-5">
            <Tabs defaultValue="overview" className="w-full">
              <TabsList className="grid grid-cols-4 mb-4">
                <TabsTrigger value="overview" className="text-xs">Overview</TabsTrigger>
                <TabsTrigger value="timeline" className="text-xs">Timeline</TabsTrigger>
                <TabsTrigger value="interactions" className="text-xs">Touchpoints</TabsTrigger>
                <TabsTrigger value="financials" className="text-xs">Dues & Ops</TabsTrigger>
              </TabsList>

              {/* TAB 1: Overview */}
              <TabsContent value="overview" className="space-y-4">
                <Card>
                  <CardContent className="p-4 space-y-3">
                    <h4 className="text-xs font-bold text-muted-foreground uppercase tracking-wider">
                      Contact & Residency Details
                    </h4>
                    <div className="grid grid-cols-2 gap-3 text-xs">
                      <div>
                        <span className="text-muted-foreground block">Email</span>
                        <span className="font-medium text-foreground">{devotee.email || 'N/A'}</span>
                      </div>
                      <div>
                        <span className="text-muted-foreground block">Phone</span>
                        <span className="font-medium text-foreground">{devotee.phoneNumber || 'N/A'}</span>
                      </div>
                      <div>
                        <span className="text-muted-foreground block">Residency</span>
                        <span className="font-medium text-foreground">{devotee.residencyName || 'Non-Resident'}</span>
                      </div>
                      <div>
                        <span className="text-muted-foreground block">Assigned Guide</span>
                        <span className="font-medium text-foreground">{devotee.guideName || 'Unassigned'}</span>
                      </div>
                    </div>
                  </CardContent>
                </Card>

                {/* Health Score Breakdown */}
                <Card>
                  <CardContent className="p-4 space-y-2">
                    <h4 className="text-xs font-bold text-muted-foreground uppercase tracking-wider flex items-center justify-between">
                      <span>Devotee Engagement Index</span>
                      <span className={health.textColor}>{health.score}%</span>
                    </h4>
                    <div className="w-full bg-secondary h-2 rounded-full overflow-hidden">
                      <div
                        className={`h-full transition-all ${
                          health.level === 'HEALTHY'
                            ? 'bg-emerald-500'
                            : health.level === 'NEEDS_ATTENTION'
                            ? 'bg-amber-500'
                            : 'bg-rose-500'
                        }`}
                        style={{ width: `${health.score}%` }}
                      />
                    </div>
                    <ul className="text-xs space-y-1 mt-2">
                      {health.reasons.map((r, i) => (
                        <li key={i} className="flex items-center gap-1.5 text-muted-foreground">
                          <CheckCircle2 className="w-3.5 h-3.5 text-indigo-500 shrink-0" />
                          <span>{r}</span>
                        </li>
                      ))}
                    </ul>
                  </CardContent>
                </Card>
              </TabsContent>

              {/* TAB 2: Timeline */}
              <TabsContent value="timeline" className="space-y-3">
                <h4 className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-2">
                  Unified Devotee Activity Feed
                </h4>
                {loading ? (
                  <p className="text-xs text-muted-foreground py-4 text-center">Loading activity feed...</p>
                ) : (
                  <div className="relative pl-4 border-l-2 border-slate-200 dark:border-slate-800 space-y-4">
                    {/* Ashray Upgrades */}
                    {crmData?.ashrayHistory?.map((a: any) => (
                      <div key={a.id} className="relative">
                        <div className="absolute -left-[21px] top-0 w-3 h-3 rounded-full bg-indigo-500 ring-4 ring-background" />
                        <div className="text-xs font-semibold text-foreground">
                          Ashray Level: {a.requestedLevel || a.currentLevel} ({a.status})
                        </div>
                        <div className="text-[11px] text-muted-foreground">{a.createdAt ? fmt.date(a.createdAt) : ''}</div>
                      </div>
                    ))}

                    {/* 1-on-1 Meetings */}
                    {meetings.map((m: any) => (
                      <div key={m.id} className="relative">
                        <div className="absolute -left-[21px] top-0 w-3 h-3 rounded-full bg-purple-500 ring-4 ring-background" />
                        <div className="text-xs font-semibold text-foreground">
                          1-on-1 Touchpoint ({m.callStatus || 'Connected'})
                        </div>
                        <div className="text-xs text-muted-foreground mt-0.5">{m.notes}</div>
                        <div className="text-[11px] text-muted-foreground mt-1">{m.meetingDate}</div>
                      </div>
                    ))}

                    {(!crmData?.ashrayHistory?.length && !meetings.length) && (
                      <p className="text-xs text-muted-foreground py-2">No past timeline events recorded yet.</p>
                    )}
                  </div>
                )}
              </TabsContent>

              {/* TAB 3: Touchpoints */}
              <TabsContent value="interactions" className="space-y-3">
                <div className="flex items-center justify-between">
                  <h4 className="text-xs font-bold text-muted-foreground uppercase tracking-wider">
                    Past Interaction Logs
                  </h4>
                  <Button size="sm" variant="outline" className="text-xs h-7 gap-1" onClick={() => setLogModalOpen(true)}>
                    <Plus className="w-3 h-3" /> Log Touchpoint
                  </Button>
                </div>

                {meetings.map((m: any) => (
                  <Card key={m.id} className="p-3 text-xs space-y-1">
                    <div className="flex items-center justify-between font-semibold">
                      <span className="text-indigo-600 dark:text-indigo-400">{m.callStatus || 'Touchpoint'}</span>
                      <span className="text-muted-foreground text-[11px]">{m.meetingDate}</span>
                    </div>
                    <p className="text-foreground">{m.notes || 'No detailed notes'}</p>
                    {m.nextCallDate && (
                      <div className="text-[11px] text-amber-600 dark:text-amber-400 mt-1 font-medium">
                        🗓️ Next Follow-up: {m.nextCallDate}
                      </div>
                    )}
                  </Card>
                ))}

                {!meetings.length && (
                  <p className="text-xs text-muted-foreground py-4 text-center">No logged touchpoints yet.</p>
                )}
              </TabsContent>

              {/* TAB 4: Financials & Ops */}
              <TabsContent value="financials" className="space-y-3">
                <h4 className="text-xs font-bold text-muted-foreground uppercase tracking-wider">
                  Rent & Trip Dues Overview
                </h4>
                {crmData?.rentPayments?.map((r: any) => (
                  <div key={r.id} className="p-3 border rounded-lg text-xs flex items-center justify-between">
                    <div>
                      <div className="font-semibold text-foreground">Rent - {r.month}</div>
                      <div className="text-muted-foreground">Due: ₹{r.amountDue || 0} | Paid: ₹{r.amountPaid || 0}</div>
                    </div>
                    <Badge variant={r.status === 'Paid' ? 'secondary' : 'destructive'}>
                      {r.status || 'Pending'}
                    </Badge>
                  </div>
                ))}

                {(!crmData?.rentPayments?.length) && (
                  <p className="text-xs text-muted-foreground py-4 text-center">No rent/trips records found.</p>
                )}
              </TabsContent>
            </Tabs>
          </div>
        </SheetContent>
      </Sheet>

      {/* Log Interaction Modal */}
      <LogInteractionModal
        open={logModalOpen}
        onClose={() => setLogModalOpen(false)}
        onSuccess={() => {
          // reload crm meetings; the cached pre-save response is still marked fresh
          observeEndpointReads(() => getOneToOneMeetings({ userDbId: devotee.id }), () => {}, true).then((res) => {
            if (res?.meetings) setMeetings(res.meetings);
          });
        }}
        devoteeId={devotee.id}
        devoteeName={devotee.fullName}
      />
    </>
  );
}
