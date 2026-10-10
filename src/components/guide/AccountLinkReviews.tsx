import { useEffect } from 'react';
import { useReactiveLoader } from '@/hooks/useReactiveLoader';
import { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import { getPendingAccountLinks, reviewAccountLink } from '@/lib/endpoints-sdk';
import { AsyncButton, ConfirmDialog, EmptyState } from '@/shared';
import { Link2 } from 'lucide-react';

interface AccountLinkCandidate {
  id: string;
  userId?: string;
  fullName?: string;
  email?: string;
  role?: string;
  status?: string;
  segment?: string;
  alreadyLinked?: boolean;
}

interface AccountLinkRequestRow {
  id: string;
  email: string;
  status: string;
  createdAt?: string | null;
  notes?: string;
  candidates: AccountLinkCandidate[];
}

export default function AccountLinkReviews({ onCountChange }: { onCountChange?: (count: number) => void }) {
  const [requests, setRequests] = useState<AccountLinkRequestRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [confirmLink, setConfirmLink] = useState<{ requestId: string; profileId: string; name: string; email: string } | null>(null);

  const load = useReactiveLoader(async (read) => {
    try {
      const rows = await read(() => getPendingAccountLinks({}));
      const list = Array.isArray(rows) ? rows as AccountLinkRequestRow[] : [];
      setRequests(list);
      onCountChange?.(list.filter(row => row.status === 'Pending').length);
    } catch (error: any) {
      if (!read.cancelled) toast.error(error?.message || 'Could not load account links');
    } finally {
      if (!read.cancelled) setLoading(false);
    }
  }, [onCountChange]);

  useEffect(() => {
    void load();
  }, [load]);

  const review = async (requestId: string, action: 'approve' | 'reject' | 'reopen', profileId?: string) => {
    try {
      await reviewAccountLink({ requestId, action, profileId });
      const message = action === 'approve'
        ? 'Login linked to the selected profile'
        : action === 'reject'
          ? 'Link request rejected. No profile was changed.'
          : 'Link request opened for review again';
      toast.success(message);
      await load();
    } catch (error: any) {
      toast.error(error?.message || 'Could not update this link');
      throw error;
    }
  };

  if (loading) return <div className="py-8 text-center text-muted-foreground">Loading account links...</div>;

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>Login links</CardTitle>
          <CardDescription>
            Someone signed in with an email that matches an existing profile. Confirm the link before their login is attached. Nothing is merged or deleted until you approve.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {requests.length === 0 && (
            <EmptyState
              icon={Link2}
              title="No login links waiting"
              description="A first login that matches an existing profile will appear here for review."
            />
          )}
          {requests.map(request => (
            <div key={request.id} className="rounded-lg border p-4 space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                <p className="font-medium">{request.email}</p>
                <Badge variant={request.status === 'Pending' ? 'default' : 'secondary'}>{request.status}</Badge>
              </div>
              <div className="space-y-2">
                {request.candidates.map(candidate => (
                  <div key={candidate.id} className="flex flex-col gap-2 rounded-md bg-muted/40 p-3 sm:flex-row sm:items-center sm:justify-between">
                    <div className="text-sm">
                      <p className="font-medium">{candidate.fullName || 'Unnamed profile'}</p>
                      <p className="text-muted-foreground">
                        {candidate.userId || candidate.id}
                        {candidate.role ? ` · ${candidate.role}` : ''}
                        {candidate.status ? ` · ${candidate.status}` : ''}
                        {candidate.segment ? ` · ${candidate.segment}` : ''}
                      </p>
                      {candidate.alreadyLinked && (
                        <p className="text-amber-700">This profile is already linked to a different login.</p>
                      )}
                    </div>
                    {request.status === 'Pending' && (
                      <AsyncButton
                        size="sm"
                        disabled={!!candidate.alreadyLinked}
                        onClickAsync={async () => {
                          setConfirmLink({
                            requestId: request.id,
                            profileId: candidate.id,
                            name: candidate.fullName || candidate.userId || 'this profile',
                            email: request.email,
                          });
                        }}
                      >
                        Link this login
                      </AsyncButton>
                    )}
                  </div>
                ))}
              </div>
              <div className="flex flex-wrap gap-2">
                {request.status === 'Pending' && (
                  <AsyncButton variant="outline" onClickAsync={() => review(request.id, 'reject')}>
                    Reject
                  </AsyncButton>
                )}
                {request.status === 'Rejected' && (
                  <AsyncButton variant="outline" onClickAsync={() => review(request.id, 'reopen')}>
                    Review again
                  </AsyncButton>
                )}
              </div>
            </div>
          ))}
        </CardContent>
      </Card>
      <ConfirmDialog
        open={!!confirmLink}
        onOpenChange={open => { if (!open) setConfirmLink(null); }}
        title="Link this login?"
        description={confirmLink
          ? `This attaches ${confirmLink.email} to ${confirmLink.name}. Other profiles stay as they are. An empty sign-in placeholder for this login is removed if one exists.`
          : ''}
        confirmLabel="Link login"
        onConfirm={async () => {
          if (!confirmLink) return;
          await review(confirmLink.requestId, 'approve', confirmLink.profileId);
          setConfirmLink(null);
        }}
      />
    </>
  );
}
