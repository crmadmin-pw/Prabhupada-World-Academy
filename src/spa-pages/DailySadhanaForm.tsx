import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ArrowLeft, Calendar, Save, BookOpen, Leaf, Send, AlertTriangle, Home, Loader2 } from 'lucide-react';
import { Checkbox } from '@/components/ui/checkbox';
import { toast } from 'sonner';
import { getSadhanaFormData, submitSadhana, setTemporaryResidency, getAllResidencies, getCleanlinessForSadhana, requestCleanlinessReview, GetSadhanaFormDataOutputType, GetAllResidenciesOutputType } from 'zite-endpoints-sdk';
const SADHANA_SUBMITTED_KEY_PREFIX = 'sadhana_submitted_';
import { markSubmittedToday, scheduleSadhanaReminder } from '@/utils/sadhanaNotification';
import { useDebouncedCallback } from 'use-debounce';
import { format, subDays } from 'date-fns';
import { fmt } from '@/lib/fmt';
import { useUserProfile } from '@/contexts/UserProfileContext';
import BvslPreachingSection, { BV_DURATION_KEYS } from '@/components/BvslPreachingSection';
import ScoringCriteriaPanel from '@/components/guide/ScoringCriteriaPanel';
import SadhanaFieldRenderer from '@/components/form/SadhanaFieldRenderer';
import NRScoringCriteria from '@/components/form/NRScoringCriteria';
import {
  normalizeFieldType, parseCriteria, isNRCriteria,
  calculateNRPoints, calculateResidentPoints, parseNumericValue,
  getTimeBucket, calculateTotalScore as calcScore, isFieldVisibleForUser,
  computeSingleFieldScore,
} from '@/lib/scoring';

type Field = GetSadhanaFormDataOutputType['fields'][0];

// SAD-C04 / SAD-H03: keys that are scored/required when sick or OS
const SICK_OS_SCORED_KEYS = new Set([
  'sp_reading', 'rounds', 'sp_reading_minutes', 'rounds_count', // resident
  'chanting', 'reading', // non-resident
]);

