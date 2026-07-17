import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { Plus, Pencil, Trash2, Clock, Users, Timer } from 'lucide-react';
import { toast } from 'sonner';
import { getServices, createService, updateService, deleteService } from 'zite-endpoints-sdk';
import type { GetServicesOutputType } from 'zite-endpoints-sdk';
import ServiceFormDialog from './ServiceFormDialog';

type Service = GetServicesOutputType['services'][0];

const CATEGORY_COLORS: Record<string, string> = {
  Altar: 'bg-purple-100 text-purple-700',
  Cleaning: 'bg-blue-100 text-blue-700',
  Prasadam: 'bg-orange-100 text-orange-700',
  Tech: 'bg-green-100 text-green-700',
  Other: 'bg-muted text-muted-foreground',
};

interface Props { residencyId?: string; serviceType?: string; }

export default function ServiceListTab({ residencyId, serviceType }: Props) {
  const [services, setServices] = useState<Service[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Service | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Service | null>(null);

  useEffect(() => { load(); }, [residencyId, serviceType]);

  const load = async () => {
    try {
      // Filter by residencyId (includes global services with no residencyId)
      const res = await getServices({ scope: 'all', includeInactive: true, residencyId });
      // Filter by serviceType if specified (default 'Weekly' for untagged services)
      const filtered = serviceType
        ? res.services.filter((s: any) => (s.serviceType || 'Weekly') === serviceType)
        : res.services;
      setServices(filtered);
    } catch { toast.error('Failed to load services'); }
    finally { setLoading(false); }
  };

  const handleSave = async (data: any) => {
    if (data.serviceId) {
      await updateService({ serviceId: data.serviceId, rowId: data.rowId, ...data });
      toast.success('Service updated');
    } else {
      await createService({ ...data, residencyId: residencyId ?? data.residencyId, serviceType: data.serviceType ?? serviceType ?? 'Weekly' });
      toast.success('Service created');
    }
    await load();
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    try {
      await deleteService({ serviceId: deleteTarget.serviceId });
      toast.success('Service deactivated');
      setDeleteTarget(null);
      await load();
    } catch { toast.error('Failed to delete service'); }
  };

  if (loading) return <div className="text-center py-8 text-muted-foreground">Loading services…</div>;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">{services.filter(s => s.isActive).length} active services for residency</p>
        <Button size="sm" onClick={() => { setEditing(null); setDialogOpen(true); }}><Plus className="w-4 h-4 mr-1" />Add Service</Button>
      </div>

      <div className="grid gap-3">
        {services.length === 0 && <p className="text-muted-foreground text-sm text-center py-6">No services yet.</p>}
        {services.map(s => (
          <Card key={s.serviceId} className={`${!s.isActive ? 'opacity-50' : ''}`}>
            <CardContent className="p-4">
              <div className="flex items-start justify-between gap-2">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium text-sm">{s.serviceName}</span>
                    {s.category && <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${CATEGORY_COLORS[s.category] ?? CATEGORY_COLORS.Other}`}>{s.category}</span>}
                    {!s.isActive && <Badge variant="secondary">Inactive</Badge>}
                  </div>
                  <div className="flex items-center gap-3 mt-1.5 text-xs text-muted-foreground flex-wrap">
                    <span className="flex items-center gap-1"><Clock className="w-3 h-3" />{s.timeSlot}</span>
                    {s.durationMinutes && <span className="flex items-center gap-1"><Timer className="w-3 h-3" />{s.durationMinutes} min</span>}
                    <span className="flex items-center gap-1"><Users className="w-3 h-3" />{s.peopleNeeded} needed</span>
                    {s.dueOffsetMinutes && <span>Overdue: +{s.dueOffsetMinutes}m</span>}
                  </div>
                  {(() => { let sk: string[] = []; try { sk = JSON.parse(s.requiredSkillsJson || '[]'); } catch {} return sk.length > 0 && <div className="flex gap-1 mt-1.5">{sk.map(k => <Badge key={k} variant="outline" className="text-xs">{k.replace(/_/g, ' ')}</Badge>)}</div>; })()}
                </div>
                <div className="flex gap-1 shrink-0">
                  <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => { setEditing(s); setDialogOpen(true); }}><Pencil className="w-3.5 h-3.5" /></Button>
                  <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive" onClick={() => setDeleteTarget(s)}><Trash2 className="w-3.5 h-3.5" /></Button>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <ServiceFormDialog open={dialogOpen} service={editing} serviceType={serviceType} onSave={handleSave} onClose={() => setDialogOpen(false)} />

      <AlertDialog open={!!deleteTarget} onOpenChange={v => !v && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader><AlertDialogTitle>Deactivate Service?</AlertDialogTitle>
            <AlertDialogDescription>"{deleteTarget?.serviceName}" will be hidden from new allocations. Existing allocations are preserved.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} className="bg-destructive text-destructive-foreground">Deactivate</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
