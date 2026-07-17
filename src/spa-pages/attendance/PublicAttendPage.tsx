import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useAuth } from 'zite-auth-sdk';
import { getSessionByToken, markSessionAttendance, registerAndAttend, joinSessionChallenge, getUserProfile } from 'zite-endpoints-sdk';
import type { GetSessionByTokenOutputType } from 'zite-endpoints-sdk';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { toast } from 'sonner';
import { UserCheck, UserPlus, Phone, Flame, Check, ArrowLeft } from 'lucide-react';
import { format } from 'date-fns';

type SessionInfo = NonNullable<GetSessionByTokenOutputType['session']>;

export default function PublicAttendPage() {
  const { token } = useParams<{ token: string }>();
  const { user, isLoading: authLoading } = useAuth();
  const [loading, setLoading] = useState(true);
  const [session, setSession] = useState<SessionInfo | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [profile, setProfile] = useState<any>(null);

  useEffect(() => {
    if (!token) return;
    getSessionByToken({ token }).then(res => {
      if (res.found && res.session) setSession(res.session);
      else setNotFound(true);
    }).catch(() => setNotFound(true)).finally(() => setLoading(false));
  }, [token]);

  useEffect(() => {
    if (user) {
      getUserProfile({}).then(res => {
        if (res.user) setProfile(res.user);
      }).catch(() => {});
    }
  }, [user]);

  if (loading || authLoading) return <LoadingSkeleton />;
  if (notFound || !session) return <NotFoundView />;

  return (
    <div className="min-h-screen bg-background flex flex-col items-center px-4 py-8">
      <div className="w-full max-w-md">
        <SessionHeader session={session} />
        {user ? (
          <LoggedInAttendance session={session} userId={user.id || ''} userName={profile?.fullName || user.email || 'Devotee'} />
        ) : (
          <PhoneAttendance session={session} />
        )}
      </div>
    </div>
  );
}

function SessionHeader({ session }: { session: SessionInfo }) {
  const today = format(new Date(), 'MMMM d, yyyy');
  return (
    <div className="text-center mb-8">
      <div className="w-14 h-14 rounded-full bg-primary/10 flex items-center justify-center mx-auto mb-3">
        <UserCheck className="w-7 h-7 text-primary" />
      </div>
      <h1 className="text-xl font-bold text-foreground">{session.eventTitle}</h1>
      <p className="text-sm text-muted-foreground mt-1">Session: {session.name}</p>
      <p className="text-sm text-muted-foreground">Date: {today}</p>
    </div>
  );
}

function LoggedInAttendance({ session, userId, userName }: { session: SessionInfo; userId: string; userName: string }) {
  const [state, setState] = useState<'idle' | 'loading' | 'success' | 'already'>('idle');
  const [challengeData, setChallengeData] = useState<{ enrollmentId?: string; currentStreak?: number; challengeDays?: number } | null>(null);

  const handleMark = async () => {
    setState('loading');
    try {
      const res = await markSessionAttendance({ sessionId: session.id, userId });
      setState(res.alreadyMarked ? 'already' : 'success');
      if (res.challengeEnabled) {
        setChallengeData({ enrollmentId: res.enrollmentId, currentStreak: res.currentStreak, challengeDays: res.challengeDays });
      }
      toast.success(res.alreadyMarked ? 'Attendance already marked for today!' : `Attendance marked for ${userName}!`);
    } catch (e: any) {
      toast.error(e.message || 'Failed to mark attendance');
      setState('idle');
    }
  };

  if (state === 'success' || state === 'already') {
    return (
      <SuccessView
        name={userName}
        alreadyMarked={state === 'already'}
        session={session}
        challengeData={challengeData}
        identifiers={{ userId }}
      />
    );
  }

  return (
    <div className="space-y-4">
      <div className="border border-border rounded-lg p-5 bg-card text-center">
        <p className="text-sm text-muted-foreground mb-1">Logged in as</p>
        <p className="font-semibold text-foreground">{userName}</p>
      </div>
      <Button className="w-full" size="lg" onClick={handleMark} disabled={state === 'loading'}>
        {state === 'loading' ? 'Marking...' : 'Mark My Attendance'}
      </Button>
    </div>
  );
}