export default function DailySadhanaForm() {
  const navigate = useNavigate();
  const { profile } = useUserProfile();

  // Sadhana form always returns to the sadhana dashboard — regardless of role.
  // BVSL / Mentors also use the sadhana form and expect to land back on user dashboard.
  const getDashboardUrl = useCallback(() => '/user/dashboard', []);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [fields, setFields] = useState<Field[]>([]);
  const [userJoinDate, setUserJoinDate] = useState<string | undefined>();
  const [isResident, setIsResident] = useState(false);
  const [searchParams] = useSearchParams();
  const [templateMode, setTemplateMode] = useState('RESIDENT_TEMPLATE');
  const [entryDate, setEntryDate] = useState(searchParams.get('date') || format(new Date(), 'yyyy-MM-dd'));
  const [formValues, setFormValues] = useState<Record<string, any>>({});
  const [isEditMode, setIsEditMode] = useState(false);
  const [existingRowId, setExistingRowId] = useState<number | undefined>(undefined);
  const [existingEntryId, setExistingEntryId] = useState<string | undefined>(undefined);
  const [bvslValues, setBvslValues] = useState<Record<string, any>>({});
  const [durationInputs, setDurationInputs] = useState<Record<string, string>>({});
  const [activeTab, setActiveTab] = useState('sadhana');
  const [loadError, setLoadError] = useState(false);
  const editToastShownRef = useRef<string | null>(null);
  const lastTemplateModeRef = useRef<string | null>(null);
  // Temporary residency state
  const [isOfficialResident, setIsOfficialResident] = useState(false);
  const [tempResidencyEnabled, setTempResidencyEnabled] = useState(false);
  const [tempResidencyId, setTempResidencyId] = useState<string | null>(null);
  const [residencies, setResidencies] = useState<GetAllResidenciesOutputType>([]);
  const [tempSaving, setTempSaving] = useState(false);
  const [acknowledged, setAcknowledged] = useState(false);
  // Cleanliness manager tracking — auto-fill cleanliness field
  const [cleanlinessAutoFill, setCleanlinessAutoFill] = useState<{ enabled: boolean; score: number | null; pending: boolean; photo?: string | null; comment?: string | null; inspectionId?: string; roomId?: string; reviewStatus?: string | null }>({ enabled: false, score: null, pending: false });

  const userId = profile?.userId || '';
  const ashrayLevel = profile?.ashrayLevel || '';
  const [userRoleFromDb, setUserRoleFromDb] = useState<string | null>(null);
  const userRole = userRoleFromDb || profile?.role || 'USER';
  // P1-003 FIX: also check isBvsl flag from profile
  const isBvsl = userRole === 'BVSL' || !!(profile?.isBvsl);
  const residencyBucket = useMemo(() => getTimeBucket(userJoinDate, entryDate), [userJoinDate, entryDate]);

  const isSick = useMemo(() => {
    if (Array.isArray(formValues.flags)) return formValues.flags.includes('Sick');
    if (formValues.flag_sick === true || formValues.flag_sick === 1) return true;
    return false;
  }, [formValues]);

  const isOS = useMemo(() => {
    if (Array.isArray(formValues.flags)) return formValues.flags.includes('OS');
    if (formValues.flag_os === true || formValues.flag_os === 1) return true;
    return false;
  }, [formValues]);

  const isSickOrOs = isSick || isOS;

  const baseScoreResult = useMemo(
    () => calcScore({ fields: fields as any, values: formValues, ashrayLevel, entryDate, residencyBucket, isSickOrOs, isResident }),
    [fields, formValues, ashrayLevel, entryDate, residencyBucket, isSickOrOs, isResident]
  );

  // Resident report-sending: auto 1pt if same day, 0pt if backdated. Add to score display.
  const reportSendingPts = useMemo(() => {
    if (!isResident) return 0;
    const today = format(new Date(), 'yyyy-MM-dd');
    return entryDate === today ? 1 : 0;
  }, [isResident, entryDate]);

  const scoreResult = useMemo(() => {
    if (!isResident) return baseScoreResult; // NR: no report_sending
    // All resident entries (normal AND sick/OS) include report_sending
    const totalScore = baseScoreResult.totalScore + reportSendingPts;
    // Sick/OS max = 8 (rounds 4 + spReading 3 + reportSending 1)
    // Normal max = 20 (base 19 fields + reportSending 1)
    const maxScore = isSickOrOs ? 8 : (baseScoreResult.maxScore + 1);
    const scorePercent = maxScore > 0 ? Math.round((totalScore / maxScore) * 100) : null;
    return { totalScore, maxScore, scorePercent };
  }, [baseScoreResult, isResident, isSickOrOs, reportSendingPts]);

  const bvTotalMinutes = useMemo(() => {
    return BV_DURATION_KEYS.reduce((sum, key) => sum + (bvslValues[key] || 0), 0);
  }, [bvslValues]);

  const sickMaxScore = useMemo(() =>
    calcScore({ fields: fields as any, values: {}, ashrayLevel, entryDate, residencyBucket, isSickOrOs: true, isResident }).maxScore,
    // Note: sick/OS max is fixed at 20 by the scoring engine so no +1 needed here
    [fields, ashrayLevel, entryDate, residencyBucket, isResident]
  );

  // OPT-7: 150ms debounce (was 400ms) + skip field update if template unchanged
  const debouncedCheckEntry = useDebouncedCallback(async (date: string) => {
    if (!userId) return;
    try {
      setAcknowledged(false); // reset acknowledgement when date changes
      setDurationInputs({});
      const result = await getSadhanaFormData({ userId, entryDate: date });
      const newTemplate = result.templateMode ?? 'RESIDENT_TEMPLATE';
      // Only re-render fields if template actually changed (fields are static per template)
      if (lastTemplateModeRef.current !== newTemplate) {
        setFields(result.fields);
        lastTemplateModeRef.current = newTemplate;
      }
      setLoadError(false);
      setTemplateMode(newTemplate);
      setIsResident(result.isResident ?? false);
      setIsOfficialResident(result.isOfficialResident ?? false);
      setTempResidencyEnabled(result.tempResidencyEnabled ?? false);
      setTempResidencyId(result.tempResidencyId ?? null);
      if (result.userRole) setUserRoleFromDb(result.userRole);
      applyExisting(result, date, result.fields);
      // Re-check cleanliness auto-fill for the new date
      if (result.isResident && profile?.selectedFolkResidency) {
        getCleanlinessForSadhana({ userId, residencyId: profile.selectedFolkResidency, date })
          .then(res => {
            setCleanlinessAutoFill({ enabled: res.enabled, score: res.score ?? null, pending: res.pending ?? false, photo: res.photo, comment: res.comment, inspectionId: res.inspectionId, roomId: res.roomId, reviewStatus: res.reviewStatus });
            if (res.enabled) {
              setFormValues(prev => ({ ...prev, cleanliness: res.score ?? 0 }));
            }
          }).catch(() => {});
      }
    } catch { setLoadError(true); }
  }, 150);

  useEffect(() => {
    if (userId) loadFormData();
  }, [userId]);

  useEffect(() => {
    if (userId && !loading) debouncedCheckEntry(entryDate);
  }, [entryDate]);

  // Prefetch removed — getSadhanaFormData is fast from server cache; the
  // extra 2 calls on mount were wasted network/DB cost for rarely-used dates.

  // BACK-FIX: Intercept the browser's native back button (mobile/desktop).
  // On mobile, navigate(-1) is unreliable — it can land on auth redirect pages
  // or stale URL param entries (e.g. ?_v=...) which re-triggers login.
  // Instead, push the dashboard URL to history so back button lands there safely.
  useEffect(() => {
    // Push a dummy entry so the back button has somewhere to go
    window.history.pushState({ sadhanaForm: true }, '');

    const handlePopState = (e: PopStateEvent) => {
      // Intercept any popstate (back/forward) while on this form
      e.preventDefault();
      navigate(getDashboardUrl(), { replace: true });
    };

    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, [getDashboardUrl, navigate]);

  const loadFormData = async () => {
    if (!userId) return;
    try {
      const result = await getSadhanaFormData({ userId, entryDate });
      setFields(result.fields);
      setLoadError(false);
      setUserJoinDate(result.userJoinDate || result.residencyJoinDate);
      setTemplateMode(result.templateMode || 'RESIDENT_TEMPLATE');
      setIsResident(result.isResident ?? false);
      setIsOfficialResident(result.isOfficialResident ?? false);
      setTempResidencyEnabled(result.tempResidencyEnabled ?? false);
      setTempResidencyId(result.tempResidencyId ?? null);
      if (result.userRole) setUserRoleFromDb(result.userRole);
      applyExisting(result, entryDate, result.fields);
      // Only fetch residencies if user might need the temp-residency dropdown
      if (!result.isOfficialResident) {
        getAllResidencies({}).then(setResidencies).catch(() => {});
      }
      // Check cleanliness auto-fill for residents
      if (result.isResident && profile?.selectedFolkResidency) {
        getCleanlinessForSadhana({ userId, residencyId: profile.selectedFolkResidency, date: entryDate })
          .then(res => {
            setCleanlinessAutoFill({ enabled: res.enabled, score: res.score ?? null, pending: res.pending ?? false, photo: res.photo, comment: res.comment, inspectionId: res.inspectionId, roomId: res.roomId, reviewStatus: res.reviewStatus });
            if (res.enabled) {
              setFormValues(prev => ({ ...prev, cleanliness: res.score ?? 0 }));
            }
          }).catch(() => {});
      }
    } catch { setLoadError(true); toast.error('Failed to load form'); }
    finally { setLoading(false); }
  };

  // SAD-H04 FIX: accept fields to initialize number fields to 0
  const applyExisting = (result: { exists: boolean; entry?: any }, date: string, fieldsForInit?: Field[]) => {
    if (result.exists && result.entry) {
      setIsEditMode(true);
      setExistingRowId(result.entry.rowId);
      setExistingEntryId(result.entry.entryId);
      // Convert sleep_minutes from stored minutes-from-midnight back to HH:MM for time input
      const rawFv = { ...(result.entry.fieldValues || {}) };
      if (typeof rawFv.sleep_minutes === 'number' && rawFv.sleep_minutes > 0) {
        const h = Math.floor(rawFv.sleep_minutes / 60);
        const m = rawFv.sleep_minutes % 60;
        rawFv.sleep_minutes = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
      }
      // Clear stale '00:00' japa time so the form shows it as "not filled" rather than midnight
      if (rawFv.japa_finish_time === '00:00' || rawFv.japa_finish_time === '') {
        rawFv.japa_finish_time = '';
      }
      const currentFieldKeys = new Set((fieldsForInit || []).map((f: Field) => f.fieldKey));
      const fv: Record<string, any> = {};
      Object.entries(rawFv).forEach(([k, v]) => {
        if (currentFieldKeys.has(k) || k.startsWith('_')) fv[k] = v;
      });
      setFormValues(fv);
      setDurationInputs({});
      if (result.entry.fieldValues?._bvsl_preaching) setBvslValues(result.entry.fieldValues._bvsl_preaching);
      if (editToastShownRef.current !== date) {
        toast.info('Editing existing entry for this date');
        editToastShownRef.current = date;
      }
    } else {
      setIsEditMode(false);
      setExistingRowId(undefined);
      setExistingEntryId(undefined);
      // Initialize fields to zero-value defaults so users don't have to type 0s
      // NI-01: Do NOT pre-populate numeric fields with 0 — leave them empty so
      // users can type directly without having to erase a pre-filled '0'
      const initialValues: Record<string, any> = {};
      const initialDurationInputs: Record<string, string> = {};
      (fieldsForInit || []).forEach(f => {
        const nt = normalizeFieldType(f.fieldType, f.fieldKey);
        // number: intentionally left as undefined/'' — shows placeholder '0'
        if (nt === 'duration') {
          initialValues[f.fieldKey] = 0;
          initialDurationInputs[f.fieldKey] = ''; // BUG-2a FIX: don't pre-fill with 00:00
        }
        if (nt === 'time') initialValues[f.fieldKey] = '';
      });
      setFormValues(initialValues);
      setBvslValues({});
      setDurationInputs(initialDurationInputs);
      editToastShownRef.current = null;
    }
  };

  const handleTempResidencyToggle = async (enabled: boolean) => {
    setTempResidencyEnabled(enabled);
    if (!enabled) {
      setTempSaving(true);
      try {
        await setTemporaryResidency({ enabled: false, residencyId: null });
        await loadFormData();
      } catch { toast.error('Failed to update residency status'); }
      finally { setTempSaving(false); }
    }
  };

  const handleTempResidencySelect = async (rid: string) => {
    setTempResidencyId(rid);
    setTempSaving(true);
    try {
      await setTemporaryResidency({ enabled: true, residencyId: rid });
      await loadFormData();
    } catch { toast.error('Failed to update residency status'); }
    finally { setTempSaving(false); }
  };

  const handleFieldChange = useCallback((key: string, value: any) => {
    setFormValues(prev => ({ ...prev, [key]: value }));
  }, []);

  const handleDurationInputChange = useCallback((key: string, text: string) => {
    setDurationInputs(prev => ({ ...prev, [key]: text }));
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (fields.length === 0) {
      toast.error('Form fields not loaded. Please refresh the page.');
      return;
    }
    const visibleFields = fields.filter(f => isFieldVisibleForUser(f as any, ashrayLevel, entryDate));
    // SAD-C04 FIX: when sick/OS, only validate the scored fields
    const missing = visibleFields.filter(f => {
      if (!f.isRequired) return false;
      // Sick/OS exemption: only skip SCORING fields that aren't in scored-during-sick list.
      // NEVER skip informational required fields (japa_finish_time, sleep_minutes, etc.) — they must be filled regardless.
      if (isSickOrOs && f.contributesToScore && !SICK_OS_SCORED_KEYS.has(f.fieldKey)) return false;
      const v = formValues[f.fieldKey];
      const nt = normalizeFieldType(f.fieldType, f.fieldKey);
      if (nt === 'multiselect') return !Array.isArray(v) || v.length === 0;
      if (nt === 'toggle') return false;
      if (nt === 'number') return v === '' || v === undefined || v === null;
      // Duration: 0 is a valid value (user didn't read/preach today) — only block empty/unset
      if (nt === 'duration') return v === undefined || v === null || v === '';
      // Time: empty string OR "00:00" (midnight is never a valid japa/sleep time)
      if (nt === 'time') return !v || v === '' || v === '00:00';
      return v === '' || v === undefined || v === null;
    });
    if (missing.length > 0) { toast.error(`Please fill: ${missing.map(f => f.fieldLabel).join(', ')}`); return; }

    // BV-FIX-1: Validate BVSL preaching fields are compulsory
    if (isBvsl) {
      const bvDurationFields = ['pr_calling_time', 'pr_one_on_one_time', 'pr_book_dist_time', 'pr_rdua_time', 'pr_plan_time'];
      const bvNumberFields = ['pr_books_distributed', 'pr_contacts_collected', 'pr_unique_one_on_ones'];
      const missingDuration = bvDurationFields.filter(k => bvslValues[k] === undefined || bvslValues[k] === null || bvslValues[k] === '');
      const missingNumber = bvNumberFields.filter(k => bvslValues[k] === undefined || bvslValues[k] === null || bvslValues[k] === '');
      if (missingDuration.length > 0 || missingNumber.length > 0) {
        toast.error('Please fill all Bhakti Vriksha fields. Switch to the BV tab and fill all fields.');
        setActiveTab('bv');
        return;
      }
    }

    setSubmitting(true);

    // OPT-6: Show success toast immediately (optimistic UI — feels instant)
    const scoreLabel = scoreResult.scorePercent != null
      ? `${scoreResult.scorePercent}%`
      : `${scoreResult.totalScore} pts`;
    toast.success(`Sadhana saved! (Score: ${scoreLabel})`, { id: 'sadhana-submit' });

    try {
      // Send base score WITHOUT report_sending — server adds the authoritative value
      // (frontend uses browser local time which may differ from server IST)
      const totalScore = baseScoreResult.totalScore;
      const maxScore = isResident ? (baseScoreResult.maxScore + 1) : baseScoreResult.maxScore; // keep denominator at 20
      const scorePercent = maxScore > 0 ? Math.round((totalScore / maxScore) * 100) : null;
      // Convert sleep_minutes from "HH:MM" time string to minutes-from-midnight before submitting
      const processedValues = { ...formValues };
      if (processedValues.sleep_minutes && typeof processedValues.sleep_minutes === 'string' && processedValues.sleep_minutes.includes(':')) {
        const [sh, sm] = processedValues.sleep_minutes.split(':').map(Number);
        processedValues.sleep_minutes = (sh || 0) * 60 + (sm || 0);
      }
      // SAD-H06 FIX: pass isSickOrOs and isResident to enrichFieldValues
      const enriched = enrichFieldValues(processedValues, fields, ashrayLevel, entryDate, residencyBucket, isSickOrOs, isResident);
      if (isBvsl && Object.keys(bvslValues).length > 0) enriched._bvsl_preaching = bvslValues;
      // Store temp residency ID so guide reports can identify these entries
      if (tempResidencyEnabled && tempResidencyId) enriched._tempResidencyId = tempResidencyId;

      localStorage.setItem(SADHANA_SUBMITTED_KEY_PREFIX + entryDate, 'true');
      // Mark today as submitted and cancel pending reminders
      if (entryDate === format(new Date(), 'yyyy-MM-dd')) {
        markSubmittedToday();
        scheduleSadhanaReminder(true);
      }

      await submitSadhana({
        userId, entryDate, totalScore,
        maxScore: maxScore,
        scorePercent: maxScore > 0 ? (scorePercent ?? undefined) : undefined,
        templateMode, ashrayLevelUsed: ashrayLevel || undefined,
        fieldValues: enriched,
        flagSick: isSick,
        flagOs: isOS,
        existingRowId,
        existingEntryId,
      });
      navigate(getDashboardUrl(), { replace: true });
    } catch (err: any) {
      // Revert optimistic toast on failure
      toast.error('Save failed — check your connection and try again', { id: 'sadhana-submit' });
    }
    finally { setSubmitting(false); }
  };

  if (loading) return (
    <div className="min-h-screen bg-background p-4">
      <div className="container mx-auto max-w-2xl space-y-3 pt-4">
        <Skeleton className="h-8 w-48" />
        {[1, 2, 3, 4, 5].map(i => <Skeleton key={i} className="h-24 w-full rounded-xl" />)}
      </div>
    </div>
  );

  const { totalScore, maxScore, scorePercent: percentage } = scoreResult;
  const bvHours = Math.floor(bvTotalMinutes / 60);
  const bvMins = bvTotalMinutes % 60;

  return (
    <div className="min-h-screen bg-muted/30 p-4 pb-10">
      <div className="container mx-auto max-w-2xl">
        {/* Always navigate directly to dashboard — never use navigate(-1) which can land on auth pages */}
        <Button variant="ghost" onClick={() => navigate(getDashboardUrl())} className="mb-4 -ml-2">
          <ArrowLeft className="w-4 h-4 mr-2" />Back to Dashboard
        </Button>

        <h1 className="text-2xl font-bold flex items-center gap-2 mb-4">
          {isEditMode && <Save className="w-6 h-6 text-primary" />}
          Daily Sadhana Form
          {isEditMode && <span className="text-sm font-normal text-muted-foreground">(Edit)</span>}
        </h1>

        <form onSubmit={handleSubmit} className="space-y-3">
          {/* Entry Date */}
          <div className="bg-card border rounded-xl p-4 shadow-sm space-y-2">
            <Label className="text-base font-medium"><Calendar className="w-4 h-4 inline mr-2" />Entry Date</Label>
            <Input type="date" value={entryDate} onChange={(e) => setEntryDate(e.target.value)}
              max={format(new Date(), 'yyyy-MM-dd')} min={format(subDays(new Date(), 7), 'yyyy-MM-dd')} />
            <p className="text-sm text-muted-foreground">Today or up to 7 days back.</p>
          </div>

          {/* Temporary FOLK Residency toggle — only shown for non-official-residents */}
          {!isOfficialResident && (
            <div className="bg-card border rounded-xl p-4 shadow-sm space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Home className="w-4 h-4 text-primary" />
                  <Label className="text-base font-medium">I am in FOLK Residency</Label>
                  {tempSaving && <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />}
                </div>
                <Switch
                  checked={tempResidencyEnabled}
                  onCheckedChange={tempSaving ? () => {} : handleTempResidencyToggle}
                />
              </div>
              {tempResidencyEnabled && (
                <div className="space-y-1.5">
                  <Label className="text-sm text-muted-foreground">Select FOLK Residency you are visiting:</Label>
                  <select
                    className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring"
                    value={tempResidencyId || ''}
                    onChange={e => !tempSaving && e.target.value && handleTempResidencySelect(e.target.value)}
                  >
                    <option value="">— Select a residency —</option>
                    {residencies.map(r => (
                      <option key={r.residencyId} value={r.residencyId}>{r.residencyName}</option>
                    ))}
                  </select>
                  {tempSaving && <p className="text-xs text-muted-foreground">Updating residency…</p>}
                  {tempResidencyId && !tempSaving && (
                    <p className="text-xs text-primary font-medium">
                      ✓ Filling as a resident. Turn off when you leave.
                    </p>
                  )}
                </div>
              )}
            </div>
          )}

          {isSickOrOs && (
            <div className="bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-xl p-3 flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
              <p className="text-sm text-amber-700 dark:text-amber-400 font-medium">
                {isSick && isOS ? '🤒 ✈️ Sick & Out of Station' : isSick ? '🤒 Sick' : '✈️ Out of Station'}
                {isResident ? ` — rounds + reading scored out of 8 pts (+ 1 for same-day)` : ` — only reading and chanting are scored (max ${sickMaxScore} pts)`}
              </p>
            </div>
          )}

          {/* Form fields */}
          {isBvsl ? (
            <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-3">
              <TabsList className="w-full">
                <TabsTrigger value="sadhana" className="flex-1 flex items-center gap-1.5">
                  <BookOpen className="w-4 h-4" />Sadhana
                </TabsTrigger>
                <TabsTrigger value="bv" className="flex-1 flex items-center gap-1.5">
                  <Leaf className="w-4 h-4" />Bhakti Vriksha
                </TabsTrigger>
              </TabsList>
              <TabsContent value="sadhana" className="space-y-3 mt-0">
                <SadhanaFields fields={fields} formValues={formValues} ashrayLevel={ashrayLevel}
                  entryDate={entryDate} residencyBucket={residencyBucket} durationInputs={durationInputs}
                  onFieldChange={handleFieldChange} onDurationInputChange={handleDurationInputChange}
                  isSickOrOs={isSickOrOs} sickOsKeys={SICK_OS_SCORED_KEYS} isResident={isResident}
                  hiddenFieldKeys={!isResident ? new Set(['fillingSameDay']) : undefined}
                  loadError={loadError} onRetry={loadFormData} cleanlinessAutoFill={cleanlinessAutoFill} />
                {isResident && <ReportSendingIndicator entryDate={entryDate} pts={reportSendingPts} />}
              </TabsContent>
              <TabsContent value="bv" className="space-y-3 mt-0">
                <BvslPreachingSection values={bvslValues} onChange={setBvslValues} />
              </TabsContent>
            </Tabs>
          ) : (
            <>
              <SadhanaFields fields={fields} formValues={formValues} ashrayLevel={ashrayLevel}
                entryDate={entryDate} residencyBucket={residencyBucket} durationInputs={durationInputs}
                onFieldChange={handleFieldChange} onDurationInputChange={handleDurationInputChange}
                isSickOrOs={isSickOrOs} sickOsKeys={SICK_OS_SCORED_KEYS} isResident={isResident}
                hiddenFieldKeys={!isResident ? new Set(['fillingSameDay']) : undefined}
                loadError={loadError} onRetry={loadFormData} cleanlinessAutoFill={cleanlinessAutoFill} />
              {isResident && <ReportSendingIndicator entryDate={entryDate} pts={reportSendingPts} />}
            </>
          )}

          {/* NR: Filled Same Day auto-indicator + personalized scoring targets */}
          {!isResident && <NRFilledSameDayIndicator ashrayLevel={ashrayLevel} entryDate={entryDate} />}
          {!isResident && ashrayLevel && <NRScoringCriteria ashrayLevel={ashrayLevel} />}

          {/* Scoring Criteria Reference */}
          <ScoringCriteriaPanel />

          {/* Summary + Submit */}
          <div className="bg-card border rounded-xl p-4 shadow-sm space-y-4">
            {isBvsl ? (
              <>
                <div className="grid grid-cols-2 gap-4">
                  <div className={isSickOrOs ? 'opacity-50' : ''}>
                    <p className="text-sm text-muted-foreground">Sadhana Score</p>
                    {percentage != null ? (
                      <>
                        <p className="text-2xl font-bold text-primary">
                          {percentage}%
                          {isSickOrOs && <span className="text-xs font-normal text-muted-foreground ml-1">(Sick/OS)</span>}
                        </p>
                        <p className="text-xs text-muted-foreground">{totalScore} / {maxScore} pts</p>
                      </>
                    ) : (
                      <p className="text-2xl font-bold text-primary">
                        {totalScore} pts
                        {isSickOrOs && <span className="text-xs font-normal text-muted-foreground ml-1">(Sick/OS)</span>}
                      </p>
                    )}
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">Bhakti Vriksha Hours</p>
                    {bvTotalMinutes > 0 ? (
                      <p className="text-2xl font-bold text-primary">{bvHours}h {bvMins}m</p>
                    ) : (
                      <p className="text-2xl font-bold text-muted-foreground">—</p>
                    )}
                    <p className="text-xs text-muted-foreground">Total preaching time</p>
                  </div>
                </div>
                <AcknowledgementCheckbox acknowledged={acknowledged} onToggle={setAcknowledged} />
                <Button type="submit" size="lg" disabled={submitting || !acknowledged} className="w-full">
                  <Send className="w-4 h-4 mr-2" />
                  {submitting ? 'Submitting...' : isEditMode ? 'Update Sadhana & Bhakti Vriksha Report' : 'Submit Sadhana & Bhakti Vriksha Report'}
                </Button>
              </>
            ) : (
              <div className="space-y-4">
                <div className="flex items-center justify-between gap-4 flex-wrap">
                  <div className={isSickOrOs ? 'opacity-50' : ''}>
                    <p className="text-sm text-muted-foreground">Sadhana Score</p>
                    {percentage != null ? (
                      <>
                        <p className="text-3xl font-bold text-primary">
                          {percentage}%
                          {isSickOrOs && <span className="text-sm font-normal text-muted-foreground ml-1">(Sick/OS)</span>}
                        </p>
                        <p className="text-xs text-muted-foreground">{totalScore} / {maxScore} pts</p>
                      </>
                    ) : (
                      <p className="text-3xl font-bold text-primary">
                        {totalScore} pts
                        {isSickOrOs && <span className="text-sm font-normal text-muted-foreground ml-1">(Sick/OS)</span>}
                      </p>
                    )}
                  </div>
                </div>
                <AcknowledgementCheckbox acknowledged={acknowledged} onToggle={setAcknowledged} />
                <Button type="submit" size="lg" disabled={submitting || !acknowledged} className="w-full">
                  {submitting ? 'Submitting...' : isEditMode ? 'Update Sadhana' : 'Submit Sadhana'}
                </Button>
              </div>
            )}
          </div>
        </form>
      </div>
    </div>
  );
}

/** Mandatory honesty acknowledgement checkbox shown before the submit button */
function AcknowledgementCheckbox({ acknowledged, onToggle }: { acknowledged: boolean; onToggle: (v: boolean) => void }) {
  return (
    <div className={`rounded-xl border-2 p-4 transition-colors ${acknowledged ? 'border-primary/40 bg-primary/5' : 'border-border bg-muted/30'}`}>
      <label className="flex items-start gap-3 cursor-pointer select-none">
        <Checkbox
          id="sadhana-acknowledgement"
          checked={acknowledged}
          onCheckedChange={(v) => onToggle(!!v)}
          className="mt-0.5 shrink-0"
        />
        <span className="text-sm leading-relaxed text-foreground">
          I solemnly declare that I have sincerely performed all the above sadhana activities as reported. I understand that this report is an offering to my Śrī Guru Śrīla Prabhupāda and Śrī Bhagavān Kṛṣṇa, and I take full responsibility for its completeness.{' '}
        </span>
      </label>
    </div>
  );
}


/** SAD-H03 FIX: Extracted sadhana fields list with sick/OS visual treatment */
function SadhanaFields({ fields, formValues, ashrayLevel, entryDate, residencyBucket, durationInputs, onFieldChange, onDurationInputChange, isSickOrOs, sickOsKeys, isResident, hiddenFieldKeys, loadError, onRetry, cleanlinessAutoFill }: {
  fields: Field[]; formValues: Record<string, any>; ashrayLevel: string; entryDate: string;
  residencyBucket: string; durationInputs: Record<string, string>;
  onFieldChange: (k: string, v: any) => void; onDurationInputChange: (k: string, t: string) => void;
  isSickOrOs?: boolean; sickOsKeys?: Set<string>; isResident?: boolean; hiddenFieldKeys?: Set<string>;
  loadError?: boolean; onRetry?: () => void;
  cleanlinessAutoFill?: { enabled: boolean; score: number | null; pending: boolean; photo?: string | null; comment?: string | null; inspectionId?: string; roomId?: string; reviewStatus?: string | null };
  entryDateForReview?: string;
}) {
  if (fields.length === 0) {
    if (loadError && onRetry) {
      return (
        <div className="bg-card border border-destructive/30 rounded-xl p-6 text-center shadow-sm space-y-3">
          <AlertTriangle className="w-8 h-8 text-destructive mx-auto" />
          <p className="text-sm text-foreground font-medium">Failed to load form fields</p>
          <p className="text-xs text-muted-foreground">Please check your connection and try again.</p>
          <Button variant="outline" size="sm" onClick={onRetry}><Loader2 className="w-3.5 h-3.5 mr-1.5" />Retry</Button>
        </div>
      );
    }
    return <div className="bg-card border rounded-xl p-6 text-center text-muted-foreground shadow-sm">No fields configured. Contact your guide.</div>;
  }
  return (
    <>
      {[...fields].sort((a, b) => a.displayOrder - b.displayOrder).filter(field => !hiddenFieldKeys?.has(field.fieldKey)).map(field => {
        // Show all fields — for NR users, some fields may not be scored at their ashray level
        const applicableForLevel = isFieldVisibleForUser(field as any, ashrayLevel, entryDate);
        // SAD-H03 FIX: grey out non-scored fields when sick/OS
        const isNotScoredSickOs = !!(isSickOrOs && sickOsKeys && !sickOsKeys.has(field.fieldKey));
        const isNotApplicable = !applicableForLevel;
        const isCleanlinessAutoFilled = !!(cleanlinessAutoFill?.enabled && field.fieldKey === 'cleanliness');
        
        if (isCleanlinessAutoFilled) {
          return (
            <CleanlinessAutoFillCard
              key={field.fieldId}
              fieldLabel={field.fieldLabel}
              cleanlinessAutoFill={cleanlinessAutoFill!}
            />
          );
        }
        
        return (
          <div key={field.fieldId} className={`bg-card border rounded-xl p-4 shadow-sm transition-opacity ${(isNotScoredSickOs || isNotApplicable) ? 'opacity-60' : ''}`}>
            {isNotScoredSickOs && (
              <p className="text-xs text-muted-foreground mb-1 italic">Not counted in score (Sick/OS)</p>
            )}
            {isNotApplicable && !isNotScoredSickOs && (
              <p className="text-xs text-amber-600 mb-1 italic font-medium">Not scored at your level ({ashrayLevel}) — fill for practice</p>
            )}
            <SadhanaFieldRenderer field={field} value={formValues[field.fieldKey]}
              onChange={onFieldChange}
              ashrayLevel={ashrayLevel} entryDate={entryDate}
              residencyBucket={residencyBucket} durationInput={durationInputs[field.fieldKey]}
              onDurationInputChange={onDurationInputChange} />
          </div>
        );
      })}
    </>
  );
}

/** Cleanliness auto-fill card with photo, comment, and review request */
function CleanlinessAutoFillCard({ fieldLabel, cleanlinessAutoFill }: {
  fieldLabel: string;
  cleanlinessAutoFill: { enabled: boolean; score: number | null; pending: boolean; photo?: string | null; comment?: string | null; inspectionId?: string; roomId?: string; reviewStatus?: string | null };
}) {
  const [expanded, setExpanded] = useState(false);
  const [requesting, setRequesting] = useState(false);
  const [reviewStatus, setReviewStatus] = useState(cleanlinessAutoFill.reviewStatus);

  const score = cleanlinessAutoFill.score ?? 0;
  const isPending = cleanlinessAutoFill.pending;
  const hasDetails = score === 0 && !isPending && (cleanlinessAutoFill.photo || cleanlinessAutoFill.comment);

  const handleRequestReview = async () => {
    if (!cleanlinessAutoFill.inspectionId || !cleanlinessAutoFill.roomId) return;
    setRequesting(true);
    try {
      // Get date from the form — use the entryDate from parent context
      const dateInput = document.querySelector<HTMLInputElement>('input[type="date"]');
      const date = dateInput?.value || new Date().toISOString().split('T')[0];
      await requestCleanlinessReview({
        inspectionId: cleanlinessAutoFill.inspectionId,
        roomId: cleanlinessAutoFill.roomId,
        date,
      });
      setReviewStatus('Pending');
      toast.success('Review request submitted to your guide');
    } catch (err: any) {
      toast.error(err?.message || 'Failed to request review');
    } finally {
      setRequesting(false);
    }
  };

  return (
    <div className="bg-card border rounded-xl p-4 shadow-sm space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <Label className="text-base font-medium">{fieldLabel}</Label>
          <p className="text-xs text-muted-foreground">
            {isPending ? '⏳ Pending inspection — defaults to 0' : '🔒 Rated by cleanliness manager'}
          </p>
        </div>
        <span className={`text-lg font-bold ${score === 1 ? 'text-primary' : 'text-destructive'}`}>{score}</span>
      </div>

      {hasDetails && (
        <>
          <button
            type="button"
            className="text-xs text-primary font-medium flex items-center gap-1"
            onClick={() => setExpanded(!expanded)}
          >
            {expanded ? '▼ Hide Details' : '▶ View Details'}
          </button>
          {expanded && (
            <div className="border rounded-lg p-3 bg-muted/50 space-y-2">
              {cleanlinessAutoFill.photo && (
                <div className="relative w-full h-40 bg-muted rounded-md overflow-hidden animate-pulse">
                  <img
                    src={cleanlinessAutoFill.photo}
                    alt="Inspection"
                    className="w-full h-full object-cover opacity-0 transition-opacity duration-300"
                    onLoad={(e) => {
                      e.currentTarget.parentElement?.classList.remove('animate-pulse');
                      e.currentTarget.classList.remove('opacity-0');
                    }}
                  />
                </div>
              )}
              {cleanlinessAutoFill.comment && (
                <p className="text-sm text-muted-foreground italic">"{cleanlinessAutoFill.comment}"</p>
              )}
            </div>
          )}
        </>
      )}

      {score === 0 && !isPending && cleanlinessAutoFill.inspectionId && (
        <>
          {reviewStatus === 'Pending' ? (
            <p className="text-xs text-amber-600 font-medium bg-amber-50 border border-amber-200 rounded-lg py-2 px-3 text-center">
              ⏳ Review requested — waiting for guide
            </p>
          ) : reviewStatus === 'Approved' ? (
            <p className="text-xs text-green-600 font-medium bg-green-50 border border-green-200 rounded-lg py-2 px-3 text-center">
              ✅ Review approved — score corrected to 1
            </p>
          ) : reviewStatus === 'Dismissed' ? (
            <p className="text-xs text-muted-foreground bg-muted/50 border rounded-lg py-2 px-3 text-center">
              Review dismissed by guide
            </p>
          ) : (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="w-full"
              disabled={requesting}
              onClick={handleRequestReview}
            >
              {requesting ? <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> : null}
              Request Review
            </Button>
          )}
        </>
      )}
    </div>
  );
}

/** Read-only indicator for resident filling_same_day — mirrors the toggle field UI exactly */
function ReportSendingIndicator({ entryDate, pts }: { entryDate: string; pts: number }) {
  const today = format(new Date(), 'yyyy-MM-dd');
  const isSameDay = entryDate === today;
  return (
    <div className="bg-card border rounded-xl p-4 shadow-sm">
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <div>
            <Label className="text-base font-medium">Filling Same Day</Label>
          </div>
          <Switch checked={isSameDay} disabled />
        </div>
        <p className={`text-sm font-medium ${pts > 0 ? 'text-primary' : 'text-muted-foreground'}`}>
          {pts} / 1 pts
        </p>
      </div>
    </div>
  );
}

/** NR-specific Filled Same Day indicator — auto-computes day_delay points and shows them read-only */
function NRFilledSameDayIndicator({ ashrayLevel, entryDate }: { ashrayLevel: string; entryDate: string }) {
  const level = (ashrayLevel || '').trim().replace(/_/g, ' ');
  const ineligible = ['', 'Jigyasa', 'Shraddhavan', 'Gauranga Sabha'];
  if (ineligible.includes(level)) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const entry = new Date(entryDate + 'T00:00:00');
  const dayDelay = Math.max(0, Math.round((today.getTime() - entry.getTime()) / 86400000));
  const pts = Math.max(0, 4 - dayDelay * 2);
  return (
    <div className="bg-card border rounded-xl p-4 shadow-sm">
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label className="text-base font-medium">Filled Same Day</Label>
          <Switch checked={dayDelay === 0} disabled />
        </div>
        <p className={`text-sm font-medium ${pts > 0 ? 'text-primary' : 'text-muted-foreground'}`}>
          {pts} / 4 pts{dayDelay > 0 ? ` (${dayDelay} day${dayDelay !== 1 ? 's' : ''} late — −2 pts/day)` : ' ✓ Same day'}
        </p>
      </div>
    </div>
  );
}

/** SAD-H06 FIX: Enrich field values with per-field points, zeroing out non-scored fields when sick/OS */
function enrichFieldValues(
  values: Record<string, any>, fields: Field[], ashrayLevel: string,
  entryDate: string, residencyBucket: string,
  isSickOrOs?: boolean, isResidentUser?: boolean,
): Record<string, any> {
  // SAD-H06: determine which keys are scored when sick/OS
  const SICK_OS_SCORED_KEYS_RESIDENT = new Set(['sp_reading', 'rounds', 'sp_reading_minutes', 'rounds_count']);
  const SICK_OS_SCORED_KEYS_NR = new Set(['reading', 'chanting']);
  const scoredKeys = isSickOrOs
    ? (isResidentUser ? SICK_OS_SCORED_KEYS_RESIDENT : SICK_OS_SCORED_KEYS_NR)
    : null;

  const enriched = { ...values };
  const perField: Record<string, number> = {};

  fields.forEach(field => {
    if (!field.contributesToScore) return;

    // SAD-H06 FIX: zero out non-scored fields when sick/OS
    if (scoredKeys && !scoredKeys.has(field.fieldKey)) {
      enriched[`_pts_${field.fieldKey}`] = 0;
      enriched[`_max_${field.fieldKey}`] = 0;
      return;
    }

    const { points, maxPoints } = computeSingleFieldScore({
      field: field as any,
      value: values[field.fieldKey],
      ashrayLevel,
      entryDate,
      residencyBucket,
    });
    enriched[`_pts_${field.fieldKey}`] = points;
    enriched[`_max_${field.fieldKey}`] = maxPoints;
    perField[field.fieldKey] = points;

    const criteria = parseCriteria(field.criteria);
    if (isNRCriteria(criteria)) {
      const nr = calculateNRPoints(criteria, values[field.fieldKey], ashrayLevel, entryDate);
      enriched[`_nr_pts_${field.fieldKey}`] = nr.points;
      enriched[`_nr_max_${field.fieldKey}`] = nr.maxPoints;
    } else if (typeof criteria === 'object' && criteria && !Array.isArray(criteria)) {
      const { points: rPts } = calculateResidentPoints(criteria, parseNumericValue(values[field.fieldKey]), residencyBucket);
      if (field.fieldKey === 'sp_reading' || field.fieldKey === 'sp_reading_minutes') enriched.sp_reading_points = rPts;
      else if (field.fieldKey === 'rounds' || field.fieldKey === 'rounds_count') enriched.rounds_points = rPts;
    }
  });

  enriched._per_field = perField;
  return enriched;
}
