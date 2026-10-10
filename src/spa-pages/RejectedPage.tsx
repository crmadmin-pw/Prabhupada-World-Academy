import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { XCircle, Loader2 } from 'lucide-react';
import { motion } from 'framer-motion';
import { useUserProfile } from '@/contexts/UserProfileContext';
import { useAuth } from '@/lib/auth-sdk';
import { deleteAccount } from '@/lib/endpoints-sdk';
import { Button } from '@/components/ui/button';
import { useState } from 'react';

export default function RejectedPage() {
  const { profile } = useUserProfile();
  const { logout } = useAuth();
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isPwUser = profile?.segment === 'PW' || profile?.isPrabhupadaWorldUser === true;

  const handleBackToHomepage = () => {
    setDeleting(true);
    setError(null);
    void deleteAccount({})
      .then(async () => {
        localStorage.removeItem('pwa_pending_registration');
        await logout({ returnTo: isPwUser ? '/pw' : '/' });
      })
      .catch((err: any) => {
        setError(err?.message || 'We could not delete your account. Please try again.');
        setDeleting(false);
      });
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
              <XCircle className="w-16 h-16 text-destructive" />
            </div>
            <CardTitle className="text-2xl">Registration Rejected</CardTitle>
            <CardDescription>
              {isPwUser
                ? 'Your registration request has been rejected by the admin.'
                : 'Your registration request has been rejected by your FOLK Guide'}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-muted-foreground">
              {isPwUser
                ? 'Please contact the admin directly for more information or to discuss reapplying.'
                : 'Please contact your guide directly for more information or to discuss reapplying.'}
            </p>
            <p className="text-sm text-muted-foreground text-left">
              Delete account removes this registration immediately. There is no waiting period and no extra sign-in.
            </p>
            {error && <p className="text-sm text-destructive">{error}</p>}
            <Button className="w-full" onClick={handleBackToHomepage} disabled={deleting}>
              {deleting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Delete account and go back
            </Button>
          </CardContent>
        </Card>
      </motion.div>
    </div>
  );
}