function PhoneAttendance({ session }: { session: SessionInfo }) {
  const [phone, setPhone] = useState('');
  const [state, setState] = useState<'phone' | 'loading' | 'success' | 'already' | 'notfound' | 'register'>('phone');
  const [resultName, setResultName] = useState('');
  const [challengeData, setChallengeData] = useState<any>(null);
  const [participantId, setParticipantId] = useState('');

  const handleLookup = async () => {
    if (!phone.trim()) return;
    setState('loading');
    try {
      const res = await markSessionAttendance({ sessionId: session.id, phone: phone.trim() });
      setResultName(res.participantName);
      setState(res.alreadyMarked ? 'already' : 'success');
      if (res.challengeEnabled) {
        setChallengeData({ enrollmentId: res.enrollmentId, currentStreak: res.currentStreak, challengeDays: res.challengeDays });
      }
      toast.success(res.alreadyMarked ? 'Already marked today!' : `Attendance marked for ${res.participantName}!`);
    } catch (e: any) {
      if (e.message?.includes('not found') || e.message?.includes('Phone')) {
        setState('notfound');
      } else {
        toast.error(e.message || 'Error');
        setState('phone');
      }
    }
  };

  if (state === 'success' || state === 'already') {
    return (
      <SuccessView
        name={resultName}
        alreadyMarked={state === 'already'}
        session={session}
        challengeData={challengeData}
        identifiers={participantId ? { participantId } : {}}
      />
    );
  }

  if (state === 'register') {
    return (
      <RegistrationForm
        session={session}
        phone={phone}
        onBack={() => setState('phone')}
        onSuccess={(name, pId) => {
          setResultName(name);
          setParticipantId(pId);
          setState('success');
          toast.success(`Registered and attendance marked for ${name}!`);
        }}
      />
    );
  }

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label className="text-sm font-medium">Phone Number</Label>
        <p className="text-xs text-muted-foreground">Use the phone number registered on Prabhupada World.</p>
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Phone className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              type="tel"
              placeholder="+91 98765 43210"
              value={phone}
              onChange={e => setPhone(e.target.value)}
              className="pl-10"
              onKeyDown={e => e.key === 'Enter' && handleLookup()}
            />
          </div>
        </div>
      </div>
      <Button className="w-full" size="lg" onClick={handleLookup} disabled={state === 'loading' || !phone.trim()}>
        {state === 'loading' ? 'Checking...' : 'Mark Attendance'}
      </Button>

      {state === 'notfound' && (
        <div className="border border-destructive/30 rounded-lg p-4 bg-destructive/5 text-center space-y-3">
          <p className="text-sm text-destructive font-medium">Try your registered number or register now.</p>
          <Button variant="outline" size="sm" onClick={() => setState('register')}>
            <UserPlus className="w-4 h-4 mr-1" /> Register Now
          </Button>
        </div>
      )}

      <p className="text-xs text-muted-foreground text-center mt-4">
        {"Don't have an account? "}
        <button className="text-primary font-medium underline" onClick={() => setState('register')}>Register now</button>
      </p>
    </div>
  );
}

function RegistrationForm({ session, phone, onBack, onSuccess }: {
  session: SessionInfo; phone: string;
  onBack: () => void; onSuccess: (name: string, participantId: string) => void;
}) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phoneVal, setPhoneVal] = useState(phone);
  const [customValues, setCustomValues] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);

  let customFields: Array<{ name: string; type: string; options?: string[] }> = [];
  try { customFields = JSON.parse(session.customFields || '[]'); } catch { /* empty */ }

  const handleSubmit = async () => {
    if (!name.trim() || !phoneVal.trim()) { toast.error('Name and phone are required'); return; }
    setSubmitting(true);
    try {
      const res = await registerAndAttend({
        sessionId: session.id,
        name: name.trim(),
        phone: phoneVal.trim(),
        email: email.trim() || undefined,
        customData: Object.keys(customValues).length ? JSON.stringify(customValues) : undefined,
      });
      onSuccess(res.participantName, res.participantId);
    } catch (e: any) {
      toast.error(e.message || 'Registration failed');
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-5">
      <button className="flex items-center gap-1 text-sm text-muted-foreground" onClick={onBack}>
        <ArrowLeft className="w-4 h-4" /> Back
      </button>
      <div className="text-center">
        <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center mx-auto mb-2">
          <UserPlus className="w-6 h-6 text-primary" />
        </div>
        <h2 className="text-lg font-bold">Register & Mark Attendance</h2>
        <p className="text-sm text-muted-foreground">{session.eventTitle} — {session.name}</p>
      </div>

      <div className="space-y-4">
        <div><Label>Full Name *</Label><Input value={name} onChange={e => setName(e.target.value)} placeholder="Your full name" /></div>
        <div><Label>Phone *</Label><Input type="tel" value={phoneVal} onChange={e => setPhoneVal(e.target.value)} /></div>
        <div><Label>Email</Label><Input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="email@example.com" /></div>

        {customFields.length > 0 && (
          <div className="border border-border rounded-lg p-4 space-y-3 bg-muted/20">
            <p className="text-xs text-muted-foreground font-medium">Additional Information</p>
            {customFields.map(f => (
              <div key={f.name}>
                <Label className="text-xs">{f.name}</Label>
                {f.type === 'select' && f.options ? (
                  <select
                    className="w-full border border-border rounded-md px-3 py-2 text-sm mt-1 bg-background"
                    value={customValues[f.name] || ''}
                    onChange={e => setCustomValues(p => ({ ...p, [f.name]: e.target.value }))}
                  >
                    <option value="">Select...</option>
                    {f.options.map(o => <option key={o} value={o}>{o}</option>)}
                  </select>
                ) : (
                  <Input
                    className="mt-1"
                    value={customValues[f.name] || ''}
                    onChange={e => setCustomValues(p => ({ ...p, [f.name]: e.target.value }))}
                  />
                )}
              </div>
            ))}
          </div>
        )}

        <Button className="w-full" size="lg" onClick={handleSubmit} disabled={submitting}>
          {submitting ? 'Registering...' : 'Register & Mark Attendance'}
        </Button>
      </div>
    </div>
  );
}

