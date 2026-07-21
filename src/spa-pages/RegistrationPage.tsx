import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { toast } from 'sonner';
import { ArrowLeft, AlertCircle, Loader2, Link as LinkIcon, CheckCircle2 } from 'lucide-react';
import { getGuides, registerUser, checkGuideEmail, getAllResidencies, GetGuidesOutputType, GetAllResidenciesOutputType } from 'zite-endpoints-sdk';
import { Link } from 'react-router-dom';
import { useUserProfile } from '@/contexts/UserProfileContext';
import { useAuth } from 'zite-auth-sdk';

const COUNTRY_CODES = [
  { code: '+91', country: 'India', flag: '🇮🇳', abbr: 'IN' },
  { code: '+1', country: 'USA/Canada', flag: '🇺🇸', abbr: 'US' },
  { code: '+44', country: 'UK', flag: '🇬🇧', abbr: 'GB' },
  { code: '+61', country: 'Australia', flag: '🇦🇺', abbr: 'AU' },
  { code: '+86', country: 'China', flag: '🇨🇳', abbr: 'CN' },
  { code: '+81', country: 'Japan', flag: '🇯🇵', abbr: 'JP' },
  { code: '+49', country: 'Germany', flag: '🇩🇪', abbr: 'DE' },
  { code: '+33', country: 'France', flag: '🇫🇷', abbr: 'FR' },
  { code: '+7', country: 'Russia', flag: '🇷🇺', abbr: 'RU' },
  { code: '+55', country: 'Brazil', flag: '🇧🇷', abbr: 'BR' },
];

const EXAM_TAKEN_LEVELS = [
  'Shraddhavan', 'Sevak', 'Sadhaka', 'Upasaka', 'Caranashraya', 'Harinam Diksha',
];

