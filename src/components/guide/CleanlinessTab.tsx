import { useState, useEffect, useCallback } from 'react';
import { format, subDays } from 'date-fns';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter, DialogClose } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import { UserPlus, X, AlertTriangle, Search, Users, Plus, Pencil, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { ConfirmDialog } from '@/shared';
import {
  getCleanlinessRooms, getCleanlinessAnalytics,
  toggleCleanlinessManager, toggleCleanlinessEnabled, getGuideUsers,
  manageCleanlinessRoom,
} from 'zite-endpoints-sdk';

interface Room {
  roomId: string;
  roomNumber: string;
  occupants: { id: string; name: string }[];
}

interface Manager { id: string; name: string; }

interface AnalyticsRow {
  userId: string;
  name: string;
  roomNumber: string;
  cleanDays: number;
  totalDays: number;
  percentage: number;
}

interface ResidentUser { id: string; name: string; }

export default function CleanlinessTab({ guideId, residencies }: {
  guideId: string;
  residencies: { id: string; residencyName: string }[];
}) {
  const selectedResidency = residencies[0];
  const [residencyId, setResidencyId] = useState(selectedResidency?.id || '');
  const [enabled, setEnabled] = useState(false);
  const [rooms, setRooms] = useState<Room[]>([]);
  const [managers, setManagers] = useState<Manager[]>([]);
  const [analytics, setAnalytics] = useState<AnalyticsRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [residents, setResidents] = useState<ResidentUser[]>([]);

  // Manager dialog
  const [showAppointManager, setShowAppointManager] = useState(false);
  const [managerSearch, setManagerSearch] = useState('');

  // Room dialog
  const [roomDialogOpen, setRoomDialogOpen] = useState(false);
  const [editingRoom, setEditingRoom] = useState<Room | null>(null);
  const [roomNumber, setRoomNumber] = useState('');
  const [selectedOccupants, setSelectedOccupants] = useState<Set<string>>(new Set());
  const [roomSaving, setRoomSaving] = useState(false);
  const [deleteRoom, setDeleteRoom] = useState<Room | null>(null);
  const [occupantSearch, setOccupantSearch] = useState('');

  const loadData = useCallback(async () => {
    if (!residencyId) return;
    setLoading(true);
    try {
      const endDate = format(new Date(), 'yyyy-MM-dd');
      const startDate = format(subDays(new Date(), 30), 'yyyy-MM-dd');
      const [roomsRes, analyticsRes, usersRes] = await Promise.all([
        getCleanlinessRooms({ residencyId }),
        getCleanlinessAnalytics({ residencyId, startDate, endDate }),
        getGuideUsers({ guideId }),
      ]);
      setRooms(roomsRes.rooms as Room[]);
      setEnabled(roomsRes.enabled as boolean);
      setAnalytics((analyticsRes as any).analytics || []);
      setManagers((analyticsRes as any).managers || []);
      // Only include active residents in this residency
      const users = ((usersRes as any).users || [])
        .filter((u: any) =>
          (u.status || '').toUpperCase() === 'ACTIVE' &&
          u.residencyApproved === true &&
          u.residencyId === residencyId
        )
        .map((u: any) => ({ id: u.userId, name: u.fullName || '' }));
      setResidents(users);
    } catch {
      toast.error('Failed to load cleanliness data');
    }
    setLoading(false);
  }, [residencyId, guideId]);

  useEffect(() => { loadData(); }, [loadData]);

  const handleToggleEnabled = async (val: boolean) => {
    try {
      await toggleCleanlinessEnabled({ residencyId, enabled: val });
      setEnabled(val);
      toast.success(val ? 'Cleanliness tracking enabled' : 'Cleanliness tracking disabled');
    } catch { toast.error('Failed to update'); }
  };

  const handleToggleManager = async (userId: string, isManager: boolean) => {
    try {
      await toggleCleanlinessManager({ userId, isManager });
      toast.success(isManager ? 'Manager appointed' : 'Manager removed');
      setShowAppointManager(false);
      setManagerSearch('');
      await loadData();
    } catch { toast.error('Failed'); }
  };

  // Room CRUD
  const openAddRoom = () => {
    setEditingRoom(null);
    setRoomNumber('');
    setSelectedOccupants(new Set());
    setOccupantSearch('');
    setRoomDialogOpen(true);
  };

  const openEditRoom = (room: Room) => {
    setEditingRoom(room);
    setRoomNumber(room.roomNumber);
    setSelectedOccupants(new Set(room.occupants.map(o => o.id)));
    setOccupantSearch('');
    setRoomDialogOpen(true);
  };

  const handleSaveRoom = async () => {
    if (!roomNumber.trim()) { toast.error('Enter a room number'); return; }
    setRoomSaving(true);
    try {
      if (editingRoom) {
        await manageCleanlinessRoom({
          action: 'update',
          roomId: editingRoom.roomId,
          roomNumber: roomNumber.trim(),
          occupantIds: Array.from(selectedOccupants),
        });
        toast.success('Room updated');
      } else {
        await manageCleanlinessRoom({
          action: 'create',
          roomNumber: roomNumber.trim(),
          residencyId,
          occupantIds: Array.from(selectedOccupants),
        });
        toast.success('Room created');
      }
      setRoomDialogOpen(false);
      await loadData();
    } catch (err: any) { toast.error(err?.message || 'Failed to save room'); }
    setRoomSaving(false);
  };

  const handleDeleteRoom = async () => {
    if (!deleteRoom) return;
    try {
      await manageCleanlinessRoom({ action: 'delete', roomId: deleteRoom.roomId });
      toast.success('Room deleted');
      setDeleteRoom(null);
      await loadData();
    } catch (err: any) { toast.error(err?.message || 'Failed to delete room'); }
  };

  const toggleOccupant = (id: string) => {
    setSelectedOccupants(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  if (loading) {
    return <div className="space-y-4">{[1, 2, 3].map(i => <Skeleton key={i} className="h-24 w-full rounded-xl" />)}</div>;
  }

  const residencyName = residencies.find(r => r.id === residencyId)?.residencyName || '';

  // Filter for Appoint Manager dialog: residents NOT already managers
  const availableManagers = residents
    .filter(u => !managers.some(m => m.id === u.id))
    .filter(u => !managerSearch || u.name.toLowerCase().includes(managerSearch.toLowerCase()));

  // Occupants already assigned to other rooms (for display warning)
  const assignedOccupants = new Set<string>();
  rooms.forEach(r => {
    if (editingRoom && r.roomId === editingRoom.roomId) return;
    r.occupants.forEach(o => assignedOccupants.add(o.id));
  });

  const filteredResidents = residents.filter(u =>
    !occupantSearch || u.name.toLowerCase().includes(occupantSearch.toLowerCase())
  );

  return (
    <div className="space-y-6">
      {residencies.length > 1 && (
        <Select value={residencyId} onValueChange={setResidencyId}>
          <SelectTrigger className="w-full sm:w-64"><SelectValue /></SelectTrigger>
          <SelectContent>
            {residencies.map(r => (
              <SelectItem key={r.id} value={r.id}>{r.residencyName}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}

      <div className="flex items-center justify-between bg-card border rounded-lg p-4">
        <div>
          <Label className="text-base font-medium">Cleanliness Tracking</Label>
          <p className="text-xs text-muted-foreground">Enable daily room inspections for {residencyName}</p>
        </div>
        <Switch checked={enabled} onCheckedChange={handleToggleEnabled} />
      </div>

      {!enabled && (
        <div className="text-center py-8 text-muted-foreground">
          Enable cleanliness tracking above to manage rooms and inspections.
        </div>
      )}

      {enabled && (
        <>
          {/* ── Room Setup ── */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
                Rooms ({rooms.length})
              </h3>
              <Button variant="outline" size="sm" onClick={openAddRoom}>
                <Plus className="w-3.5 h-3.5 mr-1" /> Add Room
              </Button>
            </div>
            {rooms.length === 0 ? (
              <div className="text-center py-8 border rounded-lg bg-card">
                <Users className="w-8 h-8 mx-auto mb-2 text-muted-foreground/40" />
                <p className="text-sm font-medium text-muted-foreground">No rooms configured yet</p>
                <p className="text-xs text-muted-foreground mt-1">Add rooms and assign residents to start tracking cleanliness.</p>
                <Button variant="outline" size="sm" className="mt-3" onClick={openAddRoom}>
                  <Plus className="w-3.5 h-3.5 mr-1" /> Add First Room
                </Button>
              </div>
            ) : (
              <div className="bg-card border rounded-lg divide-y">
                {rooms.map(room => (
                  <div key={room.roomId} className="p-3 flex items-center justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-sm">Room {room.roomNumber}</p>
                      <p className="text-xs text-muted-foreground truncate">
                        {room.occupants.length > 0
                          ? room.occupants.map(o => o.name).join(', ')
                          : <span className="italic">No occupants assigned</span>}
                      </p>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <Badge variant="secondary" className="text-xs">{room.occupants.length}</Badge>
                      <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => openEditRoom(room)}>
                        <Pencil className="w-3.5 h-3.5" />
                      </Button>
                      <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-destructive" onClick={() => setDeleteRoom(room)}>
                        <Trash2 className="w-3.5 h-3.5" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* ── Cleanliness Managers ── */}
          <div className="space-y-3">
            <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">Cleanliness Managers</h3>
            <div className="flex items-center gap-2 flex-wrap">
              {managers.length === 0 && (
                <span className="text-sm text-muted-foreground italic">No managers appointed yet</span>
              )}
              {managers.map(m => (
                <span key={m.id} className="px-3 py-1 rounded-full bg-muted text-sm flex items-center gap-1">
                  {m.name}
                  <button className="text-muted-foreground hover:text-destructive" onClick={() => handleToggleManager(m.id, false)}>
                    <X className="w-3.5 h-3.5" />
                  </button>
                </span>
              ))}
              <Dialog open={showAppointManager} onOpenChange={(open) => { setShowAppointManager(open); if (!open) setManagerSearch(''); }}>
                <DialogTrigger asChild>
                  <Button variant="outline" size="sm"><UserPlus className="w-3.5 h-3.5 mr-1" /> Appoint Manager</Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader><DialogTitle>Appoint Cleanliness Manager</DialogTitle></DialogHeader>
                  <p className="text-xs text-muted-foreground">Only FOLK residents of {residencyName} are shown below.</p>
                  <div className="relative">
                    <Search className="w-4 h-4 absolute left-2.5 top-2.5 text-muted-foreground" />
                    <Input placeholder="Search residents..." className="pl-8" value={managerSearch} onChange={e => setManagerSearch(e.target.value)} />
                  </div>
                  <div className="space-y-1 max-h-64 overflow-y-auto">
                    {availableManagers.length === 0 ? (
                      <div className="flex flex-col items-center py-6 text-muted-foreground">
                        <Users className="w-8 h-8 mb-2 opacity-40" />
                        <p className="text-sm font-medium">No residents available</p>
                        <p className="text-xs mt-1">
                          {managerSearch ? 'Try a different search' : 'All residents are already managers'}
                        </p>
                      </div>
                    ) : (
                      availableManagers.map(u => (
                        <button key={u.id} className="w-full text-left px-3 py-2 rounded-md hover:bg-muted text-sm"
                          onClick={() => handleToggleManager(u.id, true)}>
                          {u.name}
                        </button>
                      ))
                    )}
                  </div>
                </DialogContent>
              </Dialog>
            </div>
          </div>

          {/* ── Analytics ── */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">Cleanliness Analytics</h3>
              <span className="text-xs text-muted-foreground">Last 30 days</span>
            </div>
            {analytics.length === 0 ? (
              <p className="text-sm text-muted-foreground py-4 text-center">No inspection data yet. Once a Cleanliness Manager starts rating rooms, analytics will appear here.</p>
            ) : (
              <div className="bg-card border rounded-lg overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b">
                      <th className="text-left py-2 px-3 font-medium">Name</th>
                      <th className="text-left py-2 px-3 font-medium">Room</th>
                      <th className="text-right py-2 px-3 font-medium">Clean Days</th>
                      <th className="text-right py-2 px-3 font-medium">%</th>
                    </tr>
                  </thead>
                  <tbody>
                    {analytics.map(row => (
                      <tr key={row.userId} className="border-b last:border-0">
                        <td className="py-2 px-3">{row.name}</td>
                        <td className="py-2 px-3 text-muted-foreground">{row.roomNumber}</td>
                        <td className="py-2 px-3 text-right">{row.cleanDays}/{row.totalDays}</td>
                        <td className={`py-2 px-3 text-right font-medium ${row.percentage < 50 ? 'text-destructive' : ''}`}>
                          {row.percentage}%
                          {row.percentage < 50 && <AlertTriangle className="w-3 h-3 inline ml-1" />}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}

      {/* ── Room Add/Edit Dialog ── */}
      <Dialog open={roomDialogOpen} onOpenChange={o => { if (!o) setRoomDialogOpen(false); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{editingRoom ? 'Edit Room' : 'Add Room'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label className="text-sm font-medium">Room Number</Label>
              <Input
                placeholder="e.g. 101, A-3, etc."
                value={roomNumber}
                onChange={e => setRoomNumber(e.target.value)}
                className="mt-1"
              />
            </div>
            <div>
              <Label className="text-sm font-medium">Assign Occupants</Label>
              <p className="text-xs text-muted-foreground mb-2">Select residents who live in this room</p>
              <div className="relative mb-2">
                <Search className="w-4 h-4 absolute left-2.5 top-2.5 text-muted-foreground" />
                <Input placeholder="Search residents..." className="pl-8" value={occupantSearch} onChange={e => setOccupantSearch(e.target.value)} />
              </div>
              <div className="border rounded-md max-h-48 overflow-y-auto">
                {filteredResidents.length === 0 ? (
                  <p className="text-xs text-muted-foreground text-center py-4">No residents found</p>
                ) : (
                  filteredResidents.map(u => {
                    const isInOtherRoom = assignedOccupants.has(u.id);
                    return (
                      <label key={u.id} className="flex items-center gap-2 px-3 py-2 hover:bg-muted cursor-pointer text-sm">
                        <Checkbox
                          checked={selectedOccupants.has(u.id)}
                          onCheckedChange={() => toggleOccupant(u.id)}
                        />
                        <span className="flex-1">{u.name}</span>
                        {isInOtherRoom && (
                          <span className="text-xs text-amber-600">already in another room</span>
                        )}
                      </label>
                    );
                  })
                )}
              </div>
              {selectedOccupants.size > 0 && (
                <p className="text-xs text-muted-foreground mt-1">{selectedOccupants.size} selected</p>
              )}
            </div>
          </div>
          <DialogFooter className="gap-2">
            <DialogClose asChild>
              <Button variant="outline">Cancel</Button>
            </DialogClose>
            <Button onClick={handleSaveRoom} disabled={roomSaving || !roomNumber.trim()}>
              {roomSaving ? 'Saving...' : editingRoom ? 'Update Room' : 'Create Room'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Delete Room Confirm ── */}
      <ConfirmDialog
        open={!!deleteRoom}
        onOpenChange={o => !o && setDeleteRoom(null)}
        title="Delete Room"
        description={`Delete Room ${deleteRoom?.roomNumber}? This will also remove all inspection data for this room.`}
        confirmLabel="Delete"
        onConfirm={handleDeleteRoom}
      />
    </div>
  );
}
