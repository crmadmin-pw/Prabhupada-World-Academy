import { useReactiveEffect } from '@/hooks/useReactiveEffect';
import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/lib/auth-sdk';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { DashboardLayout } from '@/layouts';
import BvSection from '@/components/guide/BvSection';
import { getBvMentorData } from '@/lib/endpoints-sdk';
import { toast } from 'sonner';
import { useUserProfile } from '@/contexts/UserProfileContext';
import { Leaf, BookOpen } from 'lucide-react';

export default function BvMentorDashboard() {
  const { profile } = useUserProfile();
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [guideId, setGuideId] = useState<string | null>(null);
  const [residencyIds, setResidencyIds] = useState<string[]>([]);
  const [mentorName, setMentorName] = useState('');
  const [error, setError] = useState<string | null>(null);

  useReactiveEffect((read) => {
    if (!user) return;
    read(() => getBvMentorData({}))
      .then(data => {
        !read.cancelled && setGuideId(data.guideId);
        !read.cancelled && setResidencyIds(data.residencyIds);
        !read.cancelled && setMentorName(data.mentorName);
      })
      .catch(err => {
        const msg = err?.message || 'Could not load BV Mentor data';
        !read.background && !read.cancelled && setError(msg);
        toast.error('Failed to load dashboard');
      })
      .finally(() => !read.cancelled && setLoading(false));
  }, [user]);

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <div className="flex flex-col items-center gap-4">
          <div className="w-10 h-10 rounded-full border-4 border-primary border-t-transparent animate-spin" />
          <Skeleton className="h-5 w-48" />
          <p className="text-xs text-muted-foreground">Loading BV Mentor dashboard…</p>
        </div>
      </div>
    );
  }

  if (error || !guideId) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <Card className="max-w-md w-full">
          <CardHeader>
            <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center mb-2">
              <Leaf className="w-6 h-6 text-primary" />
            </div>
            <CardTitle>Setup Required</CardTitle>
            <CardDescription>
              {error || 'Your BV Mentor account has not been assigned to a guide yet.'}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Please ask a Super Guide to assign you to a guide's BhaktiVriksha system from the Super Guide dashboard → Users panel.
            </p>
            <Button variant="outline" onClick={() => logout()}>Logout</Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <DashboardLayout
      title={`Hare Krishna, ${profile?.fullName || mentorName || 'Mentor'}!`}
      subtitle="BV Supervisor / Mentor"
      role="BV_MENTOR"
      maxWidth="max-w-7xl"
      showProfile={true}
    >
      <BvSection
        guideId={guideId}
        residencyIds={residencyIds}
        segment={(() => {
          const department = String(profile?.segment || '').trim().toUpperCase().replace(/[\s_-]+/g, '');
          if (department === 'FOLK') return 'FOLK';
          if (department === 'PW' || department === 'PRABHUPADAWORLD' || profile?.isPrabhupadaWorldUser) return 'PW';
          return undefined;
        })()}
      />
    </DashboardLayout>
  );
}
