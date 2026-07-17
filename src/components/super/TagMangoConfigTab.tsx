import { useEffect, useState, useCallback } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
// Collapsible removed — webhook setup is now inline
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import {
  Eye, EyeOff, Copy, Check, Save, Loader2, Webhook,
  Activity, UserCheck, UserPlus, AlertTriangle, RefreshCw, MapPin, BookOpen,
} from 'lucide-react';
import { toast } from 'sonner';
import {
  getTagMangoConfig, saveTagMangoConfig, getTagMangoSyncLog,
  testTagMangoConnection, registerTagMangoWebhook, bulkTagMangoEnroll,
  GetTagMangoSyncLogOutputType, GetTagMangoConfigOutputType, BulkTagMangoEnrollOutputType,
} from 'zite-endpoints-sdk';
import { ASHRAY_LEVELS } from '@/types/enums';
import { fmt } from '@/lib/fmt';

type SyncRecord = GetTagMangoSyncLogOutputType['records'][0];
type SyncStats = GetTagMangoSyncLogOutputType['stats'];
type Residency = GetTagMangoConfigOutputType['residencies'][0];

// Per-center course config: { "CenterName": { "Jigyasa": "mangoId", ... } }
type CourseConfig = Record<string, Record<string, string>>;

export default function TagMangoConfigTab() {
  const [loading, setLoading] = useState(true);
  const [apiKey, setApiKey] = useState('');
  const [apiUrl, setApiUrl] = useState('');
  const [courseConfig, setCourseConfig] = useState<CourseConfig>({});
  const [residencies, setResidencies] = useState<Residency[]>([]);
  const [envKeyConfigured, setEnvKeyConfigured] = useState(false);
  const [showKey, setShowKey] = useState(false);
  const [copied, setCopied] = useState(false);
  const [savingApi, setSavingApi] = useState(false);
  const [savingCourses, setSavingCourses] = useState(false);

  // Sync log state
  const [syncRecords, setSyncRecords] = useState<SyncRecord[]>([]);
  const [syncStats, setSyncStats] = useState<SyncStats>({ total: 0, matched: 0, newUsers: 0, errors: 0 });
  const [syncLoading, setSyncLoading] = useState(true);
  const [syncHasMore, setSyncHasMore] = useState(false);
  const [syncOffset, setSyncOffset] = useState(0);
  const [loadingMore, setLoadingMore] = useState(false);

  useEffect(() => {
    getTagMangoConfig({}).then(res => {
      setApiKey(res.apiKey);
      setApiUrl(res.apiUrl);
      setCourseConfig(res.courseConfig);
      setResidencies(res.residencies);
      setEnvKeyConfigured(res.envKeyConfigured);
    }).catch(() => toast.error('Failed to load TagMango config'))
      .finally(() => setLoading(false));
  }, []);

  const loadSyncLog = useCallback(async (offset = 0, append = false) => {
    if (!append) setSyncLoading(true);
    else setLoadingMore(true);
    try {
      const res = await getTagMangoSyncLog({ limit: 50, offset });
      setSyncRecords(prev => append ? [...prev, ...res.records] : res.records);
      setSyncStats(res.stats);
      setSyncHasMore(res.hasMore);
      setSyncOffset(offset + res.records.length);
    } catch { toast.error('Failed to load sync log'); }
    finally { setSyncLoading(false); setLoadingMore(false); }
  }, []);

  useEffect(() => { loadSyncLog(); }, [loadSyncLog]);

  const handleCopy = () => {
    navigator.clipboard.writeText(apiKey);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleSaveApi = async () => {
    setSavingApi(true);
    try {
      await saveTagMangoConfig({ apiKey, apiUrl });
      toast.success('API configuration saved');
    } catch { toast.error('Failed to save API configuration'); }
    finally { setSavingApi(false); }
  };

  const handleSaveCourses = async () => {
    setSavingCourses(true);
    try {
      await saveTagMangoConfig({ courseConfig });
      toast.success('Course ID mappings saved');
    } catch { toast.error('Failed to save course mappings'); }
    finally { setSavingCourses(false); }
  };

  const updateCourseId = (centerName: string, level: string, value: string) => {
    setCourseConfig(prev => ({
      ...prev,
      [centerName]: {
        ...(prev[centerName] || {}),
        [level]: value,
      },
    }));
  };

  // Count how many courses are mapped for a given center
  const mappedCount = (centerName: string) =>
    Object.values(courseConfig[centerName] || {}).filter(v => v.trim()).length;

  if (loading) {
    return (
      <div className="py-12 text-center text-muted-foreground flex items-center justify-center gap-2">
        <Loader2 className="w-4 h-4 animate-spin" /> Loading configuration…
      </div>
    );
  }

  const isConfigured = apiKey.length > 0 || envKeyConfigured;

  return (
    <div className="space-y-6">
      {/* Section A — API Configuration */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div>
              <CardTitle>API Configuration</CardTitle>
              <CardDescription>Configure your TagMango API credentials</CardDescription>
            </div>
            <ApiStatusBadge isConfigured={isConfigured} apiKey={apiKey} envKeyConfigured={envKeyConfigured} />
          </div>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="space-y-2">
            <Label htmlFor="api-key">TagMango API Key</Label>
            <div className="flex gap-2">
              <div className="relative flex-1">
                <Input
                  id="api-key"
                  type={showKey ? 'text' : 'password'}
                  value={apiKey}
                  onChange={e => setApiKey(e.target.value)}
                  placeholder="Enter your TagMango API key…"
                  className="font-mono pr-10"
                />
                <button
                  type="button"
                  onClick={() => setShowKey(v => !v)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                >
                  {showKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
              <Button variant="outline" size="icon" onClick={handleCopy} disabled={!apiKey} title="Copy to clipboard">
                {copied ? <Check className="w-4 h-4 text-green-600" /> : <Copy className="w-4 h-4" />}
              </Button>
            </div>
            {envKeyConfigured && !apiKey && (
              <p className="text-xs text-muted-foreground">
                An API key is set via environment variable. You can override it here or leave blank to keep using the env var.
              </p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="api-url">API URL</Label>
            <Input
              id="api-url"
              value={apiUrl}
              onChange={e => setApiUrl(e.target.value)}
              placeholder="https://api-prod-new.tagmango.com/..."
              className="font-mono text-sm"
            />
          </div>

          <div className="flex gap-2 flex-wrap">
            <Button onClick={handleSaveApi} disabled={savingApi}>
              {savingApi ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Save className="w-4 h-4 mr-2" />}
              Save API Settings
            </Button>
            <TestConnectionButton apiKey={apiKey} />
          </div>
        </CardContent>
      </Card>

      {/* Section B — Per-Center Course ID Mapping */}
      <Card>
        <CardHeader>
          <CardTitle>Course ID Mapping (per Center)</CardTitle>
          <CardDescription>
            Map each Ashray level to its TagMango course ID (mangoId) for each folk center.
            Leave blank for levels that don't have a course.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {residencies.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4">No active folk residencies found.</p>
          ) : (
            <Accordion type="multiple" className="w-full">
              {residencies.map(center => (
                <AccordionItem key={center.id} value={center.id}>
                  <AccordionTrigger className="hover:no-underline">
                    <div className="flex items-center gap-2">
                      <MapPin className="w-4 h-4 text-primary shrink-0" />
                      <span className="font-medium">{center.name}</span>
                      {mappedCount(center.name) > 0 && (
                        <Badge variant="secondary" className="text-xs ml-1">
                          {mappedCount(center.name)} mapped
                        </Badge>
                      )}
                    </div>
                  </AccordionTrigger>
                  <AccordionContent>
                    <div className="grid gap-3 pt-1 pb-2">
                      {ASHRAY_LEVELS.map((level, i) => (
                        <div key={level} className="flex flex-col sm:flex-row sm:items-center gap-2">
                          <Label className="sm:w-52 shrink-0 text-sm">
                            <span className="text-muted-foreground mr-1.5">Level {i}</span>
                            <span className="font-medium">{level}</span>
                          </Label>
                          <Input
                            value={courseConfig[center.name]?.[level] || ''}
                            onChange={e => updateCourseId(center.name, level, e.target.value)}
                            placeholder={`mangoId for ${level}`}
                            className="font-mono text-sm"
                          />
                        </div>
                      ))}
                    </div>
                  </AccordionContent>
                </AccordionItem>
              ))}
            </Accordion>
          )}

          <Button onClick={handleSaveCourses} disabled={savingCourses}>
            {savingCourses ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Save className="w-4 h-4 mr-2" />}
            Save All Mappings
          </Button>
        </CardContent>
      </Card>

      {/* Section C — Webhook Configuration */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Webhook className="w-5 h-5 text-primary" />
            <div>
              <CardTitle>Webhook Configuration</CardTitle>
              <CardDescription>Receive automatic enrollment events from TagMango</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center gap-2 mb-2">
            <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
            <span className="text-sm font-medium text-green-700">Webhook endpoint is active</span>
          </div>

          <div className="rounded-lg border border-border bg-muted/30 p-4 space-y-2">
            <p className="text-sm font-medium">Event: <code className="text-xs bg-muted px-1.5 py-0.5 rounded">order.created.completed</code></p>
            <p className="text-xs text-muted-foreground">
              Enter your webhook URL below and click "Register" to automatically configure TagMango.
              Find the URL in the <strong>Webhooks settings tab</strong> (gear icon → Webhooks) after publishing.
            </p>
          </div>

          <RegisterWebhookSection />
        </CardContent>
      </Card>

      {/* Section C2 — Course Completion Webhooks */}
      <CourseWebhooksCard />

      {/* Section D — Bulk Enrollment */}
      <BulkEnrollCard />

      {/* Section E — Sync Log */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div>
              <CardTitle>Sync Log</CardTitle>
              <CardDescription>Recent TagMango webhook events</CardDescription>
            </div>
            <Button variant="outline" size="sm" onClick={() => loadSyncLog(0)} disabled={syncLoading}>
              <RefreshCw className={`w-3.5 h-3.5 mr-1.5 ${syncLoading ? 'animate-spin' : ''}`} />
              Refresh
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {syncLoading && syncRecords.length === 0 ? (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-20 rounded-lg" />
              ))}
            </div>
          ) : (
            <SyncStatsRow stats={syncStats} />
          )}

          {syncLoading && syncRecords.length === 0 ? (
            <div className="space-y-2">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-12 rounded" />
              ))}
            </div>
          ) : syncRecords.length === 0 ? (
            <div className="py-8 text-center text-muted-foreground text-sm">
              No sync events yet. Events will appear here once TagMango sends webhook notifications.
            </div>
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b">
                      <th className="text-left p-2 font-medium">Timestamp</th>
                      <th className="text-left p-2 font-medium">Name</th>
                      <th className="text-left p-2 font-medium">Email</th>
                      <th className="text-left p-2 font-medium">Mango Name</th>
                      <th className="text-right p-2 font-medium">Amount</th>
                      <th className="text-left p-2 font-medium">Event Type</th>
                      <th className="text-left p-2 font-medium">Status</th>
                      <th className="text-left p-2 font-medium">Matched</th>
                    </tr>
                  </thead>
                  <tbody>
                    {syncRecords.map(r => (
                      <tr key={r.id} className="border-b hover:bg-accent/50">
                        <td className="p-2 text-muted-foreground whitespace-nowrap">{r.timestamp ? fmt.dateFull(r.timestamp) : '—'}</td>
                        <td className="p-2 font-medium">{r.name || '—'}</td>
                        <td className="p-2 text-muted-foreground">{r.email || '—'}</td>
                        <td className="p-2">{r.mangoName || r.courseId || '—'}</td>
                        <td className="p-2 text-right tabular-nums">
                          {r.amountPaid != null ? `${r.currency || '₹'}${r.amountPaid}` : '—'}
                        </td>
                        <td className="p-2 text-xs">{r.eventType || 'Order'}</td>
                        <td className="p-2"><SyncStatusBadge status={r.syncStatus} /></td>
                        <td className="p-2 text-muted-foreground">{r.matchedUser ? '✓' : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {syncHasMore && (
                <div className="text-center pt-2">
                  <Button variant="outline" size="sm" onClick={() => loadSyncLog(syncOffset, true)} disabled={loadingMore}>
                    {loadingMore ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1.5" /> : null}
                    Load More
                  </Button>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function TestConnectionButton({ apiKey }: { apiKey: string }) {
  const [testing, setTesting] = useState(false);
  const [testKey, setTestKey] = useState('');
  const [showResult, setShowResult] = useState(false);
  const [result, setResult] = useState<{ success: boolean; message: string; data?: any } | null>(null);

  const handleTest = async () => {
    const keyToUse = testKey.trim() || apiKey;
    if (!keyToUse) { toast.error('Enter an API key to test'); return; }
    setTesting(true);
    setShowResult(false);
    setResult(null);
    try {
      const res = await testTagMangoConnection({ apiKey: keyToUse });
      setResult(res);
      setShowResult(true);
      if (res.success) toast.success(res.message);
      else toast.error(res.message);
    } catch { toast.error('Connection test failed'); }
    finally { setTesting(false); }
  };

  return (
    <div className="space-y-3 w-full">
      <div className="flex gap-2 items-end flex-wrap">
        <div className="flex-1 min-w-[200px] space-y-1">
          <Label htmlFor="test-api-key" className="text-xs">API Key to Test <span className="text-muted-foreground">(leave blank to use saved key)</span></Label>
          <Input
            id="test-api-key"
            type="password"
            value={testKey}
            onChange={e => setTestKey(e.target.value)}
            placeholder={apiKey ? 'Using saved key…' : 'Paste API key here…'}
            className="font-mono text-sm"
          />
        </div>
        <Button variant="outline" onClick={handleTest} disabled={testing}>
          {testing ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Activity className="w-4 h-4 mr-2" />}
          Test Connection
        </Button>
      </div>
      {showResult && result && (
        <div className={`rounded-lg border p-3 text-sm ${result.success ? 'border-green-300 bg-green-50 text-green-800' : 'border-destructive/30 bg-destructive/5 text-destructive'}`}>
          <p className="font-medium">{result.message}</p>
          {result.success && result.data && (
            <pre className="mt-2 text-xs bg-background/60 rounded p-2 overflow-x-auto max-h-48">{JSON.stringify(result.data, null, 2)}</pre>
          )}
        </div>
      )}
    </div>
  );
}

function RegisterWebhookSection() {
  const [url, setUrl] = useState('');
  const [registering, setRegistering] = useState(false);
  const handleRegister = async () => {
    if (!url.trim()) { toast.error('Enter a webhook URL first'); return; }
    setRegistering(true);
    try {
      const res = await registerTagMangoWebhook({ webhookUrl: url.trim() });
      if (res.success) toast.success(res.message);
      else toast.error(res.message);
    } catch { toast.error('Webhook registration failed'); }
    finally { setRegistering(false); }
  };
  return (
    <div className="flex gap-2 items-end flex-wrap">
      <div className="flex-1 min-w-[200px] space-y-1">
        <Label htmlFor="webhook-url" className="text-xs">Webhook URL</Label>
        <Input
          id="webhook-url"
          value={url}
          onChange={e => setUrl(e.target.value)}
          placeholder="https://your-app.zite.so/api/tagMangoWebhook/..."
          className="font-mono text-sm"
        />
      </div>
      <Button onClick={handleRegister} disabled={registering}>
        {registering ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Webhook className="w-4 h-4 mr-2" />}
        Register with TagMango
      </Button>
    </div>
  );
}

const COURSE_WEBHOOKS: { event: string; endpoint: string; label: string }[] = [
  { event: 'course.completed.10', endpoint: 'courseCompleted10', label: '10% Completed' },
  { event: 'course.completed.50', endpoint: 'courseCompleted50', label: '50% Completed' },
  { event: 'course.completed.100', endpoint: 'courseCompleted100', label: '100% Completed' },
];

function CourseWebhooksCard() {
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [registering, setRegistering] = useState(false);
  const [results, setResults] = useState<Record<string, { success: boolean; message: string }>>({});

  useEffect(() => {
    // Build webhook URLs from the current app URL pattern
    // Users need to find these in Webhooks settings after publishing
  }, []);

  const handleRegisterAll = async () => {
    // Need URLs for all 3 endpoints
    const missingUrls = COURSE_WEBHOOKS.filter(w => !urls[w.event]?.trim());
    if (missingUrls.length === COURSE_WEBHOOKS.length) {
      toast.error('Enter at least one webhook URL');
      return;
    }

    setRegistering(true);
    const newResults: Record<string, { success: boolean; message: string }> = {};

    for (const wh of COURSE_WEBHOOKS) {
      const url = urls[wh.event]?.trim();
      if (!url) {
        newResults[wh.event] = { success: false, message: 'No URL provided' };
        continue;
      }
      try {
        const res = await registerTagMangoWebhook({ webhookUrl: url, eventType: wh.event as any });
        newResults[wh.event] = res;
      } catch {
        newResults[wh.event] = { success: false, message: 'Registration failed' };
      }
    }

    setResults(newResults);
    const successCount = Object.values(newResults).filter(r => r.success).length;
    if (successCount > 0) toast.success(`${successCount} course webhook(s) registered`);
    if (successCount < COURSE_WEBHOOKS.length) {
      const failCount = COURSE_WEBHOOKS.filter(w => urls[w.event]?.trim() && !newResults[w.event]?.success).length;
      if (failCount > 0) toast.error(`${failCount} registration(s) failed`);
    }
    setRegistering(false);
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <BookOpen className="w-5 h-5 text-primary" />
          <div>
            <CardTitle>Course Completion Webhooks</CardTitle>
            <CardDescription>Register webhooks for course progress milestones (10%, 50%, 100%)</CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-xs text-muted-foreground">
          Find each endpoint's webhook URL in the <strong>Webhooks settings tab</strong> (gear icon → Webhooks) after publishing.
          Paste the URL for each milestone below, then click "Register All" to configure TagMango.
        </p>

        <div className="space-y-3">
          {COURSE_WEBHOOKS.map(wh => (
            <div key={wh.event} className="space-y-1.5">
              <div className="flex items-center gap-2">
                <Label className="text-sm font-medium">{wh.label}</Label>
                <code className="text-[10px] bg-muted px-1.5 py-0.5 rounded text-muted-foreground">{wh.event}</code>
                {results[wh.event] && (
                  <Badge
                    className={`text-[10px] ${results[wh.event].success
                      ? 'bg-green-100 text-green-800 border-green-300'
                      : 'bg-red-100 text-red-800 border-red-300'}`}
                  >
                    {results[wh.event].success ? '✓ Registered' : '✗ Failed'}
                  </Badge>
                )}
              </div>
              <Input
                value={urls[wh.event] || ''}
                onChange={e => setUrls(prev => ({ ...prev, [wh.event]: e.target.value }))}
                placeholder={`Webhook URL for ${wh.endpoint}…`}
                className="font-mono text-sm"
              />
              {results[wh.event] && !results[wh.event].success && (
                <p className="text-xs text-destructive">{results[wh.event].message}</p>
              )}
            </div>
          ))}
        </div>

        <Button onClick={handleRegisterAll} disabled={registering}>
          {registering ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Webhook className="w-4 h-4 mr-2" />}
          Register All with TagMango
        </Button>
      </CardContent>
    </Card>
  );
}

function BulkEnrollCard() {
  const [stats, setStats] = useState<BulkTagMangoEnrollOutputType | null>(null);
  const [loading, setLoading] = useState(false);
  const [enrolling, setEnrolling] = useState(false);

  useEffect(() => {
    setLoading(true);
    bulkTagMangoEnroll({ dryRun: true })
      .then(setStats)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const handleEnroll = async () => {
    setEnrolling(true);
    try {
      const res = await bulkTagMangoEnroll({ dryRun: false });
      setStats(res);
      toast.success(`Enrolled ${res.enrolled} users. ${res.failed} failed, ${res.skipped} skipped.`);
    } catch { toast.error('Bulk enrollment failed'); }
    finally { setEnrolling(false); }
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <UserPlus className="w-5 h-5 text-primary" />
          <div>
            <CardTitle>Bulk Enrollment</CardTitle>
            <CardDescription>Enroll all eligible active users who are not yet on TagMango</CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {loading ? (
          <Skeleton className="h-8 w-48" />
        ) : stats ? (
          <div className="flex items-center gap-3 text-sm text-muted-foreground flex-wrap">
            <span><strong className="text-foreground">{stats.eligible}</strong> eligible</span>
            <span>·</span>
            <span><strong className="text-green-600">{stats.enrolled}</strong> enrolled</span>
            <span>·</span>
            <span><strong className="text-destructive">{stats.failed}</strong> failed</span>
          </div>
        ) : null}

        {stats && stats.errors.length > 0 && (
          <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 space-y-1 max-h-40 overflow-y-auto">
            {stats.errors.map((e, i) => (
              <p key={i} className="text-xs text-destructive"><strong>{e.name}:</strong> {e.error}</p>
            ))}
          </div>
        )}

        <Button onClick={handleEnroll} disabled={enrolling || (stats?.eligible === 0)}>
          {enrolling ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <UserPlus className="w-4 h-4 mr-2" />}
          {enrolling ? 'Enrolling…' : 'Start Bulk Enrollment'}
        </Button>
      </CardContent>
    </Card>
  );
}

function ApiStatusBadge({ isConfigured, apiKey, envKeyConfigured }: { isConfigured: boolean; apiKey: string; envKeyConfigured: boolean }) {
  if (apiKey) return <Badge className="bg-green-100 text-green-800 border-green-300">✓ Configured</Badge>;
  if (envKeyConfigured) return <Badge variant="secondary">Using environment variable</Badge>;
  return <Badge variant="destructive">Not Configured</Badge>;
}

function SyncStatsRow({ stats }: { stats: SyncStats }) {
  const items = [
    { label: 'Total Synced', value: stats.total, icon: Activity, color: 'text-primary' },
    { label: 'Matched Users', value: stats.matched, icon: UserCheck, color: 'text-green-600' },
    { label: 'New Users', value: stats.newUsers, icon: UserPlus, color: 'text-blue-600' },
    { label: 'Errors', value: stats.errors, icon: AlertTriangle, color: 'text-destructive' },
  ];
  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
      {items.map(item => (
        <div key={item.label} className="rounded-lg border border-border p-3 space-y-1">
          <div className="flex items-center gap-1.5 text-muted-foreground">
            <item.icon className="w-3.5 h-3.5" />
            <span className="text-xs">{item.label}</span>
          </div>
          <p className={`text-2xl font-bold ${item.color}`}>{item.value}</p>
        </div>
      ))}
    </div>
  );
}

function SyncStatusBadge({ status }: { status?: string }) {
  if (!status) return <Badge variant="secondary">Unknown</Badge>;
  if (status === 'Matched to Existing User' || status === 'Synced')
    return <Badge className="bg-green-100 text-green-800 border-green-300 text-xs">{status}</Badge>;
  if (status === 'New User')
    return <Badge className="bg-blue-100 text-blue-800 border-blue-300 text-xs">{status}</Badge>;
  if (status === 'Error')
    return <Badge variant="destructive" className="text-xs">{status}</Badge>;
  return <Badge variant="secondary" className="text-xs">{status}</Badge>;
}
