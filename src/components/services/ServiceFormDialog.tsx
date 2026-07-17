import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import { getAvailableSkills } from 'zite-endpoints-sdk';
import type { GetServicesOutputType } from 'zite-endpoints-sdk';
import ChecklistBuilder, { type ChecklistItem } from './ChecklistBuilder';

type Service = GetServicesOutputType['services'][0];

interface Props {
  open: boolean;
  service?: Service | null;
  /** When provided, pre-sets the service type and hides the type dropdown */
  serviceType?: string;
  onSave: (data: Partial<Service> & { rowId?: number }) => Promise<void>;
  onClose: () => void;
}

const CATEGORIES = ['Altar', 'Cleaning', 'Prasadam', 'Tech', 'Other'];
const SERVICE_TYPES = ['Weekly', 'Saturday Maha Cleaning', 'Sunday Love Feast', 'Occasional', 'Festivals'];
const WEEK_DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

const TIME_PARTS = [
  { value: 'early_morning', label: 'Early Morning', caption: '4 AM – 8 AM', slot: '5:00 AM' },
  { value: 'morning',       label: 'Morning',       caption: '8 AM – 1 PM', slot: '9:00 AM' },
  { value: 'afternoon',     label: 'Afternoon',     caption: '1 PM – 5 PM', slot: '2:00 PM' },
  { value: 'evening',       label: 'Evening',       caption: '5 PM – 9 PM', slot: '6:00 PM' },
  { value: 'full_day',      label: 'Full Day',      caption: '4 AM – 9 PM', slot: '6:00 AM' },
];

const DEADLINE_OPTIONS = [
  { label: 'By Sunday Evening',    value: 1200  },
  { label: 'By Monday Evening',    value: 2640  },
  { label: 'By Tuesday Evening',   value: 4080  },
  { label: 'By Wednesday Evening', value: 5520  },
  { label: 'By Thursday Evening',  value: 6960  },
  { label: 'By Friday Evening',    value: 8400  },
  { label: 'By Saturday Evening',  value: 9840  },
  { label: 'By End of Week',       value: 10080 },
];

function closestDeadline(minutes: number) {
  return DEADLINE_OPTIONS.reduce((prev, curr) =>
    Math.abs(curr.value - minutes) < Math.abs(prev.value - minutes) ? curr : prev
  ).value;
}

function parseChecklist(desc: string): ChecklistItem[] | null {
  try {
    const p = JSON.parse(desc);
    if (Array.isArray(p)) return p as ChecklistItem[];
  } catch { /* not json */ }
  return null;
}

