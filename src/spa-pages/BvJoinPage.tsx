import { useEffect, useState } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { useAuth } from 'zite-auth-sdk';
import { joinBvGroupByToken } from 'zite-endpoints-sdk';
import { Leaf, CheckCircle2, XCircle, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';

const FOLK_LOGO = 'https://images.fillout.com/orgid-615562/flowpublicid-u91plgmzcu/widgetid-default/q1fJEkENG5kbvfjYaFbDeT/pasted-image-1773145742081.png';

export default function BvJoinPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { user, isLoading: authLoading, loginWithRedirect } = useAuth();
  const [status, setStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
  const [message, setMessage] = useState('');

  const token = params.get('token');

  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      // Not logged in — redirect to login then back
      loginWithRedirect({ redirectUrl: window.location.href });
      return;
    }
    if (!token) {
      setStatus('error');
      setMessage('No invite token found. Make sure you used the correct link.');
      return;
    }
    joinGroup();
  }, [authLoading, user, token]);

  const joinGroup = async () => {
    if (!token) return;
    setStatus('loading');
    try {
      const result = await joinBvGroupByToken({ token });
      if (result.success) {
        setStatus('success');
        setMessage(
          result.alreadyMember
            ? `You are already a member of ${result.groupName}!`
            : `Welcome! You have joined ${result.groupName}. 🙏`
        );
        setTimeout(() => navigate('/bhaktivriksha'), 3000);
      } else {
        setStatus('error');
        setMessage(result.error ?? 'Could not join the group');
      }
    } catch (e: any) {
      setStatus('error');
      setMessage(e?.message ?? 'Something went wrong. Please try again.');
    }
  };

  return (
    <div className="min-h-screen bg-background flex flex-col items-center justify-center p-6">
      <div className="w-full max-w-sm text-center space-y-6">
        <div className="flex flex-col items-center gap-3">
          <img src={FOLK_LOGO} alt="FOLK" className="w-14 h-14 object-contain" />
          <h1 className="text-xl font-bold text-primary">Bhakti Vriksha Group</h1>
        </div>

        {(authLoading || status === 'idle' || status === 'loading') && (
          <div className="flex flex-col items-center gap-3 py-8">
            <Loader2 className="w-10 h-10 animate-spin text-primary" />
            <p className="text-muted-foreground text-sm">
              {authLoading ? 'Checking your session…' : 'Joining group…'}
            </p>
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
              {token && (
                <Button onClick={joinGroup} disabled={status as string === 'loading'}>
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
