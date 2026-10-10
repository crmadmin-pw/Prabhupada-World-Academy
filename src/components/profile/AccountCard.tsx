import { useState } from 'react';
import { useAuth } from '@/lib/auth-sdk';
import { useUserProfile } from '@/contexts/UserProfileContext';
import { ACCOUNT_DELETE_CONFIRM_TEXT, ACCOUNT_DELETION_GRACE_DAYS } from '@/lib/accountDeletionPolicy';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Calendar, LogIn, Trash2, Loader2 } from 'lucide-react';
import { format } from 'date-fns';
import { deleteAccount } from '@/lib/endpoints-sdk';
import { toast } from 'sonner';

interface Props {
  createdAt?: string;
  lastLoginAt?: string;
}

function safeDate(val: unknown, includeTime = false): string {
  const d = new Date(String(val ?? ''));
  if (isNaN(d.getTime())) return '—';
  return includeTime ? format(d, 'MMM dd, yyyy, h:mm a') : format(d, 'MMM dd, yyyy');
}

export default function AccountCard({ createdAt, lastLoginAt }: Props) {
  const { user, reauthenticate } = useAuth();
  const { refreshProfile } = useUserProfile();
  const [deleteConfirm, setDeleteConfirm] = useState('');
  const [deleting, setDeleting] = useState(false);
  const confirmed = deleteConfirm.trim() === ACCOUNT_DELETE_CONFIRM_TEXT;

  const handleDelete = () => {
    if (!user?.email || !confirmed) return;
    const email = user.email;
    setDeleting(true);
    void reauthenticate()
      .then(() => deleteAccount({ action: 'schedule', email, confirmText: ACCOUNT_DELETE_CONFIRM_TEXT }))
      .then(async result => {
        const purgeDate = result.purgeAt ? safeDate(result.purgeAt) : null;
        toast.success(purgeDate
          ? `Account scheduled for deletion on ${purgeDate}. You can cancel until then.`
          : 'Account scheduled for deletion. You can cancel during the recovery period.');
        await refreshProfile();
      })
      .catch((err: any) => {
        const code = String(err?.code || '');
        const message = String(err?.message || '');
        toast.error(code.includes('popup-closed') || message.toLowerCase().includes('popup-closed')
          ? 'Sign-in was cancelled. Your account was not deleted.'
          : (message || 'Failed to schedule account deletion'));
        setDeleting(false);
      });
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Account Information</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <div className="flex items-center gap-2">
          <Calendar className="w-4 h-4 text-muted-foreground shrink-0" />
          <span className="text-muted-foreground">Member since:</span>
          <span className="font-medium">{safeDate(createdAt)}</span>
        </div>
        <div className="flex items-center gap-2">
          <LogIn className="w-4 h-4 text-muted-foreground shrink-0" />
          <span className="text-muted-foreground">Last login:</span>
          <span className="font-medium">{safeDate(lastLoginAt, true)}</span>
        </div>
        <div className="border-t pt-3">
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="destructive" size="sm" className="w-full">
                <Trash2 className="w-4 h-4 mr-2" /> Delete Account
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Delete Your Account</AlertDialogTitle>
                <AlertDialogDescription>
                  Your account is deactivated now and permanently deleted after {ACCOUNT_DELETION_GRACE_DAYS} days. Rent, trip, service, attendance, challenge, and file records leave reports immediately and can be restored if you cancel during that time. Type <strong>DELETE</strong>, then sign in again.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <Input value={deleteConfirm} onChange={e => setDeleteConfirm(e.target.value)} placeholder="Type DELETE to confirm" className="mt-2" />
              <AlertDialogFooter>
                <AlertDialogCancel onClick={() => setDeleteConfirm('')}>Cancel</AlertDialogCancel>
                <AlertDialogAction type="button" onClick={handleDelete} disabled={!confirmed || deleting}
                  className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
                  {deleting && <Loader2 className="w-4 h-4 animate-spin mr-1" />}
                  Sign in again and schedule deletion
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </CardContent>
    </Card>
  );
}