export default function ServiceFormDialog({ open, service, serviceType: propServiceType, onSave, onClose }: Props) {
  const defaultType = propServiceType ?? 'Weekly';
  const [form, setForm] = useState({
    serviceName: '', serviceScope: 'morning' as string,
    timeSlot: '', sortOrder: 99, peopleNeeded: 1,
    requiredSkillsJson: '[]', description: '', isActive: true,
    dueOffsetMinutes: defaultType !== 'Weekly' ? 9840 : 30,
    durationMinutes: 30, category: 'Other', serviceType: defaultType, customFieldsJson: '',
  });
  const [saving, setSaving] = useState(false);
  const [selectedSkills, setSelectedSkills] = useState<string[]>([]);
  const [availableSkills, setAvailableSkills] = useState<string[]>([]);
  const [preferredDays, setPreferredDays] = useState<string[]>([]);
  const [checklist, setChecklist] = useState<ChecklistItem[]>([]);

  useEffect(() => {
    if (open) getAvailableSkills({}).then(res => setAvailableSkills(res.skills)).catch(() => {});
  }, [open]);

  useEffect(() => {
    if (!open) return;
    if (service) {
      let skills: string[] = [];
      try { skills = JSON.parse(service.requiredSkillsJson || '[]'); } catch {}
      setSelectedSkills(skills);
      let days: string[] = [];
      try { const p = JSON.parse((service as any).customFieldsJson || '[]'); if (Array.isArray(p)) days = p; } catch {}
      setPreferredDays(days);
      const svcType = (service as any).serviceType ?? propServiceType ?? 'Weekly';
      const desc = service.description ?? '';
      const parsed = parseChecklist(desc);
      setChecklist(parsed ?? []);
      setForm({
        serviceName: service.serviceName,
        serviceScope: service.serviceScope ?? 'morning',
        timeSlot: service.timeSlot,
        sortOrder: service.sortOrder,
        peopleNeeded: service.peopleNeeded,
        requiredSkillsJson: service.requiredSkillsJson,
        description: desc,
        isActive: service.isActive,
        dueOffsetMinutes: svcType !== 'Weekly' ? closestDeadline(service.dueOffsetMinutes ?? 9840) : (service.dueOffsetMinutes ?? 30),
        durationMinutes: service.durationMinutes ?? 30,
        category: service.category ?? 'Other',
        serviceType: svcType,
        customFieldsJson: (service as any).customFieldsJson ?? '',
      });
    } else {
      setSelectedSkills([]);
      setPreferredDays([]);
      setChecklist([]);
      const dt = propServiceType ?? 'Weekly';
      setForm({
        serviceName: '', serviceScope: 'morning', timeSlot: '', sortOrder: 99, peopleNeeded: 1,
        requiredSkillsJson: '[]', description: '', isActive: true,
        dueOffsetMinutes: dt !== 'Weekly' ? 9840 : 30,
        durationMinutes: 30, category: 'Other', serviceType: dt, customFieldsJson: '',
      });
    }
  }, [service, open]);

  const toggleSkill = (skill: string) => {
    const next = selectedSkills.includes(skill) ? selectedSkills.filter(s => s !== skill) : [...selectedSkills, skill];
    setSelectedSkills(next);
    setForm(f => ({ ...f, requiredSkillsJson: JSON.stringify(next) }));
  };

  const toggleDay = (day: string) => {
    const next = preferredDays.includes(day) ? preferredDays.filter(d => d !== day) : [...preferredDays, day];
    setPreferredDays(next);
  };

  const isNonWeekly = form.serviceType !== 'Weekly';

  // For non-Weekly: is the existing description a legacy plain-text (not valid JSON array)?
  const isLegacyDesc = isNonWeekly && !!form.description && parseChecklist(form.description) === null;

  // For non-Weekly, auto-derive the timeSlot from the serviceScope selection
  const effectiveTimeSlot = isNonWeekly
    ? (TIME_PARTS.find(t => t.value === form.serviceScope)?.slot ?? '9:00 AM')
    : form.timeSlot;

  const handleSave = async () => {
    setSaving(true);
    try {
      const description = isNonWeekly && !isLegacyDesc
        ? (checklist.length > 0 ? JSON.stringify(checklist) : '')
        : form.description;
      const saveData = {
        ...form,
        timeSlot: effectiveTimeSlot,
        description,
        customFieldsJson: JSON.stringify(preferredDays),
        id: service?.id,
        serviceId: service?.serviceId,
        rowId: service?.id,
      };
      await onSave(saveData as any);
      onClose();
    } catch (err: any) {
      toast.error(err?.message || 'Failed to save service. Please try again.');
    } finally { setSaving(false); }
  };

  const selectedTimePart = TIME_PARTS.find(t => t.value === form.serviceScope);

  return (
    <Dialog open={open} onOpenChange={v => !v && onClose()}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{service ? 'Edit Service' : 'Add Service'}</DialogTitle>
          {propServiceType && (
            <p className="text-xs text-muted-foreground">Type: <span className="font-medium">{propServiceType}</span></p>
          )}
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="grid grid-cols-2 gap-3">
            {/* Service Name */}
            <div className="col-span-2">
              <Label>Service Name *</Label>
              <Input value={form.serviceName} onChange={e => setForm(f => ({ ...f, serviceName: e.target.value }))} placeholder="e.g. Maha Toilet Cleaning" />
            </div>

            {/* Service Type — only shown when not pre-set by prop */}
            {!propServiceType && (
              <div>
                <Label>Service Type</Label>
                <Select value={form.serviceType} onValueChange={v => setForm(f => ({ ...f, serviceType: v, dueOffsetMinutes: v !== 'Weekly' ? 9840 : 30 }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{SERVICE_TYPES.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            )}

            {/* Category — Weekly only */}
            {!isNonWeekly && (
              <div>
                <Label>Category</Label>
                <Select value={form.category} onValueChange={v => setForm(f => ({ ...f, category: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{CATEGORIES.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            )}

            {/* Time of Day */}
            <div>
              <Label>Time of Day</Label>
              <Select value={form.serviceScope} onValueChange={v => setForm(f => ({ ...f, serviceScope: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {TIME_PARTS.map(t => (
                    <SelectItem key={t.value} value={t.value}>
                      {t.label} <span className="text-muted-foreground text-xs">· {t.caption}</span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {selectedTimePart && (
                <p className="text-xs text-muted-foreground mt-1">
                  {selectedTimePart.caption}
                  {isNonWeekly && <span className="ml-1 text-primary">· auto slot: {effectiveTimeSlot}</span>}
                </p>
              )}
            </div>

            {/* Time Slot — Weekly only (auto-derived for non-Weekly) */}
            {!isNonWeekly && (
              <div>
                <Label>Time Slot *</Label>
                <Input value={form.timeSlot} onChange={e => setForm(f => ({ ...f, timeSlot: e.target.value }))} placeholder="e.g. 7:00 AM" />
              </div>
            )}

            {/* People Needed */}
            <div>
              <Label>People Needed</Label>
              <Input type="text" inputMode="numeric" pattern="[0-9]*" value={form.peopleNeeded === 0 ? '' : String(form.peopleNeeded)} placeholder="1" onChange={e => { const v = e.target.value.replace(/\D/g,''); setForm(f => ({ ...f, peopleNeeded: v === '' ? 1 : parseInt(v) })); }} />
            </div>

            {/* Duration */}
            <div>
              <Label>Duration (min)</Label>
              <Input type="text" inputMode="numeric" pattern="[0-9]*" value={form.durationMinutes === 0 ? '' : String(form.durationMinutes)} placeholder="30" onChange={e => { const v = e.target.value.replace(/\D/g,''); setForm(f => ({ ...f, durationMinutes: v === '' ? 0 : parseInt(v) })); }} />
            </div>

            {/* Deadline */}
            {isNonWeekly ? (
              <div className="col-span-2">
                <Label>Deadline</Label>
                <Select value={String(form.dueOffsetMinutes)} onValueChange={v => setForm(f => ({ ...f, dueOffsetMinutes: parseInt(v) }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{DEADLINE_OPTIONS.map(o => <SelectItem key={o.value} value={String(o.value)}>{o.label}</SelectItem>)}</SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground mt-1">Service shows as overdue after this deadline passes.</p>
              </div>
            ) : (
              <div>
                <Label>Due Offset (min)</Label>
                <Input type="text" inputMode="numeric" pattern="[0-9]*" value={form.dueOffsetMinutes === 0 ? '' : String(form.dueOffsetMinutes)} placeholder="30" onChange={e => { const v = e.target.value.replace(/\D/g,''); setForm(f => ({ ...f, dueOffsetMinutes: v === '' ? 0 : parseInt(v) })); }} />
              </div>
            )}
          </div>

          {/* Preferred Days — non-Weekly only */}
          {isNonWeekly && (
            <div>
              <Label>Preferred Days <span className="text-muted-foreground font-normal">(optional)</span></Label>
              <p className="text-xs text-muted-foreground mb-2">When should this service ideally be done? Leave blank for "anytime this week".</p>
              <div className="flex flex-wrap gap-2">
                {WEEK_DAYS.map(day => (
                  <button key={day} type="button" onClick={() => toggleDay(day)}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs border transition-colors ${
                      preferredDays.includes(day)
                        ? 'bg-primary text-primary-foreground border-primary font-medium'
                        : 'bg-background border-border text-muted-foreground hover:border-primary/50'
                    }`}>
                    {preferredDays.includes(day) && <span>✓</span>}
                    {day}
                  </button>
                ))}
              </div>
              {preferredDays.length > 0 && (
                <div className="flex items-center gap-1.5 mt-2 flex-wrap">
                  <span className="text-xs text-muted-foreground">Selected:</span>
                  {preferredDays.map(d => <Badge key={d} variant="secondary" className="text-xs">{d}</Badge>)}
                </div>
              )}
            </div>
          )}

          {/* Required Skills — Weekly only */}
          {!isNonWeekly && (
            <div>
              <Label>Required Skills</Label>
              <div className="flex flex-wrap gap-2 mt-1">
                {availableSkills.map(s => (
                  <button key={s} type="button" onClick={() => toggleSkill(s)}
                    className={`px-2 py-1 rounded text-xs border transition-colors ${selectedSkills.includes(s) ? 'bg-primary text-primary-foreground border-primary' : 'bg-background border-border text-muted-foreground'}`}>
                    {s.replace(/_/g, ' ')}
                  </button>
                ))}
                {availableSkills.length === 0 && <p className="text-xs text-muted-foreground">Loading skills…</p>}
              </div>
            </div>
          )}

          {/* Description / Checklist */}
          {isNonWeekly && !isLegacyDesc ? (
            <ChecklistBuilder items={checklist} onChange={setChecklist} />
          ) : (
            <div>
              <Label>Description</Label>
              {isLegacyDesc && (
                <p className="text-xs text-muted-foreground mb-1">Legacy text description — save with checklist items above to migrate.</p>
              )}
              <Textarea
                value={form.description}
                onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                rows={2}
              />
            </div>
          )}

          {service && (
            <div className="flex items-center gap-2">
              <Switch checked={form.isActive} onCheckedChange={v => setForm(f => ({ ...f, isActive: v }))} />
              <Label>Active</Label>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={handleSave} disabled={saving || !form.serviceName || (!isNonWeekly && !form.timeSlot)}>
            {saving ? 'Saving…' : 'Save'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
