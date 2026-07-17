import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { X, Plus, RefreshCw, BookOpen } from 'lucide-react';
import { toast } from 'sonner';
import { getUserSkills, tagUserSkill, removeUserSkill, getAvailableSkills, manageCatalogSkill } from 'zite-endpoints-sdk';
import type { GetUserSkillsOutputType } from 'zite-endpoints-sdk';

type UserEntry = GetUserSkillsOutputType['users'][0];

export default function UserSkillsTab() {
  const [users, setUsers] = useState<UserEntry[]>([]);
  const [skills, setSkills] = useState<GetUserSkillsOutputType['skills']>([]);
  const [catalog, setCatalog] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [addingFor, setAddingFor] = useState<string | null>(null);
  const [newSkill, setNewSkill] = useState('');
  const [newCatalogSkill, setNewCatalogSkill] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => { load(); }, []);

  const load = async () => {
    try {
      const [res, catRes] = await Promise.all([getUserSkills({}), getAvailableSkills({})]);
      setUsers(res.users);
      setSkills(res.skills);
      setCatalog(catRes.skills);
    } catch { toast.error('Failed to load skills'); }
    finally { setLoading(false); setRefreshing(false); }
  };

  const refresh = () => { setRefreshing(true); load(); };

  const handleAdd = async (userId: string) => {
    if (!newSkill) return;
    setSaving(true);
    try {
      await tagUserSkill({ userId, skillName: newSkill } as any);
      toast.success('Skill tagged');
      setAddingFor(null); setNewSkill('');
      await load();
    } catch { toast.error('Failed to tag skill'); }
    finally { setSaving(false); }
  };

  const handleRemove = async (userId: string, skillName: string) => {
    const row = skills.find(s => s.userId === userId && s.skillName === skillName);
    if (!row) return;
    try {
      await removeUserSkill({ rowId: row.id } as any);
      toast.success('Skill removed');
      await load();
    } catch { toast.error('Failed to remove skill'); }
  };

  const addToCatalog = async () => {
    if (!newCatalogSkill.trim()) return;
    const skillKey = newCatalogSkill.trim().toLowerCase().replace(/\s+/g, '_');
    try {
      await manageCatalogSkill({ skillName: skillKey, action: 'add' } as any);
      toast.success('Skill added to catalog');
      setNewCatalogSkill('');
      await load();
    } catch { toast.error('Failed to add to catalog'); }
  };

  const removeFromCatalog = async (skill: string) => {
    try {
      await manageCatalogSkill({ skillName: skill, action: 'remove' } as any);
      toast.success('Removed from catalog');
      await load();
    } catch { toast.error('Failed to remove from catalog'); }
  };

  if (loading) return <div className="text-center py-8 text-muted-foreground">Loading…</div>;

  return (
    <div className="space-y-4">
      {/* Skill Catalog Management */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2"><BookOpen className="w-4 h-4 text-primary" />Skill Catalog (Guide-Defined)</CardTitle>
        </CardHeader>
        <CardContent className="pt-0 space-y-3">
          <p className="text-xs text-muted-foreground">Define skills residents can select from their profile. These appear in the user's Preferences tab.</p>
          <div className="flex flex-wrap gap-1.5">
            {catalog.map(s => (
              <Badge key={s} variant="secondary" className="gap-1 text-xs">
                {s.replace(/_/g, ' ')}
                <button onClick={() => removeFromCatalog(s)} className="ml-0.5 hover:text-destructive"><X className="w-3 h-3" /></button>
              </Badge>
            ))}
            {catalog.length === 0 && <span className="text-xs text-muted-foreground">No skills defined yet</span>}
          </div>
          <div className="flex gap-2">
            <Input value={newCatalogSkill} onChange={e => setNewCatalogSkill(e.target.value)}
              placeholder="e.g. cooking, driving…" className="h-8 text-xs flex-1"
              onKeyDown={e => e.key === 'Enter' && addToCatalog()} />
            <Button size="sm" className="h-8" onClick={addToCatalog} disabled={!newCatalogSkill.trim()}>
              <Plus className="w-3.5 h-3.5 mr-1" />Add
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Member Skills */}
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">Member skills — tagged by guide or self-reported.</p>
        <Button size="sm" variant="ghost" onClick={refresh} disabled={refreshing}>
          <RefreshCw className={`w-3.5 h-3.5 mr-1 ${refreshing ? 'animate-spin' : ''}`} />Refresh
        </Button>
      </div>

      {users.length === 0 && <p className="text-center py-6 text-muted-foreground text-sm">No approved users found.</p>}
      {users.map(u => (
        <Card key={u.userId}>
          <CardContent className="p-4">
            <div className="flex items-start justify-between gap-2">
              <div className="flex-1 min-w-0">
                <p className="font-medium text-sm">{u.fullName}</p>
                <div className="flex flex-wrap gap-1.5 mt-2">
                  {u.skills.filter(s => s !== '__removed__').map(s => {
                    const row = skills.find(r => r.userId === u.userId && r.skillName === s);
                    const isSelf = row?.taggedBy === 'self';
                    return (
                      <Badge key={s} variant={isSelf ? 'outline' : 'secondary'} className="gap-1 text-xs">
                        {s.replace(/_/g, ' ')}
                        {isSelf && <span className="text-[9px] text-muted-foreground ml-0.5">(self)</span>}
                        <button onClick={() => handleRemove(u.userId, s)} className="ml-0.5 hover:text-destructive"><X className="w-3 h-3" /></button>
                      </Badge>
                    );
                  })}
                  {u.skills.filter(s => s !== '__removed__').length === 0 && <span className="text-xs text-muted-foreground">No skills tagged</span>}
                </div>
              </div>
              {addingFor === u.userId ? (
                <div className="flex gap-2 items-center shrink-0">
                  <Select value={newSkill} onValueChange={setNewSkill}>
                    <SelectTrigger className="w-40 h-8 text-xs"><SelectValue placeholder="Select skill" /></SelectTrigger>
                    <SelectContent>{catalog.filter(s => !u.skills.includes(s)).map(s => <SelectItem key={s} value={s}>{s.replace(/_/g, ' ')}</SelectItem>)}</SelectContent>
                  </Select>
                  <Button size="sm" className="h-8" onClick={() => handleAdd(u.userId)} disabled={saving || !newSkill}>Add</Button>
                  <Button size="sm" variant="ghost" className="h-8" onClick={() => { setAddingFor(null); setNewSkill(''); }}>✕</Button>
                </div>
              ) : (
                <Button size="sm" variant="outline" className="h-8 shrink-0" onClick={() => { setAddingFor(u.userId); setNewSkill(''); }}>
                  <Plus className="w-3.5 h-3.5 mr-1" />Skill
                </Button>
              )}
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
