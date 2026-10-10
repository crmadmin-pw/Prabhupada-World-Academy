import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/lib/auth-sdk';
import { resolveUserLogin } from '@/lib/endpoints-sdk';
import { readAccountLinkHold, writeAccountLinkHold, type AccountLinkHoldAction } from '@/lib/accountLinkHold';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Loader2, ShieldCheck } from 'lucide-react';

export default function AccountLinkPendingPage() {
  const { user, isLoading, logout } = useAuth();
  const navigate = useNavigate();
  const [hold, setHold] = useState<AccountLinkHoldAction | null>(readAccountLinkHold);
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    if (isLoading) return;
    if (!user?.email) {
      navigate('/', { replace: true });
      return;
    }
    const email = user.email;

    let cancelled = false;
    resolveUserLogin({ email })
      .then(result => {
        if (cancelled) return;
        if (result.action === 'account_link_pending' || result.action === 'account_link_rejected') {
          writeAccountLinkHold(result.action);
          setHold(result.action);
          return;
        }
        writeAccountLinkHold(null);
        if (result.action === 'route' && result.route) navigate(result.route, { replace: true });
        else if (result.action === 'guide_email_detected') navigate('/guide-login', { replace: true });
        else navigate('/register', { replace: true });
      })
      .catch(() => {
        if (!cancelled) setHold(current => current || readAccountLinkHold());
      })
      .finally(() => {
        if (!cancelled) setChecking(false);
      });

    return () => { cancelled = true; };
  }, [isLoading, user?.email, navigate]);

  const rejected = hold === 'account_link_rejected';

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <div className="flex justify-center mb-4">
            {checking ? <Loader2 className="w-12 h-12 text-primary animate-spin" /> : <ShieldCheck className="w-12 h-12 text-primary" />}
          </div>
          <CardTitle>{rejected ? 'Login not confirmed' : 'Login waiting for review'}</CardTitle>
          <CardDescription>
            {rejected
              ? 'An administrator did not attach this login to the matching profile. No records were merged or deleted.'
              : 'This email matches an existing profile. An administrator has to confirm the link before you can sign in as that person.'}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 text-sm text-muted-foreground">
          <p>
            {rejected
              ? 'Use a different Google account if you still need to register, or ask an administrator to review the link again.'
              : 'You will not be registered as a new person, and the matching profile stays unchanged until that review.'}
          </p>
          <div className="flex flex-col gap-2 pt-2">
            <Button variant="outline" onClick={() => window.location.reload()}>Check again</Button>
            <Button variant="outline" onClick={() => logout({ returnTo: window.location.origin })}>Log out</Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
