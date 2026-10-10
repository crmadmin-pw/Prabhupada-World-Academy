import { useEffect, useState } from 'react';
import { useParams, useSearchParams, useNavigate } from 'react-router-dom';
import { useAuth } from '@/lib/auth-sdk';
import { useUserProfile } from '@/contexts/UserProfileContext';
import { getUserDashboardPath } from '@/lib/userDashboardRoutes';
import { joinGroupByToken } from '@/lib/endpoints-sdk';
import { clearBvJoinToken, rememberBvJoinToken } from '@/lib/bvJoinInvite';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Leaf, CheckCircle2, AlertTriangle, Loader2 } from 'lucide-react';

export default function JoinGroupPage() {
  const [searchParams] = useSearchParams();
  const { token: pathToken = '' } = useParams();
  const navigate = useNavigate();
  const { profile } = useUserProfile();
  const { user, isLoading: authLoading, loginWithRedirect } = useAuth();
  const token = decodeURIComponent(pathToken || searchParams.get('token') || searchParams.get('join') || '');
  const isPwInvite = typeof window !== 'undefined' && window.location.pathname.endsWith('/pw');

  const [status, setStatus] = useState<'idle' | 'joining' | 'success' | 'error'>('idle');
  const [message, setMessage] = useState('');
  const [groupName, setGroupName] = useState('');

  useEffect(() => {
    if (authLoading) return;
    if (token) rememberBvJoinToken(token, isPwInvite);
    if (!user) {
      loginWithRedirect({ redirectUrl: window.location.href });
      return;
    }
    if (!token) return;
    if (status === 'idle') joinGroup();
  }, [authLoading, user, token, isPwInvite]);

  const joinGroup = async () => {
    if (!user || !token) return;
    setStatus('joining');
    try {
      const res = await joinGroupByToken({ token });
      if (res?.needsRegistration) {
        navigate('/register', { replace: true });
        return;
      }
      if (!res?.success) {
        setMessage(res?.message || 'Failed to join group. Please try again.');
        setStatus('error');
        return;
      }
      clearBvJoinToken();
      setGroupName(res.groupName);
      setMessage(res.message);
      setStatus('success');
    } catch (e: any) {
      setMessage(e?.message || 'Failed to join group. Please try again.');
      setStatus('error');
    }
  };

  if (authLoading || status === 'idle' || status === 'joining') {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <Card className="w-full max-w-sm">
          <CardContent className="pt-8 pb-8 text-center space-y-3">
            <Leaf className="w-10 h-10 text-primary mx-auto" />
            <p className="font-semibold text-lg">Joining BV Group…</p>
            <Loader2 className="w-6 h-6 animate-spin mx-auto text-primary" />
          </CardContent>
        </Card>
      </div>
    );
  }

  if (status === 'success') {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <Card className="w-full max-w-sm">
          <CardContent className="pt-8 pb-8 text-center space-y-4">
            <CheckCircle2 className="w-12 h-12 text-green-500 mx-auto" />
            <div>
              <p className="font-bold text-xl">Hare Krishna! 🙏</p>
              <p className="text-muted-foreground mt-1">{message}</p>
              {groupName && (
                <p className="font-semibold text-primary mt-2">{groupName}</p>
              )}
            </div>
            <Button className="w-full" onClick={() => navigate(getUserDashboardPath(profile))}>
              Go to Dashboard
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <Card className="w-full max-w-sm">
        <CardContent className="pt-8 pb-8 text-center space-y-4">
          <AlertTriangle className="w-12 h-12 text-destructive mx-auto" />
          <div>
            <p className="font-bold text-xl">Could Not Join</p>
            <p className="text-muted-foreground mt-1 text-sm">{message}</p>
          </div>
          <Button variant="outline" className="w-full" onClick={() => navigate(getUserDashboardPath(profile))}>
            Go to Dashboard
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
