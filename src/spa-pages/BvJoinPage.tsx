import { useEffect, useRef, useState } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { useAuth } from '@/lib/auth-sdk';
import { joinBvGroupByToken } from '@/lib/endpoints-sdk';
import { isEmbeddedInviteBrowser } from '@/lib/bvJoinToken';
import { withDeadline } from '@/lib/withDeadline';
import { Leaf, CheckCircle2, XCircle, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';

const FOLK_LOGO = '/logo-mark.webp';

export default function BvJoinPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { user, isLoading: authLoading, loginWithRedirect } = useAuth();
  const [status, setStatus] = useState<'checking' | 'signed-out' | 'loading' | 'success' | 'error'>('checking');
  const [message, setMessage] = useState('');
  const [signingIn, setSigningIn] = useState(false);
  const joinedToken = useRef('');

  const token = params.get('token');

  const joinGroup = async () => {
    if (!token || !user) return;
    setStatus('loading');
    try {
      const result = await withDeadline(
        joinBvGroupByToken({ token }),
        25_000,
        'Joining this group is taking too long. Please try again.',
      );
      if (result.success) {
        setStatus('success');
        setMessage(
          result.alreadyMember
            ? `You are already a member of ${result.groupName}!`
            : `Welcome! You have joined ${result.groupName}. 🙏`
        );
        setTimeout(() => navigate('/bhaktivriksha'), 3000);
      } else {
        joinedToken.current = '';
        setStatus('error');
        setMessage(result.error ?? 'Could not join the group');
      }
    } catch (e: unknown) {
      joinedToken.current = '';
      setStatus('error');
      setMessage(e instanceof Error ? e.message : 'Something went wrong. Please try again.');
    }
  };

  useEffect(() => {
    if (authLoading) return;
    if (!token) {
      setStatus('error');
      setMessage('No invite token found. Make sure you used the correct link.');
      return;
    }
    if (!user) {
      setStatus(current => current === 'success' ? current : 'signed-out');
      return;
    }
    if (joinedToken.current === token) return;
    joinedToken.current = token;
    void joinGroup();
  }, [authLoading, user, token]);

  const signIn = async () => {
    setSigningIn(true);
    setMessage('');
    try {
      await loginWithRedirect();
      setSigningIn(false);
    } catch (e: unknown) {
      setStatus('signed-out');
      setMessage(e instanceof Error ? e.message : 'Sign-in did not finish. Please try again.');
      setSigningIn(false);
    }
  };

  return (
    <div className="min-h-screen bg-background flex flex-col items-center justify-center p-6">
      <div className="w-full max-w-sm text-center space-y-6">
        <div className="flex flex-col items-center gap-3">
          <img src={FOLK_LOGO} alt="Prabhupada World Academy" width={56} height={56} className="w-14 h-14 object-contain" />
          <h1 className="text-xl font-bold text-primary">Bhakti Vriksha Group</h1>
        </div>

        {(authLoading || status === 'checking' || status === 'loading' || signingIn) && (
          <div className="flex flex-col items-center gap-3 py-8">
            <Loader2 className="w-10 h-10 animate-spin text-primary" />
            <p className="text-muted-foreground text-sm">
              {status === 'loading' ? 'Joining group…' : 'Checking your session…'}
            </p>
          </div>
        )}

        {status === 'signed-out' && !authLoading && !signingIn && (
          <div className="flex flex-col items-center gap-4 py-8">
            <p className="text-sm text-muted-foreground">
              {isEmbeddedInviteBrowser()
                ? 'WhatsApp’s browser cannot finish Google sign-in. Open this page in Chrome or Safari, then sign in.'
                : 'Sign in to accept this invite.'}
            </p>
            {message && <p className="text-sm text-destructive">{message}</p>}
            <Button onClick={signIn}>Sign in to join</Button>
          </div>
        )}

        {status === 'success' && (
          <div className="flex flex-col items-center gap-4 py-8">
            <div className="w-16 h-16 rounded-full bg-green-100 flex items-center justify-center">
              <CheckCircle2 className="w-9 h-9 text-green-600" />
            </div>
            <div>
              <p className="text-lg font-semibold text-green-700">{message}</p>
              <p className="text-sm text-muted-foreground mt-1">Redirecting to your BV dashboard…</p>
            </div>
          </div>
        )}

        {status === 'error' && (
          <div className="flex flex-col items-center gap-4 py-8">
            <div className="w-16 h-16 rounded-full bg-destructive/10 flex items-center justify-center">
              <XCircle className="w-9 h-9 text-destructive" />
            </div>
            <div>
              <p className="text-base font-semibold text-destructive">{message}</p>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => navigate('/bhaktivriksha')}>
                <Leaf className="w-4 h-4 mr-2" />Go to BV
              </Button>
              {token && user && (
                <Button onClick={() => { joinedToken.current = token; void joinGroup(); }}>
                  Try Again
                </Button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
