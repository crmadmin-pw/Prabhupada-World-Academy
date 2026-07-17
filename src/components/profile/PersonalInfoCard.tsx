import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Loader2, Edit2, Check, X, Star } from 'lucide-react';
import { toast } from 'sonner';
import { updateUserProfile } from 'zite-endpoints-sdk';
import { ASHRAY_LEVELS } from '@/types/enums';

interface Props {
  email: string;
  fullName: string;
  phone: string;
  ashrayLevel?: string | null;
  onUpdated: () => void;
}

export default function PersonalInfoCard({ email, fullName, phone, ashrayLevel, onUpdated }: Props) {
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ fullName, phone, ashrayLevel: ashrayLevel || '' });

  // Sync form state when parent re-fetches and passes new props (only when not actively editing)
  useEffect(() => {
    if (!editing) {
      setForm({ fullName, phone, ashrayLevel: ashrayLevel || '' });
    }
  }, [fullName, phone, ashrayLevel, editing]);

  const handleSave = async () => {
    if (!form.fullName.trim()) { toast.error('Name cannot be empty'); return; }
    setSaving(true);
    try {
      await updateUserProfile({
        email,
        fullName: form.fullName.trim(),
        phone: form.phone,
        ashrayLevel: form.ashrayLevel || undefined,
      });
      setEditing(false);
      toast.success('Profile updated!');
      onUpdated();
    } catch {
      toast.error('Failed to update profile');
    } finally {
      setSaving(false);
    }
  };

  const handleCancel = () => {
    setForm({ fullName, phone, ashrayLevel: ashrayLevel || '' });
    setEditing(false);
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-3">
        <CardTitle className="text-base">Personal Information</CardTitle>
        {!editing && (
          <Button variant="ghost" size="sm" onClick={() => setEditing(true)}>
            <Edit2 className="w-4 h-4 mr-1" /> Edit
          </Button>
        )}
      </CardHeader>
      <CardContent className="space-y-3">
        <div>
          <Label className="text-xs text-muted-foreground">Full Name</Label>
          {editing
            ? <Input value={form.fullName} onChange={e => setForm(f => ({ ...f, fullName: e.target.value }))} className="mt-1" />
            : <p className="font-medium mt-0.5">{fullName || '—'}</p>}
        </div>
        <div>
          <Label className="text-xs text-muted-foreground">Phone</Label>
          {editing
            ? <Input value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} className="mt-1" placeholder="Phone number" />
            : <p className="font-medium mt-0.5">{phone || '—'}</p>}
        </div>
        <div>
          <Label className="text-xs text-muted-foreground">Email (read-only)</Label>
          <p className="font-medium text-muted-foreground mt-0.5">{email}</p>
        </div>
        <div>
          <Label className="text-xs text-muted-foreground">Ashraya Level</Label>
          {editing ? (
            <Select value={form.ashrayLevel} onValueChange={v => setForm(f => ({ ...f, ashrayLevel: v || '' }))}>
              <SelectTrigger className="mt-1">
                <SelectValue placeholder="Select Ashraya Level">
                  {form.ashrayLevel}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {ASHRAY_LEVELS.map(l => <SelectItem key={l} value={l}>{l}</SelectItem>)}
              </SelectContent>
            </Select>
          ) : (
            <div className="mt-0.5">
              {ashrayLevel
                ? <Badge variant="secondary" className="gap-1"><Star className="w-3 h-3" />{ashrayLevel}</Badge>
                : <p className="text-muted-foreground text-sm">—</p>}
            </div>
          )}
        </div>
        {editing && (
          <div className="flex gap-2 pt-1">
            <Button size="sm" onClick={handleSave} disabled={saving}>
              {saving ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : <Check className="w-4 h-4 mr-1" />}
              Save
            </Button>
            <Button size="sm" variant="ghost" onClick={handleCancel} disabled={saving}>
              <X className="w-4 h-4 mr-1" /> Cancel
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
