import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Award, Settings2 } from 'lucide-react';
import { toast } from 'sonner';
import { getServices, getServicePreferences, saveServicePreferences, getUserSkills, addMySkill, removeMySkill, getAvailableSkills } from 'zite-endpoints-sdk';
import type { GetServicesOutputType, GetServicePreferencesOutputType } from 'zite-endpoints-sdk';

interface SkillRow { id: number; skillName: string; }
interface Props { userId: string; residencyId?: string; }

export default function UserPreferencesTab({ userId, residencyId }: Props) {
  const [services, setServices] = useState<GetServicesOutputType['services']>([]);
  const [prefs, setPrefs] = useState<GetServicePreferencesOutputType['preferences']>([]);
  const [mySkillRows, setMySkillRows] = useState<SkillRow[]>([]);
  const [availableSkills, setAvailableSkills] = useState<string[]>([]);
  const [togglingSkill, setTogglingSkill] = useState<string | null>(null);
  const [savingPrefs, setSavingPrefs] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => { load(); }, [userId, residencyId]);

  const load = async () => {
    try {
      const [sRes, pRes, skillsRes, catalogRes] = await Promise.all([
        getServices({ scope: 'all', residencyId }),
        getServicePreferences({}),
        getUserSkills({ userId }),
        getAvailableSkills({}),
      ]);
      setServices(sRes.services);
      setPrefs(pRes.preferences);
      setAvailableSkills(catalogRes.skills);
      setMySkillRows(skillsRes.skills.filter(s => s.userId === userId && s.skillName !== '__removed__').map(s => ({ id: s.id, skillName: s.skillName })));
    } catch { toast.error('Failed to load preferences'); }
    finally { setLoading(false); }
  };

  const mySkillNames = mySkillRows.map(r => r.skillName);

  const toggleSkill = async (skillName: string) => {
    setTogglingSkill(skillName);
    try {
      if (mySkillNames.includes(skillName)) {
        const row = mySkillRows.find(r => r.skillName === skillName);
        if (row) { await removeMySkill({ rowId: row.id }); setMySkillRows(p => p.filter(r => r.id !== row.id)); }
      } else {
        await addMySkill({ skillName });
        await load();
      }
    } catch { toast.error('Failed to update skill'); }
    finally { setTogglingSkill(null); }
  };

  const getPref = (serviceId: string) => prefs.find(p => p.serviceId === serviceId);
  const togglePref = (serviceId: string, current: boolean) => {
    setPrefs(prev => {
      const exists = prev.find(p => p.serviceId === serviceId);
      if (exists) return prev.map(p => p.serviceId === serviceId ? { ...p, canDo: !current } : p);
      return [...prev, { id: 0, serviceId, canDo: !current, reason: '', updatedAt: '' }];
    });
  };

  const savePreferences = async () => {
    setSavingPrefs(true);
    try {
      await saveServicePreferences({ preferences: prefs.map(p => ({ serviceId: p.serviceId, canDo: p.canDo, reason: p.reason })) });
      toast.success('Preferences saved ✓');
    } catch { toast.error('Failed to save'); }
    finally { setSavingPrefs(false); }
  };

  if (loading) return <div className="text-center py-8 text-muted-foreground text-sm">Loading…</div>;

  return (
    <div className="space-y-4">
      {/* Skills */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm flex items-center gap-2"><Award className="w-4 h-4 text-primary" />My Skills</CardTitle>
        </CardHeader>
        <CardContent className="pt-0 space-y-3">
          <p className="text-xs text-muted-foreground">Tap a skill to add or remove it. Your guide uses this for better service allocation.</p>
          {availableSkills.length === 0 ? (
            <p className="text-xs text-muted-foreground italic">No skills defined by guide yet.</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {availableSkills.map(skill => {
                const has = mySkillNames.includes(skill);
                const busy = togglingSkill === skill;
                return (
                  <button key={skill} onClick={() => toggleSkill(skill)} disabled={busy}
                    className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-all ${has ? 'bg-primary text-primary-foreground border-primary shadow-sm' : 'bg-background text-muted-foreground border-border hover:border-primary/50 hover:text-foreground'} ${busy ? 'opacity-60' : ''}`}>
                    {has && <span className="mr-1">✓</span>}{skill.replace(/_/g, ' ')}
                  </button>
                );
              })}
            </div>
          )}
          {mySkillNames.length > 0 && (
            <p className="text-xs text-muted-foreground">{mySkillNames.length} skill{mySkillNames.length !== 1 ? 's' : ''} selected</p>
          )}
        </CardContent>
      </Card>

      {/* Service Preferences */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm flex items-center gap-2"><Settings2 className="w-4 h-4 text-primary" />Service Preferences</CardTitle>
        </CardHeader>
        <CardContent className="pt-0 space-y-3">
          <p className="text-xs text-muted-foreground">Toggle off services you cannot do. Visible to your guide.</p>
          {services.length === 0 ? (
            <p className="text-xs text-muted-foreground italic">No residency services found.</p>
          ) : (
            <div className="space-y-2">
              {services.map(s => {
                const pref = getPref(s.serviceId);
                const canDo = pref ? pref.canDo : true;
                return (
                  <div key={s.serviceId} className="flex items-center justify-between py-1.5 border-b border-border last:border-0">
                    <div><p className="text-sm font-medium">{s.serviceName}</p><p className="text-xs text-muted-foreground">{s.timeSlot}</p></div>
                    <div className="flex items-center gap-2">
                      <span className={`text-xs ${canDo ? 'text-green-600' : 'text-muted-foreground'}`}>{canDo ? 'Can do' : 'Opted out'}</span>
                      <Switch checked={canDo} onCheckedChange={() => togglePref(s.serviceId, canDo)} />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
          <Button size="sm" onClick={savePreferences} disabled={savingPrefs}>{savingPrefs ? 'Saving…' : 'Save Preferences'}</Button>
        </CardContent>
      </Card>
    </div>
  );
}