function SuccessView({ name, alreadyMarked, session, challengeData, identifiers }: {
  name: string; alreadyMarked: boolean; session: SessionInfo;
  challengeData: { enrollmentId?: string; currentStreak?: number; challengeDays?: number } | null;
  identifiers: { userId?: string; participantId?: string };
}) {
  const [joining, setJoining] = useState(false);
  const [enrolled, setEnrolled] = useState(!!challengeData?.enrollmentId);
  const [streak, setStreak] = useState(challengeData?.currentStreak || 0);
  const days = challengeData?.challengeDays || session.challengeDays || 7;

  const handleJoin = async () => {
    setJoining(true);
    try {
      const res = await joinSessionChallenge({ sessionId: session.id, ...identifiers });
      setEnrolled(true);
      setStreak(res.currentStreak);
      toast.success('Challenge joined!');
    } catch (e: any) {
      toast.error(e.message || 'Failed to join');
    } finally {
      setJoining(false);
    }
  };

  return (
    <div className="space-y-5">
      <div className="border border-border rounded-lg p-6 bg-card text-center">
        <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center mx-auto mb-3">
          <Check className="w-8 h-8 text-primary" />
        </div>
        <h2 className="text-lg font-bold text-foreground">
          {alreadyMarked ? 'Already Marked!' : 'Attendance Marked!'}
        </h2>
        <p className="text-sm text-muted-foreground mt-1">
          {alreadyMarked
            ? `${name}, your attendance for today was already recorded.`
            : `Thank you, ${name}! Your attendance has been recorded.`}
        </p>
      </div>

      {session.challengeEnabled && !enrolled && (
        <div className="border border-border rounded-lg overflow-hidden">
          {session.challengeImageUrl && (
            <img src={session.challengeImageUrl} alt={session.challengeTitle} className="w-full h-40 object-cover" />
          )}
          {!session.challengeImageUrl && (
            <img src="https://images.fillout.com/726779/d3wzyuanaj/generated-images/7xdzmnUDiKiTKJaYW4CZUz/img_Uy15_NgdU15lbDvH.jpg" alt="Challenge" className="w-full h-40 object-cover" />
          )}
          <div className="p-5">
            <div className="flex items-center gap-2 mb-2">
              <Flame className="w-5 h-5 text-primary" />
              <h3 className="font-bold">{session.challengeTitle || `${days}-Day Challenge`}</h3>
            </div>
            {session.challengeDescription && <p className="text-sm text-muted-foreground">{session.challengeDescription}</p>}
            {session.challengeInstructions && (
              <div className="mt-3 bg-muted/30 rounded-md p-3">
                <p className="text-xs font-medium mb-1">Instructions:</p>
                <p className="text-xs text-muted-foreground whitespace-pre-line">{session.challengeInstructions}</p>
              </div>
            )}
            <Button className="w-full mt-4" onClick={handleJoin} disabled={joining}>
              {joining ? 'Joining...' : 'Join This Challenge'}
            </Button>
          </div>
        </div>
      )}

      {session.challengeEnabled && enrolled && (
        <div className="border border-border rounded-lg p-5">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-semibold text-sm">Your Progress</h3>
            <span className="text-xs bg-primary/10 text-primary px-2 py-0.5 rounded-full">
              {streak >= days ? '🎉 Completed!' : `Day ${streak} of ${days}`}
            </span>
          </div>
          <div className="flex gap-1 flex-wrap">
            {Array.from({ length: days }).map((_, i) => (
              <div
                key={i}
                className={`w-8 h-8 rounded-full flex items-center justify-center text-xs ${
                  i < streak
                    ? 'bg-primary text-primary-foreground'
                    : 'border-2 border-border text-muted-foreground'
                }`}
              >
                {i < streak ? <Check className="w-4 h-4" /> : i + 1}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function LoadingSkeleton() {
  return (
    <div className="min-h-screen bg-background flex flex-col items-center px-4 py-8">
      <div className="w-full max-w-md space-y-4">
        <Skeleton className="h-14 w-14 rounded-full mx-auto" />
        <Skeleton className="h-6 w-48 mx-auto" />
        <Skeleton className="h-4 w-36 mx-auto" />
        <Skeleton className="h-10 w-full mt-8" />
        <Skeleton className="h-12 w-full" />
      </div>
    </div>
  );
}

function NotFoundView() {
  return (
    <div className="min-h-screen bg-background flex items-center justify-center px-4">
      <div className="text-center max-w-sm">
        <div className="w-16 h-16 rounded-full bg-destructive/10 flex items-center justify-center mx-auto mb-4">
          <span className="text-2xl">🔗</span>
        </div>
        <h1 className="text-lg font-bold mb-2">Invalid or Expired Link</h1>
        <p className="text-sm text-muted-foreground">This attendance link is no longer valid. Please contact the organizer for a new link.</p>
      </div>
    </div>
  );
}
