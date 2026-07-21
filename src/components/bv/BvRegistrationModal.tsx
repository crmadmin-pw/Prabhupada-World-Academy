import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { toast } from 'sonner';
import { Loader2, Leaf, HeartHandshake, BookOpen, Clock, Building2 } from 'lucide-react';
import { registerBvMember } from '@/lib/zite-endpoints-sdk';
import { useUserProfile } from '@/contexts/UserProfileContext';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess?: () => void;
}

const COUNTRY_CODES = [
  { code: '+91', country: 'India', flag: '🇮🇳' },
  { code: '+1', country: 'USA / Canada', flag: '🇺🇸' },
  { code: '+44', country: 'UK', flag: '🇬🇧' },
  { code: '+971', country: 'UAE', flag: '🇦🇪' },
  { code: '+65', country: 'Singapore', flag: '🇸🇬' },
  { code: '+61', country: 'Australia', flag: '🇦🇺' },
  { code: '+60', country: 'Malaysia', flag: '🇲🇾' },
  { code: '+94', country: 'Sri Lanka', flag: '🇱🇰' },
  { code: '+977', country: 'Nepal', flag: '🇳🇵' },
  { code: '+880', country: 'Bangladesh', flag: '🇧🇩' },
  { code: '+49', country: 'Germany', flag: '🇩🇪' },
  { code: '+33', country: 'France', flag: '🇫🇷' },
  { code: '+81', country: 'Japan', flag: '🇯🇵' },
  { code: '+86', country: 'China', flag: '🇨🇳' },
  { code: '+7', country: 'Russia', flag: '🇷🇺' },
  { code: '+55', country: 'Brazil', flag: '🇧🇷' },
  { code: '+27', country: 'South Africa', flag: '🇿🇦' },
  { code: '+64', country: 'New Zealand', flag: '🇳🇿' },
];

const ASHRAY_LEVELS = [
  { value: 'None', label: 'None (Not a member yet)' },
  { value: 'Jigyasa', label: 'Jigyasa' },
  { value: 'Shraddhavan', label: 'Shraddhavan' },
  { value: 'Sevak', label: 'Sevak' },
  { value: 'Sadhaka', label: 'Sadhaka' },
  { value: 'Upasaka', label: 'Upasaka' },
  { value: 'Caranashraya', label: 'Caranashraya' },
  { value: 'Harinam Diksha', label: 'Harinam Diksha' },
  { value: 'Gauranga Sabha', label: 'Gauranga Sabha' },
];

const PW_CLASSES = [
  { value: '5.30 a.m.', label: '5:30 AM Morning Class' },
  { value: '9.30 a.m.', label: '9:30 AM Morning Class' },
  { value: 'Tuesday weekly special', label: 'Tuesday Weekly Special Class' },
  { value: 'None', label: 'None / Not attending currently' },
];

const TIME_PREFERENCES = [
  '7:45 PM – 8:15 PM (Everyday)',
  '1:00 PM – 1:30 PM (Monday to Friday)',
  '8:30 PM – 9:00 PM (Monday to Friday)',
  '11:00 AM – 12:00 PM (Saturday & Sunday only)',
];

