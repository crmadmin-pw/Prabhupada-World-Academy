import { useEffect, useRef, useState } from 'react';
import { useParams, useSearchParams, useNavigate } from 'react-router-dom';
import { useAuth } from '@/lib/auth-sdk';
import { useUserProfile } from '@/contexts/UserProfileContext';
import { getUserDashboardPath } from '@/lib/userDashboardRoutes';
import { joinGroupByToken } from '@/lib/endpoints-sdk';
import { clearBvJoinToken, rememberBvJoinToken } from '@/lib/bvJoinInvite';
import { isEmbeddedInviteBrowser } from '@/lib/bvJoinToken';
import { withDeadline } from '@/lib/withDeadline';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Leaf, CheckCircle2, AlertTriangle, Loader2 } from 'lucide-react';

type JoinStatus = 'checking' | 'signed-out' | 'joining' | 'success' | 'error';

function signInFailure(error: unknown): string {
  const code = String((error as { code?: string })?.code || '');
  if (code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request') {
    return 'Sign-in was cancelled. Tap Sign in to join this group.';
  }
  if (code === 'auth/popup-blocked') {
    return 'The sign-in window was blocked. Allow pop-ups, or open this invite in Chrome or Safari.';
  }
  return error instanceof Error && error.message
    ? error.message
    : 'Sign-in did not finish. Please try again.';
}

export default function JoinGroupPage() {
  const [searchParams] = useSearchParams();
  const { token: pathToken = '' } = useParams();
  const navigate = useNavigate();
  const { profile } = useUserProfile();
  const { user, isLoading: authLoading, loginWithRedirect } = useAuth();
  const rawToken = pathToken || searchParams.get('token') || searchParams.get('join') || '';
  let token = rawToken;
  try { token = decodeURIComponent(rawToken); } catch { token = rawToken; }
  const isPwInvite = typeof window !== 'undefined' && window.location.pathname.endsWith('/pw');
  const embeddedBrowser = isEmbeddedInviteBrowser();

  const [status, setStatus] = useState<JoinStatus>('checking');
  const [message, setMessage] = useState('');
  const [groupName, setGroupName] = useState('');
  const [signingIn, setSigningIn] = useState(false);
  const [authSlow, setAuthSlow] = useState(false);
  const joinedToken = useRef('');

  const joinGroup = async () => {
    if (!user || !token) return;
    setStatus('joining');
    try {
      const res = await withDeadline(
        joinGroupByToken({ token }),
        25_000,
        'Joining this group is taking too long. Please try again.',
      );
      if (res?.needsRegistration) {
        navigate('/register', { replace: true });
        return;
      }
      if (!res?.success) {
        joinedToken.current = '';
        setMessage(res?.message || 'Failed to join group. Please try again.');
        setStatus('error');
        return;
      }
      clearBvJoinToken();
      setGroupName(res.groupName);
      setMessage(res.message);
      setStatus('success');
    } catch (e: unknown) {
      joinedToken.current = '';
      setMessage(e instanceof Error ? e.message : 'Failed to join group. Please try again.');
      setStatus('error');
    }
  };

  useEffect(() => {
    if (!authLoading) {
      setAuthSlow(false);
      return;
    }
    const timer = setTimeout(() => setAuthSlow(true), 12_000);
    return () => clearTimeout(timer);
  }, [authLoading]);

  useEffect(() => {
    if (authLoading) return;
    if (!token) {
      setStatus('error');
      setMessage('This invite link is incomplete. Ask your RGF to send a new WhatsApp invite.');
      return;
    }
    rememberBvJoinToken(token, isPwInvite);
    if (!user) {
      setStatus(current => current === 'success' ? current : 'signed-out');
      return;
    }
    if (joinedToken.current === token) return;
    joinedToken.current = token;
    void joinGroup();
  }, [authLoading, user, token, isPwInvite]);

  const signIn = async () => {
    setMessage('');
    setSigningIn(true);
    try {
      // Stay on this page. Reloading the invite after the pop-up starts the
      // same request again when WhatsApp does not keep the sign-in.
      await loginWithRedirect();
      setSigningIn(false);
    } catch (error) {
      setMessage(signInFailure(error));
      setStatus('signed-out');
      setSigningIn(false);
    }
  };

  const waitingOnSession = (authLoading || status === 'checking') && !authSlow;
  if (waitingOnSession || status === 'joining' || signingIn) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <Card className="w-full max-w-sm">
          <CardContent className="pt-8 pb-8 text-center space-y-3">
            <Leaf className="w-10 h-10 text-primary mx-auto" />
            <p className="font-semibold text-lg">
              {status === 'joining' ? 'Joining BV Group…' : 'Checking your session…'}
            </p>
            <Loader2 className="w-6 h-6 animate-spin mx-auto text-primary" />
          </CardContent>
        </Card>
      </div>
    );
  }

  if (status === 'signed-out' || authSlow || status === 'checking') {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <Card className="w-full max-w-sm">
          <CardContent className="pt-8 pb-8 text-center space-y-4">
            <Leaf className="w-10 h-10 text-primary mx-auto" />
            <div>
              <p className="font-bold text-xl">Join this Bhakti Vriksha group</p>
              <p className="text-muted-foreground mt-1 text-sm">
                {embeddedBrowser
                  ? 'WhatsApp’s browser cannot finish Google sign-in. Open this page in Chrome or Safari, then sign in.'
                  : 'Sign in to accept this invite.'}
              </p>
              {message && <p className="text-sm text-destructive mt-2">{message}</p>}
            </div>
            <Button className="w-full" onClick={signIn}>Sign in to join</Button>
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
          <div className="flex flex-col gap-2">
            {token && user && (
              <Button className="w-full" onClick={() => { joinedToken.current = token; void joinGroup(); }}>
                Try Again
              </Button>
            )}
            <Button variant="outline" className="w-full" onClick={() => navigate(getUserDashboardPath(profile))}>
              Go to Dashboard
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
