import { useState, useEffect, useCallback } from 'react';
import { format, addDays, subDays } from 'date-fns';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { ChevronLeft, ChevronRight, Camera, Check, X } from 'lucide-react';
import { toast } from 'sonner';
import { uploadFile } from 'zite-file-upload-sdk';
import {
  getCleanlinessRooms, getCleanlinessInspections, submitCleanlinessInspection,
} from 'zite-endpoints-sdk';
import type { GetCleanlinessRoomsOutputType } from 'zite-endpoints-sdk';

type Room = GetCleanlinessRoomsOutputType['rooms'][0];

interface RoomInspection {
  roomId: string;
  score: number | null;
  photo: string | null;
  comment: string;
  existingId?: string;
}

export default function CleanlinessManagerDashboard({ residencyId, residencyName }: {
  residencyId: string;
  residencyName?: string;
}) {
  const today = format(new Date(), 'yyyy-MM-dd');
  const [date, setDate] = useState(today);
  const [rooms, setRooms] = useState<Room[]>([]);
  const [inspections, setInspections] = useState<Map<string, RoomInspection>>(new Map());
  const [loading, setLoading] = useState(true);
  const [pendingScores, setPendingScores] = useState<Map<string, number>>(new Map());
  const [pendingComments, setPendingComments] = useState<Map<string, string>>(new Map());
  const [submittingRoom, setSubmittingRoom] = useState<string | null>(null);
  const [uploadingRoom, setUploadingRoom] = useState<string | null>(null);
  const [pendingPhotos, setPendingPhotos] = useState<Map<string, string>>(new Map());

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [roomsRes, inspRes] = await Promise.all([
        getCleanlinessRooms({ residencyId }),
        getCleanlinessInspections({ residencyId, date }),
      ]);
      setRooms(roomsRes.rooms as Room[]);
      const map = new Map<string, RoomInspection>();
      ((inspRes as any).inspections || []).forEach((i: any) => {
        map.set(i.roomId, {
          roomId: i.roomId,
          score: i.score,
          photo: i.photo,
          comment: i.comment || '',
          existingId: i.id,
        });
      });
      setInspections(map);
      setPendingScores(new Map());
      setPendingComments(new Map());
      setPendingPhotos(new Map());
    } catch {
      toast.error('Failed to load rooms');
    }
    setLoading(false);
  }, [residencyId, date]);

  useEffect(() => { loadData(); }, [loadData]);

  const handleSubmit = async (roomId: string) => {
    const score = pendingScores.get(roomId) ?? inspections.get(roomId)?.score;
    if (score === null || score === undefined) {
      toast.error('Please select a rating first');
      return;
    }
    setSubmittingRoom(roomId);
    try {
      const comment = pendingComments.get(roomId) ?? inspections.get(roomId)?.comment ?? '';
      const photoUrl = pendingPhotos.get(roomId) ?? inspections.get(roomId)?.photo ?? undefined;
      await submitCleanlinessInspection({
        roomId,
        residencyId,
        date,
        score,
        comment: comment || undefined,
        photoUrl: photoUrl || undefined,
      });
      toast.success('Inspection saved');
      await loadData();
    } catch (err: any) {
      toast.error(err?.message || 'Failed to save');
    }
    setSubmittingRoom(null);
  };

  const handlePhotoUpload = async (roomId: string, file: File) => {
    setUploadingRoom(roomId);
    try {
      const { fileUrl } = await uploadFile({ data: file, filename: file.name });
      setPendingPhotos(prev => new Map(prev).set(roomId, fileUrl));
      toast.success('Photo uploaded');
    } catch {
      toast.error('Upload failed');
    }
    setUploadingRoom(null);
  };

  const ratedCount = rooms.filter(r => inspections.has(r.roomId)).length;
  const canGoForward = date < today;

  if (loading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-12 w-full" />
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {[1, 2, 3, 4].map(i => <Skeleton key={i} className="h-48 w-full rounded-xl" />)}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold">Cleanliness Inspections</h2>
          <p className="text-sm text-muted-foreground">
            {residencyName || 'FOLK Center'} · {format(new Date(date + 'T12:00:00'), 'EEEE, d MMM yyyy')}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="icon" onClick={() => setDate(format(subDays(new Date(date + 'T12:00:00'), 1), 'yyyy-MM-dd'))}>
            <ChevronLeft className="w-4 h-4" />
          </Button>
          <span className="text-sm font-medium px-2 min-w-[100px] text-center">
            {format(new Date(date + 'T12:00:00'), 'd MMM yyyy')}
          </span>
          <Button variant="outline" size="icon" disabled={!canGoForward}
            onClick={() => setDate(format(addDays(new Date(date + 'T12:00:00'), 1), 'yyyy-MM-dd'))}>
            <ChevronRight className="w-4 h-4" />
          </Button>
        </div>
      </div>

      {/* Progress */}
      <div className="bg-card border rounded-lg p-3 flex items-center justify-between">
        <span className="text-sm font-medium">{ratedCount}/{rooms.length} rooms rated</span>
        {ratedCount === rooms.length && rooms.length > 0 && (
          <Badge variant="default" className="bg-primary">All Done ✓</Badge>
        )}
      </div>

      {/* Room Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {rooms.map(room => {
          const existing = inspections.get(room.roomId);
          const pScore = pendingScores.get(room.roomId);
          const pComment = pendingComments.get(room.roomId);
          const pPhoto = pendingPhotos.get(room.roomId);
          const isRated = !!existing;
          const displayScore = pScore ?? existing?.score ?? null;
          const displayPhoto = pPhoto ?? existing?.photo;
          const displayComment = pComment ?? existing?.comment ?? '';
          const hasChanges = pScore !== undefined || pComment !== undefined || pPhoto !== undefined;

          return (
            <div key={room.roomId} className="rounded-xl border bg-card p-4 space-y-3 shadow-sm">
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-semibold">Room {room.roomNumber}</p>
                  <p className="text-xs text-muted-foreground">
                    {room.occupants.map(o => o.name).join(', ') || 'No occupants'}
                  </p>
                </div>
                {isRated && !hasChanges ? (
                  <Badge variant={existing.score === 1 ? 'default' : 'destructive'}>
                    {existing.score === 1 ? '1 pt — Clean' : '0 pt — Not Clean'}
                  </Badge>
                ) : displayScore !== null ? (
                  <Badge variant={displayScore === 1 ? 'default' : 'destructive'}>
                    {displayScore === 1 ? '1 pt — Clean' : '0 pt — Not Clean'}
                  </Badge>
                ) : (
                  <Badge variant="secondary">Not rated</Badge>
                )}
              </div>

              {/* Score buttons */}
              <div className="flex gap-2">
                <Button
                  variant={displayScore === 1 ? 'default' : 'outline'}
                  className="flex-1"
                  size="sm"
                  onClick={() => setPendingScores(prev => new Map(prev).set(room.roomId, 1))}
                >
                  <Check className="w-3.5 h-3.5 mr-1" /> 1 — Clean
                </Button>
                <Button
                  variant={displayScore === 0 ? 'destructive' : 'outline'}
                  className="flex-1"
                  size="sm"
                  onClick={() => setPendingScores(prev => new Map(prev).set(room.roomId, 0))}
                >
                  <X className="w-3.5 h-3.5 mr-1" /> 0 — Not Clean
                </Button>
              </div>

              {/* Photo */}
              {displayPhoto && (
                <div className="relative w-full h-28 bg-muted rounded-md overflow-hidden animate-pulse">
                  <img
                    src={displayPhoto}
                    alt="Room inspection"
                    className="w-full h-full object-cover opacity-0 transition-opacity duration-300"
                    onLoad={(e) => {
                      e.currentTarget.parentElement?.classList.remove('animate-pulse');
                      e.currentTarget.classList.remove('opacity-0');
                    }}
                  />
                </div>
              )}

              {/* Comment */}
              <Input
                placeholder="Add comment (optional)..."
                value={displayComment}
                onChange={e => setPendingComments(prev => new Map(prev).set(room.roomId, e.target.value))}
                className="text-sm"
              />

              {/* Photo upload + Submit */}
              <div className="flex items-center justify-between">
                <label className="cursor-pointer text-xs text-primary font-medium flex items-center gap-1">
                  <Camera className="w-3.5 h-3.5" />
                  {uploadingRoom === room.roomId ? 'Uploading...' : 'Attach photo'}
                  <input
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={e => {
                      const f = e.target.files?.[0];
                      if (f) handlePhotoUpload(room.roomId, f);
                      e.target.value = '';
                    }}
                  />
                </label>
                {(hasChanges || (!isRated && displayScore !== null)) && (
                  <Button size="sm" disabled={submittingRoom === room.roomId || displayScore === null}
                    onClick={() => handleSubmit(room.roomId)}>
                    {submittingRoom === room.roomId ? 'Saving...' : isRated ? 'Update' : 'Submit'}
                  </Button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {rooms.length === 0 && (
        <div className="text-center py-12 text-muted-foreground">
          No rooms configured for this center yet. Ask your Guide to set up rooms in the Cleanliness tab.
        </div>
      )}
    </div>
  );
}