export default function BvRegistrationModal({ open, onOpenChange, onSuccess }: Props) {
  const { profile } = useUserProfile();

  const [fullName, setFullName] = useState(profile?.fullName || '');
  const [phoneCountryCode, setPhoneCountryCode] = useState('+91');
  const [phone, setPhone] = useState((profile as any)?.phone || '');
  const [address, setAddress] = useState('');
  const [occupation, setOccupation] = useState('');
  const [companyName, setCompanyName] = useState('');
  const [dob, setDob] = useState('');
  const [gender, setGender] = useState<'Male' | 'Female' | 'Other'>('Male');

  const [dailyChantingRounds, setDailyChantingRounds] = useState('');
  const [weeklyReadingHours, setWeeklyReadingHours] = useState('');
  const [weeklyHearingHours, setWeeklyHearingHours] = useState('');

  const [ashrayLevel, setAshrayLevel] = useState(profile?.ashrayLevel || 'None');
  const [pwClassesAttending, setPwClassesAttending] = useState<'5.30 a.m.' | '9.30 a.m.' | 'Tuesday weekly special' | 'None'>('None');

  const [inTouchWithTemple, setInTouchWithTemple] = useState(false);
  const [templeName, setTempleName] = useState('');
  const [devoteeName, setDevoteeName] = useState('');

  const [timePreference, setTimePreference] = useState('7:45 PM – 8:15 PM (Everyday)');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (profile?.fullName) {
      setFullName(profile.fullName);
    }
  }, [profile?.fullName]);

  const handleDobChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    let val = e.target.value.replace(/\D/g, '');
    if (val.length > 8) val = val.slice(0, 8);
    if (val.length >= 5) {
      val = `${val.slice(0, 2)}/${val.slice(2, 4)}/${val.slice(4)}`;
    } else if (val.length >= 3) {
      val = `${val.slice(0, 2)}/${val.slice(2)}`;
    }
    setDob(val);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!fullName.trim()) { toast.error('Please enter your full name'); return; }
    if (!phone.trim()) { toast.error('Please enter your WhatsApp phone number'); return; }
    if (!dob) { toast.error('Please enter your date of birth'); return; }
    if (!occupation.trim()) { toast.error('Please enter your occupation'); return; }
    if (!companyName.trim()) { toast.error('Please enter your company / institution name'); return; }
    if (!address.trim()) { toast.error('Please enter your address'); return; }
    if (!dailyChantingRounds.trim()) { toast.error('Please enter your daily chanting rounds'); return; }
    if (!weeklyReadingHours.trim()) { toast.error('Please specify your weekly book reading duration'); return; }
    if (!weeklyHearingHours.trim()) { toast.error('Please specify your weekly hearing classes duration'); return; }
    if (inTouchWithTemple) {
      if (!templeName.trim()) { toast.error('Please enter the temple name'); return; }
      if (!devoteeName.trim()) { toast.error('Please enter the devotee name'); return; }
    }

    setSubmitting(true);
    try {
      await registerBvMember({
        fullName: fullName.trim(),
        phoneCountryCode,
        phone: phone.trim(),
        address: address.trim(),
        occupation: occupation.trim(),
        companyName: companyName.trim(),
        dob,
        gender,
        dailyChantingRounds: Number(dailyChantingRounds) || 0,
        weeklyReadingHours: weeklyReadingHours.trim(),
        weeklyHearingHours: weeklyHearingHours.trim(),
        ashrayLevel,
        pwClassesAttending,
        inTouchWithTemple,
        templeName: inTouchWithTemple ? templeName.trim() : '',
        devoteeName: inTouchWithTemple ? devoteeName.trim() : '',
        timePreference,
      });

      toast.success('Bhakti Vriksha Registration submitted! Awaiting Admin approval.');
      onOpenChange(false);
      if (onSuccess) onSuccess();
    } catch (err: any) {
      toast.error(err?.message || 'Failed to submit registration');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-4xl max-h-[90vh] overflow-y-auto w-full">
        <DialogHeader>
          <div className="flex items-center gap-2 text-primary">
            <Leaf className="w-5 h-5" />
            <DialogTitle className="text-xl">Join Bhakti Vriksha Reading Group</DialogTitle>
          </div>
          <DialogDescription>
            Please fill out your details to help us assign you to the best suited Reading Group. All fields are compulsory.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-6 pt-2">

          {/* Section 1: General Details */}
          <div className="space-y-4 border-b pb-4">
            <h4 className="text-sm font-semibold flex items-center gap-1.5 text-primary">
              <Building2 className="w-4 h-4" /> Personal & Contact Information
            </h4>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="fullName">Full Name *</Label>
                <Input
                  id="fullName"
                  value={fullName}
                  readOnly
                  disabled
                  className="bg-muted cursor-not-allowed text-muted-foreground font-medium"
                />
              </div>

              <div className="space-y-1.5">
                <Label>WhatsApp Number *</Label>
                <div className="flex gap-2">
                  <Select value={phoneCountryCode} onValueChange={(val) => val && setPhoneCountryCode(val)}>
                    <SelectTrigger className="w-[140px] shrink-0">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="max-h-60 overflow-y-auto">
                      {COUNTRY_CODES.map(c => (
                        <SelectItem key={c.code} value={c.code}>
                          <span className="flex items-center gap-1.5">
                            <span>{c.flag}</span>
                            <span>{c.code}</span>
                            <span className="text-xs text-muted-foreground">({c.country})</span>
                          </span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Input
                    type="tel"
                    value={phone}
                    onChange={e => setPhone(e.target.value)}
                    placeholder="9876543210"
                    required
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="dob">Date of Birth *</Label>
                <Input
                  id="dob"
                  type="text"
                  placeholder="DD/MM/YYYY"
                  value={dob}
                  onChange={handleDobChange}
                  maxLength={10}
                  required
                />
              </div>

              <div className="space-y-1.5">
                <Label>Gender *</Label>
                <Select value={gender} onValueChange={(val: any) => val && setGender(val)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Male">Male</SelectItem>
                    <SelectItem value="Female">Female</SelectItem>
                    <SelectItem value="Other">Other</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="occupation">Occupation *</Label>
                <Input
                  id="occupation"
                  value={occupation}
                  onChange={e => setOccupation(e.target.value)}
                  placeholder="e.g. Software Engineer / Student"
                  required
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="companyName">Company / Institution Name *</Label>
                <Input
                  id="companyName"
                  value={companyName}
                  onChange={e => setCompanyName(e.target.value)}
                  placeholder="e.g. Infosys / ABC College"
                  required
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="address">Full Residential Address *</Label>
              <Textarea
                id="address"
                value={address}
                onChange={e => setAddress(e.target.value)}
                placeholder="Enter house no., street, city, locality & pin code..."
                rows={2}
                required
              />
            </div>
          </div>

          {/* Section 2: Spiritual Habits */}
          <div className="space-y-4 border-b pb-4">
            <h4 className="text-sm font-semibold flex items-center gap-1.5 text-primary">
              <BookOpen className="w-4 h-4" /> Spiritual Habits & Practice
            </h4>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="dailyChanting">Daily Chanting (Rounds) *</Label>
                <Input
                  id="dailyChanting"
                  type="text"
                  value={dailyChantingRounds}
                  onChange={e => setDailyChantingRounds(e.target.value)}
                  placeholder="e.g. 16 rounds or 4 rounds"
                  required
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="weeklyReading">Book Reading (Weekly Avg) *</Label>
                <Input
                  id="weeklyReading"
                  value={weeklyReadingHours}
                  onChange={e => setWeeklyReadingHours(e.target.value)}
                  placeholder="e.g. 2 hours or 30 mins / week"
                  required
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="weeklyHearing">Hearing Lectures/Classes (Weekly Avg) *</Label>
                <Input
                  id="weeklyHearing"
                  value={weeklyHearingHours}
                  onChange={e => setWeeklyHearingHours(e.target.value)}
                  placeholder="e.g. 1.5 hours or 45 mins / week"
                  required
                />
              </div>
            </div>
          </div>

          {/* Section 3: Ashraya & Prabhupada World Classes */}
          <div className="space-y-4 border-b pb-4">
            <h4 className="text-sm font-semibold flex items-center gap-1.5 text-primary">
              <HeartHandshake className="w-4 h-4" /> Ashraya Level & Current Classes
            </h4>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label>Present Ashraya Level *</Label>
                <Select value={ashrayLevel} onValueChange={(val) => val && setAshrayLevel(val)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="max-h-60 overflow-y-auto min-w-[240px]">
                    {ASHRAY_LEVELS.map(lvl => (
                      <SelectItem key={lvl.value} value={lvl.value}>{lvl.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label>Prabhupada World Classes Attending *</Label>
                <Select value={pwClassesAttending} onValueChange={(val: any) => val && setPwClassesAttending(val)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="max-h-60 overflow-y-auto min-w-[280px]">
                    {PW_CLASSES.map(c => (
                      <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Temple Connection Switch */}
            <div className="pt-2 space-y-3">
              <div className="flex items-center justify-between p-3 border rounded-lg bg-muted/30">
                <div>
                  <p className="text-sm font-medium">Are you in touch with any ISKCON or Hare Krishna Temple?</p>
                  <p className="text-xs text-muted-foreground">Toggle yes if you connected with a specific temple or devotee mentor</p>
                </div>
                <Switch
                  checked={inTouchWithTemple}
                  onCheckedChange={setInTouchWithTemple}
                />
              </div>

              {inTouchWithTemple && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-1">
                  <div className="space-y-1.5">
                    <Label htmlFor="templeName">Temple Name *</Label>
                    <Input
                      id="templeName"
                      value={templeName}
                      onChange={e => setTempleName(e.target.value)}
                      placeholder="e.g. ISKCON Bangalore / Hare Krishna Temple"
                      required={inTouchWithTemple}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="devoteeName">Devotee Name (In Touch With) *</Label>
                    <Input
                      id="devoteeName"
                      value={devoteeName}
                      onChange={e => setDevoteeName(e.target.value)}
                      placeholder="e.g. HG Narayana Prabhu"
                      required={inTouchWithTemple}
                    />
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Section 4: Reading Group Time Preference */}
          <div className="space-y-3">
            <h4 className="text-sm font-semibold flex items-center gap-1.5 text-primary">
              <Clock className="w-4 h-4" /> Preferred Reading Group Time Slot *
            </h4>

            <Select value={timePreference} onValueChange={(val) => val && setTimePreference(val)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="max-h-60 overflow-y-auto min-w-[320px]">
                {TIME_PREFERENCES.map(tp => (
                  <SelectItem key={tp} value={tp}>{tp}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <DialogFooter className="pt-4 border-t">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={submitting}>
              {submitting ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
              Submit Registration
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}