export default function RegistrationPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { forceSetProfile } = useUserProfile();
  const [loading, setLoading] = useState(false);
  const [loadingGuides, setLoadingGuides] = useState(true);
  const [loadingResidencies, setLoadingResidencies] = useState(true);
  const [guides, setGuides] = useState<GetGuidesOutputType['guides']>([]);
  const [residencies, setResidencies] = useState<GetAllResidenciesOutputType>([]);
  const [guideEmailBlocked, setGuideEmailBlocked] = useState(false);
  const [hasTakenExam, setHasTakenExam] = useState(false);
  const [selectedExamLevel, setSelectedExamLevel] = useState('');
  const autoName = [(user as any)?.firstName, (user as any)?.lastName].filter(Boolean).join(' ').trim();
  const phonePrefillDone = useRef(false);

  const [formData, setFormData] = useState(() => {
    let pendingPhone = '';
    let pendingCc = '+91';
    try {
      pendingPhone = localStorage.getItem('pwa_pending_phone') || '';
      pendingCc = localStorage.getItem('pwa_pending_cc') || '+91';
    } catch {}
    return {
      fullName: '',
      phoneCountryCode: pendingCc,
      phone: pendingPhone,
      selectedGuideId: '',
      residencyUserClaim: false,
      selectedFolkResidency: '',
      residencyJoinDate: '',
    };
  });

  const ashrayLevel = hasTakenExam ? selectedExamLevel : 'Jigyasa';

  useEffect(() => {
    if (!phonePrefillDone.current) {
      phonePrefillDone.current = true;
      try {
        localStorage.removeItem('pwa_pending_phone');
        localStorage.removeItem('pwa_pending_cc');
      } catch {}
    }
    setFormData(prev => ({ ...prev, fullName: prev.fullName || autoName }));
  }, [autoName]);

  // Always load guides and residencies on mount
  useEffect(() => { loadGuides(); loadResidencies(); }, []);

  const loadGuides = async () => {
    setLoadingGuides(true);
    try {
      const result = await getGuides({});
      setGuides(result.guides);
    } catch {
      toast.error('Failed to load guides. Please try again.');
    } finally { setLoadingGuides(false); }
  };

  const loadResidencies = async () => {
    setLoadingResidencies(true);
    try {
      const result = await getAllResidencies({});
      setResidencies(result);
    } catch {
      toast.error('Failed to load FOLK centers');
      setResidencies([]);
    } finally { setLoadingResidencies(false); }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const nameToUse = formData.fullName.trim();
    const sanitizedPhone = formData.phone.replace(/\D/g, '');

    if (!nameToUse) { toast.error('Please enter your full name'); return; }
    if (formData.phoneCountryCode === '+91') {
      if (sanitizedPhone.length !== 10 || !/^[6-9]/.test(sanitizedPhone)) {
        toast.error('Please enter a valid 10-digit Indian mobile number starting with 6, 7, 8, or 9');
        return;
      }
    } else if (!sanitizedPhone || sanitizedPhone.length < 7) {
      toast.error('Please enter a valid phone number (at least 7 digits)');
      return;
    }
    if (!formData.selectedGuideId) { toast.error('Please select your Mentor'); return; }

    const isPwMentorSelected = formData.selectedGuideId === 'MENTOR-PW-HIRANYAVARNA';

    // FOLK center only required when NOT a Prabhupada World user
    if (!isPwMentorSelected && !formData.selectedFolkResidency) {
      toast.error('Please select your FOLK Center'); return;
    }

    // Physical residency claim extras — only relevant for FOLK users
    if (!isPwMentorSelected && formData.residencyUserClaim && !formData.residencyJoinDate) {
      toast.error('Please enter your residency join date'); return;
    }
    if (hasTakenExam && !selectedExamLevel) {
      toast.error('Please select your Ashray Level'); return;
    }

    const phoneE164 = formData.phoneCountryCode + sanitizedPhone;
    const email = user?.email || '';

    setLoading(true);
    try {
      if (email) {
        const emailCheck = await checkGuideEmail({ email });
        if (emailCheck.isGuide) { setGuideEmailBlocked(true); setLoading(false); return; }
      }

      const isPwMentorSelected = formData.selectedGuideId === 'MENTOR-PW-HIRANYAVARNA';
      const result = await registerUser({
        fullName: nameToUse,
        phoneCountryCode: formData.phoneCountryCode,
        phone: sanitizedPhone,
        phoneE164,
        email,
        guideId: formData.selectedGuideId,
        residencyUserClaim: isPwMentorSelected ? false : formData.residencyUserClaim,
        selectedFolkResidency: isPwMentorSelected ? '' : formData.selectedFolkResidency,
        residencyJoinDate: isPwMentorSelected ? '' : formData.residencyJoinDate,
        ashrayLevel: ashrayLevel || undefined,
        isPrabhupadaWorldUser: isPwMentorSelected,
      });

      if (result.success) {
        forceSetProfile({
          userId: result.userId,
          fullName: nameToUse,
          role: 'USER',
          status: 'PENDING_APPROVAL',
          phone: phoneE164,
          email,
          selectedGuideId: formData.selectedGuideId,
          ashrayLevel: ashrayLevel || null,
          residencyUserClaim: formData.residencyUserClaim,
          selectedFolkResidency: formData.selectedFolkResidency || null,
        });
        toast.success('Registration successful! Awaiting guide approval.');
        navigate('/pending');
      } else {
        toast.error('Registration failed. Please try again.');
      }
    } catch (err: any) {
      const msg = err?.message || '';
      if (msg.includes('already exists')) {
        toast.error('An account with this phone number already exists. Please sign in instead.');
      } else if (msg.includes('guide not found')) {
        toast.error('Selected guide not found. Please refresh and try again.');
      } else {
        toast.error(`Registration failed: ${msg || 'Please try again.'}`);
      }
    } finally { setLoading(false); }
  };

  if (guideEmailBlocked) {
    return (
      <div className="min-h-screen bg-gradient-to-b from-background to-secondary flex items-center justify-center p-4">
        <Card className="w-full max-w-lg">
          <CardHeader>
            <div className="flex justify-center mb-4">
              <AlertCircle className="w-16 h-16 text-destructive" />
            </div>
            <CardTitle className="text-2xl text-center">Guide Account Detected</CardTitle>
            <CardDescription className="text-center">
              This sign-in account belongs to a FOLK Guide and cannot be used for devotee registration
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>
                This account is registered as a guide. Please use the{' '}
                <Link to="/guide-login" className="underline font-medium">Guide Portal</Link>.
              </AlertDescription>
            </Alert>
            <Button variant="outline" className="w-full" onClick={() => navigate('/')}>Back to Home</Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen w-full bg-[#fcf9f2] flex items-center justify-center p-4">
      <div className="w-full max-w-[500px] bg-white border border-gray-200/80 rounded-2xl shadow-[0_10px_35px_rgba(0,0,0,0.06),_0_1px_6px_rgba(0,0,0,0.03)] p-8 md:p-10 flex flex-col gap-6 text-center">
        
        {/* Back Button */}
        <div className="flex items-center text-left">
          <span 
            onClick={() => navigate('/')} 
            className="text-gray-500 hover:text-gray-900 cursor-pointer text-sm font-semibold flex items-center gap-1.5 transition-colors"
          >
            <ArrowLeft className="w-4 h-4" /> Back
          </span>
        </div>

        {/* Title */}
        <div className="text-left space-y-2">
          <h1 className="text-[28px] font-bold text-gray-900 tracking-tight leading-tight">
            Create Your Account
          </h1>
          <p className="text-sm text-gray-500 leading-normal">
            Join Prabhupada World Academy to start tracking your daily spiritual practices
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-5 text-left">

          {/* Email — from auth, read-only */}
          <div className="space-y-1.5">
            <label className="text-sm font-semibold text-gray-700 block mb-1">Email</label>
            <div className="flex items-center gap-3 px-4 h-8 rounded-md border border-emerald-100 bg-[#f0fdf4] text-sm">
              <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
              <span className="flex-1 truncate text-gray-900 font-medium">
                {user?.email || '—'}
              </span>
              <span className="text-xs text-emerald-600 font-semibold shrink-0">Verified</span>
            </div>
          </div>

          {/* Full Name */}
          <div className="space-y-1.5">
            <label htmlFor="fullName" className="text-sm font-medium text-gray-700 block mb-1">
              Full Name <span className="text-red-500 font-bold">*</span>
            </label>
            <input
              id="fullName"
              type="text"
              value={formData.fullName}
              onChange={(e) => setFormData({ ...formData, fullName: e.target.value })}
              placeholder="Enter your full name"
              required
              className="w-full h-8 px-4 border border-gray-200 rounded-md text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:border-[#ea6506] focus:ring-1 focus:ring-[#ea6506] transition-all bg-white shadow-sm"
            />
          </div>

          {/* Mobile Number */}
          <div className="space-y-1.5">
            <label htmlFor="phone" className="text-sm font-medium text-gray-700 block mb-1">
              Mobile Number <span className="text-red-500 font-bold">*</span>
            </label>
            <div className="flex gap-2.5">
              <Select
                value={formData.phoneCountryCode}
                onValueChange={(value) => { if (value) setFormData({ ...formData, phoneCountryCode: value }); }}
              >
                <SelectTrigger className="w-[115px] !h-10 border border-gray-200 rounded-[10px] text-sm text-gray-900 bg-white focus:border-[#ea6506] focus:ring-1 focus:ring-[#ea6506] focus-visible:border-[#ea6506] focus-visible:ring-1 focus-visible:ring-[#ea6506] outline-none px-3.5 flex items-center justify-between shadow-sm">
                  <span className="flex items-baseline gap-1.5 font-mono">
                    {(() => {
                      const selected = COUNTRY_CODES.find(c => c.code === formData.phoneCountryCode);
                      return selected ? (
                        <>
                          <span className="text-[12px] font-normal text-gray-950 uppercase tracking-wide">{selected.abbr}</span>
                          <span className="text-sm font-normal text-gray-950">{selected.code}</span>
                        </>
                      ) : (
                        <span className="text-sm font-normal text-gray-950">{formData.phoneCountryCode}</span>
                      );
                    })()}
                  </span>
                </SelectTrigger>
                <SelectContent>
                  {COUNTRY_CODES.map((item) => (
                    <SelectItem key={item.code} value={item.code}>
                      {item.flag} {item.abbr} ({item.code})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <input
                id="phone"
                type="text"
                value={formData.phone}
                onChange={(e) => setFormData({ ...formData, phone: e.target.value.replace(/\D/g, '') })}
                placeholder="Mobile number"
                required
                inputMode="numeric"
                className="flex-1 h-10 px-4 border border-gray-200 rounded-[10px] text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:border-[#ea6506] focus:ring-1 focus:ring-[#ea6506] transition-all bg-white shadow-sm"
              />
            </div>
          </div>

          {/* Mentor (replaces FOLK Guide) */}
          <div className="space-y-1.5">
            <label htmlFor="guide" className="text-sm font-medium text-gray-700 block mb-1">
              Mentor <span className="text-red-500 font-bold">*</span>
            </label>
            {loadingGuides ? (
              <div className="flex items-center justify-center h-8 border border-gray-200 rounded-md bg-gray-50">
                <Loader2 className="w-4 h-4 animate-spin mr-2 text-gray-400" />
                <span className="text-xs text-gray-500">Loading mentors...</span>
              </div>
            ) : guides.length === 0 ? (
              <Alert variant="destructive">
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>No mentors available. Please contact the administrator.</AlertDescription>
              </Alert>
            ) : (
              <>
                <Select
                  value={formData.selectedGuideId}
                  onValueChange={(value) => { if (value) setFormData({ ...formData, selectedGuideId: value, residencyUserClaim: false, selectedFolkResidency: '' }); }}
                >
                  <SelectTrigger className="w-full !h-8 border border-gray-200 rounded-md text-sm text-gray-900 bg-white focus:border-[#ea6506] focus:ring-1 focus:ring-[#ea6506] focus-visible:border-[#ea6506] focus-visible:ring-1 focus-visible:ring-[#ea6506] outline-none shadow-sm">
                    <SelectValue placeholder="Select your mentor">
                      {(val) => {
                        const matched = guides.find((g: any) => g.guideId === val);
                        return matched ? (matched.name || matched.abbr) : val;
                      }}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent className="min-w-[340px] max-w-none max-h-60 overflow-y-auto">
                    {guides.map((guide: any) => (
                      <SelectItem key={guide.guideId} value={guide.guideId}>
                        {guide.isPrabhupadaWorldMentor ? (
                          <span className="flex items-center gap-2">
                            {guide.name}
                            <span className="text-[10px] bg-orange-100 text-orange-700 font-semibold px-1.5 py-0.5 rounded-full">Prabhupada World</span>
                          </span>
                        ) : guide.name || guide.abbr}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </>
            )}
          </div>

          {/* FOLK Center — hidden for Prabhupada World users */}
          {formData.selectedGuideId !== 'MENTOR-PW-HIRANYAVARNA' && (
            <div className="space-y-1.5">
              <label htmlFor="folkCenter" className="text-sm font-medium text-gray-700 block mb-1">
                FOLK Center <span className="text-red-500 font-bold">*</span>
              </label>
              <p className="text-xs text-gray-400 mb-2">Select the FOLK center you are associated with</p>
              {loadingResidencies ? (
                <div className="flex items-center justify-center h-8 border border-gray-200 rounded-md bg-gray-50">
                  <Loader2 className="w-4 h-4 animate-spin mr-2 text-gray-400" />
                  <span className="text-xs text-gray-500">Loading centers...</span>
                </div>
              ) : (
                <Select
                  value={formData.selectedFolkResidency}
                  onValueChange={(value) => { if (value) setFormData({ ...formData, selectedFolkResidency: value }); }}
                >
                  <SelectTrigger id="folkCenter" className="w-full !h-8 border border-gray-200 rounded-md text-sm text-gray-900 bg-white focus:border-[#ea6506] focus:ring-1 focus:ring-[#ea6506] focus-visible:border-[#ea6506] focus-visible:ring-1 focus-visible:ring-[#ea6506] outline-none shadow-sm">
                    <SelectValue placeholder="Select your FOLK center">
                      {(val) => {
                        const matched = residencies.find((r: any) => r.residencyId === val);
                        return matched ? matched.residencyName : val;
                      }}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {residencies.map((r: any) => (
                      <SelectItem key={r.residencyId} value={r.residencyId}>
                        {r.residencyName}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>
          )}

          {/* Residency Toggle — hidden for Prabhupada World users */}
          {formData.selectedGuideId !== 'MENTOR-PW-HIRANYAVARNA' && (
            <div className="space-y-3">
              <div className="flex items-center justify-between px-4 py-3 bg-white border border-gray-200 rounded-md shadow-sm">
                <label htmlFor="residency" className="cursor-pointer text-sm font-medium text-gray-700">Staying in FOLK Residency?</label>
                <Switch
                  id="residency"
                  checked={formData.residencyUserClaim}
                  onCheckedChange={(checked) => setFormData(prev => ({ ...prev, residencyUserClaim: checked }))}
                />
              </div>

              {formData.residencyUserClaim && (
                <div className="space-y-1.5 animate-in fade-in duration-200">
                  <label htmlFor="residencyJoinDate" className="text-sm font-medium text-gray-700 block mb-1">Residency Join Date <span className="text-red-500 font-bold">*</span></label>
                  <input
                    id="residencyJoinDate"
                    type="date"
                    value={formData.residencyJoinDate}
                    onChange={(e) => setFormData({ ...formData, residencyJoinDate: e.target.value })}
                    max={new Date().toISOString().split('T')[0]}
                    required
                    className="w-full h-8 px-4 border border-gray-200 rounded-md text-sm text-gray-900 bg-white focus:outline-none focus:border-[#ea6506] focus:ring-1 focus:ring-[#ea6506] transition-all shadow-sm"
                  />
                </div>
              )}
            </div>
          )}

          {/* Ashray Exam Toggle */}
          <div className="space-y-3">
            <div className="flex items-center justify-between px-4 py-3 bg-white border border-gray-200 rounded-md shadow-sm">
              <label htmlFor="ashray-exam" className="cursor-pointer text-sm font-medium text-gray-700">Have you taken the Ashraya Exam?</label>
              <Switch
                id="ashray-exam"
                checked={hasTakenExam}
                onCheckedChange={(checked) => {
                  setHasTakenExam(checked);
                  if (!checked) setSelectedExamLevel('');
                }}
              />
            </div>

            {hasTakenExam && (
              <div className="space-y-1.5 animate-in fade-in duration-200">
                <label htmlFor="examLevel" className="text-sm font-medium text-gray-700 block mb-1">Ashray Level <span className="text-red-500 font-bold">*</span></label>
                <Select value={selectedExamLevel} onValueChange={(value) => { if (value) setSelectedExamLevel(value); }}>
                  <SelectTrigger id="examLevel" className="w-full !h-8 border border-gray-200 rounded-md text-sm text-gray-900 bg-white focus:border-[#ea6506] focus:ring-1 focus:ring-[#ea6506] focus-visible:border-[#ea6506] focus-visible:ring-1 focus-visible:ring-[#ea6506] outline-none shadow-sm">
                    <SelectValue placeholder="Select your level" />
                  </SelectTrigger>
                  <SelectContent>
                    {EXAM_TAKEN_LEVELS.map((level) => (
                      <SelectItem key={level} value={level}>{level}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>

          {/* Submit Button */}
          <button
            type="submit"
            disabled={loading || guides.length === 0}
            className="w-full h-11 mt-4 bg-[#ea6506] hover:bg-[#d35a04] text-white font-semibold text-sm rounded-md shadow-sm hover:shadow transition-all flex items-center justify-center cursor-pointer disabled:opacity-75 disabled:cursor-not-allowed"
          >
            {loading ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin text-white" />
                Creating Account…
              </>
            ) : (
              'Complete Registration'
            )}
          </button>

        </form>
      </div>
    </div>
  );
}
