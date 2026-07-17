import { useState } from 'react';
import { useAuth } from 'zite-auth-sdk';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Calendar, LogIn, Trash2, Loader2 } from 'lucide-react';
import { format } from 'date-fns';
import { deleteAccount } from 'zite-endpoints-sdk';
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
  const { user, logout } = useAuth();
  const [deleteConfirm, setDeleteConfirm] = useState('');
  const [deleting, setDeleting] = useState(false);

  const handleDelete = async () => {
    if (!user?.email || deleteConfirm !== 'DELETE') return;
    setDeleting(true);
    try {
      await deleteAccount({ email: user.email, confirmText: 'DELETE' });
      toast.success('Account deleted. You will be logged out.');
      setTimeout(() => logout({ returnTo: '/' }), 2000);
    } catch (err: any) {
      toast.error(err?.message || 'Failed to delete account');
      setDeleting(false);
    }
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
                  This will permanently wipe all your data. Type <strong>DELETE</strong> to confirm:
                </AlertDialogDescription>
              </AlertDialogHeader>
              <Input value={deleteConfirm} onChange={e => setDeleteConfirm(e.target.value)} placeholder="Type DELETE to confirm" className="mt-2" />
              <AlertDialogFooter>
                <AlertDialogCancel onClick={() => setDeleteConfirm('')}>Cancel</AlertDialogCancel>
                <AlertDialogAction onClick={handleDelete} disabled={deleteConfirm !== 'DELETE' || deleting}
                  className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
                  {deleting && <Loader2 className="w-4 h-4 animate-spin mr-1" />}
                  Permanently Delete
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </CardContent>
    </Card>
  );
}
