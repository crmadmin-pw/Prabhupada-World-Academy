import { useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { format } from 'date-fns';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/lib/auth-sdk';
import { useUserProfile } from '@/contexts/UserProfileContext';
import { deleteAccount } from '@/lib/endpoints-sdk';
import { ACCOUNT_DELETION_GRACE_DAYS } from '@/lib/accountDeletionPolicy';

function purgeLabel(value?: string | null): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return format(date, 'MMM dd, yyyy');
}

export default function AccountDeletionPage() {
  const navigate = useNavigate();
  const { user, isLoading: authLoading, logout } = useAuth();
  const { profile, isLoading: profileLoading, profileError, refreshProfile } = useUserProfile();
  const [cancelling, setCancelling] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const purgeDate = purgeLabel(profile?.deletionPurgeAt);

  const handleCancel = async () => {
    setCancelling(true);
    setError(null);
    try {
      await deleteAccount({ action: 'cancel' });
      toast.success('Account deletion cancelled. Your records have been restored.');
      await refreshProfile();
      navigate('/dashboard');
    } catch (err: any) {
      setError(err?.message || 'Could not cancel account deletion. Please try again.');
      setCancelling(false);
    }
  };

  if (authLoading || profileLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }
  if (!user) return <Navigate to="/" replace />;
  if (profileError) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-4">
        <p className="text-sm text-muted-foreground">{profileError}</p>
      </div>
    );
  }
  if (!profile) return <Navigate to="/register" replace />;
  if (profile.status !== 'PENDING_DELETION') return <Navigate to="/dashboard" replace />;

  return (
    <div className="min-h-screen bg-gradient-to-b from-background to-secondary flex items-center justify-center p-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle className="text-2xl">Account scheduled for deletion</CardTitle>
          <CardDescription>
            {purgeDate
              ? `Your account and its records will be permanently deleted on ${purgeDate}.`
              : `Your account and its records will be permanently deleted after ${ACCOUNT_DELETION_GRACE_DAYS} days.`}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Rent, trip, service, attendance, challenge, and file records are hidden from reports during this recovery period. Cancel deletion to restore the account and those records.
          </p>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <Button className="w-full" onClick={handleCancel} disabled={cancelling}>
            {cancelling && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Cancel deletion
          </Button>
          <Button className="w-full" variant="outline" onClick={() => logout({ returnTo: '/' })} disabled={cancelling}>
            Sign out
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
