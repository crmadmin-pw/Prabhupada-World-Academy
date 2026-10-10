import { useReactiveLoader } from '@/hooks/useReactiveLoader';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Alert, AlertAction, AlertDescription } from '@/components/ui/alert';
import { AlertCircle, Clock, Info, RefreshCw, User, X } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/lib/auth-sdk';
import { getGuides } from '@/lib/endpoints-sdk';
import { acceptStoredGroupInvite } from '@/lib/bvJoinInvite';
import { useUserProfile } from '@/contexts/UserProfileContext';
import { motion } from 'framer-motion';

type StatusNotice = {
  message: string;
  variant: 'default' | 'destructive';
};

export default function PendingApprovalPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { profile, refreshProfile } = useUserProfile();
  const [guideName, setGuideName] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [checking, setChecking] = useState(false);
  const [statusNotice, setStatusNotice] = useState<StatusNotice | null>(null);

  const isPw = profile?.segment === 'PW' || !!(profile as any)?.isPrabhupadaWorldUser || localStorage.getItem('pwa_is_pw_flow') === 'true';

  useEffect(() => {
    if (!user) return;
    acceptStoredGroupInvite().catch(() => {});
  }, [user]);

  useEffect(() => {
    if (user?.email && !isPw) loadGuideInfo();
    else setLoading(false);
  }, [user?.email, isPw]);

  const loadGuideInfo = useReactiveLoader(async (read) => {
    try {
      const guidesRes = await read(() => getGuides({}));
      if (profile?.selectedGuideId) {
        const guide = guidesRes.guides.find((g: any) => g.guideId === profile.selectedGuideId);
        if (guide) !read.cancelled && setGuideName(guide.name);
      }
    } catch {
      if (read.cancelled) return;
      // silently fail
    } finally {
      !read.cancelled && setLoading(false);
    }
  }, []);

  const handleCheckStatus = async () => {
    setChecking(true);
    setStatusNotice(null);
    try {
      const updatedProfile = await refreshProfile(); // clears cache + re-fetches from sheet
      // AUTH-013 FIX: Route directly based on updated profile status — no full re-auth cycle
      if (updatedProfile?.status === 'ACTIVE') {
        navigate('/dashboard', { replace: true });
      } else if (updatedProfile?.status === 'REJECTED') {
        navigate('/rejected', { replace: true });
      } else {
        setStatusNotice({
          variant: 'default',
          message: isPw
            ? 'Still pending approval. Please check with your administrator.'
            : 'Still pending approval. Please check with your FOLK Guide.',
        });
      }
    } catch {
      setStatusNotice({
        variant: 'destructive',
        message: 'Failed to check status. Please try again.',
      });
    } finally {
      setChecking(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-background to-secondary flex items-center justify-center p-4">
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
        className="w-full max-w-md"
      >
        <Card className="text-center">
          <CardHeader>
            <div className="flex justify-center mb-4">
              <Clock className="w-16 h-16 text-primary" />
            </div>
            <CardTitle className="text-2xl">Pending Approval</CardTitle>
            <CardDescription>
              {isPw 
                ? 'Your registration is awaiting approval from admin'
                : 'Your registration is awaiting approval from your FOLK Guide'
              }
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {isPw ? (
              <p className="text-sm text-muted-foreground">
                Your registration has been sent to the administrators for review.
                Please wait for approval to access your dashboard.
              </p>
            ) : loading ? (
              <Skeleton className="h-16 w-full" />
            ) : guideName ? (
              <div className="bg-muted rounded-lg p-4 text-left space-y-2">
                <div className="flex items-center gap-2">
                  <User className="w-4 h-4 text-primary shrink-0" />
                  <p className="text-sm">
                    Your registration has been sent to <strong>{guideName}</strong>.
                  </p>
                </div>
                <p className="text-sm text-muted-foreground pl-6">
                  Please contact your FOLK Guide to confirm your registration.
                </p>
              </div>
            ) : (
              <p className="text-muted-foreground">
                You will be notified once your FOLK Guide approves your registration.
                Please contact your FOLK Guide directly if you have any questions.
              </p>
            )}



            <Button className="w-full cursor-pointer" onClick={handleCheckStatus} disabled={checking}>
              {checking ? (
                <><RefreshCw className="w-4 h-4 mr-2 animate-spin" /> Checking...</>
              ) : (
                <><RefreshCw className="w-4 h-4 mr-2" /> Check Approval Status</>
              )}
            </Button>

            {statusNotice && (
              <Alert
                variant={statusNotice.variant}
                className="pr-10"
              >
                {statusNotice.variant === 'destructive' ? (
                  <AlertCircle className="h-4 w-4" />
                ) : (
                  <Info className="h-4 w-4 text-blue-600" />
                )}
                <AlertDescription>{statusNotice.message}</AlertDescription>
                <AlertAction>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-xs"
                    aria-label="Close status message"
                    onClick={() => setStatusNotice(null)}
                  >
                    <X className="h-3 w-3" />
                  </Button>
                </AlertAction>
              </Alert>
            )}
          </CardContent>
        </Card>
      </motion.div>
    </div>
  );
}
