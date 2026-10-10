import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { toast } from 'sonner';
import { Check, ChevronDown, Loader2, Leaf, HeartHandshake, BookOpen, Clock, Building2 } from 'lucide-react';
import { registerBvMember } from '@/lib/app-endpoints-sdk';
import { sendOrQueue } from '@/lib/offlineQueue';
import { useUserProfile } from '@/contexts/UserProfileContext';
import { BULK_USER_ASHRAY_LEVELS, BULK_USER_TIME_PREFERENCES } from '@/config/bulkUserCsv';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess?: () => void;
  segment?: 'PW' | 'FOLK';
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

const ASHRAY_LEVELS = BULK_USER_ASHRAY_LEVELS.map(value => ({
  value,
  label: value === 'None' ? 'None (Not a member yet)' : value,
}));

const PW_CLASSES = [
  { value: '5.30 a.m.', label: '5:30 AM Morning Class' },
  { value: '9.30 a.m.', label: '9:30 AM Morning Class' },
  { value: 'Tuesday weekly special', label: 'Tuesday Weekly Special Class' },
  { value: 'None', label: 'None / Not attending currently' },
];

const TIME_PREFERENCES = BULK_USER_TIME_PREFERENCES;

const parsePhone = (p?: string) => {
  if (!p) return { cc: '+91', num: '' };
  if (p.startsWith('+') && p.length > 10) {
    return { cc: p.slice(0, -10), num: p.slice(-10) };
  }
  return { cc: '+91', num: p.replace(/\D/g, '').slice(-10) };
};

export default function BvRegistrationModal({ open, onOpenChange, onSuccess, segment }: Props) {
  const { profile } = useUserProfile();
  const activeSegment = segment || profile?.segment || 'PW';
  
  const initialPhoneParts = parsePhone((profile as any)?.phone);

  const [fullName, setFullName] = useState(profile?.fullName || '');
  const [phoneCountryCode, setPhoneCountryCode] = useState(initialPhoneParts.cc);
  const [phone, setPhone] = useState(initialPhoneParts.num);
  const [whatsappCountryCode, setWhatsappCountryCode] = useState(initialPhoneParts.cc);
  const [whatsappNumber, setWhatsappNumber] = useState(initialPhoneParts.num);
  const [address, setAddress] = useState('');
  const [occupation, setOccupation] = useState('');
  const [companyName, setCompanyName] = useState('');
  const [dob, setDob] = useState('');
  const [gender, setGender] = useState<'Male' | 'Female' | 'Other'>('Male');

  const [dailyChantingRounds, setDailyChantingRounds] = useState('');
  const [weeklyReadingHours, setWeeklyReadingHours] = useState('');
  const [weeklyHearingHours, setWeeklyHearingHours] = useState('');

  const [ashrayLevel, setAshrayLevel] = useState(profile?.ashrayLevel || 'None');
  const [pwClassesAttending, setPwClassesAttending] = useState<string[]>(['None']);
  const [classesOpen, setClassesOpen] = useState(false);

  const [inTouchWithTemple, setInTouchWithTemple] = useState(false);
  const [templeName, setTempleName] = useState('');
  const [devoteeName, setDevoteeName] = useState('');

  const [timePreference, setTimePreference] = useState('7:45 PM – 8:15 PM (Everyday)');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (profile?.fullName) {
      setFullName(profile.fullName);
    }
    if (profile?.phone) {
      const parts = parsePhone(profile.phone);
      setPhoneCountryCode(parts.cc);
      setPhone(parts.num);
      setWhatsappCountryCode(parts.cc);
      setWhatsappNumber(parts.num);
    }
  }, [profile?.fullName, profile?.phone]);

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

  const isAtLeastFourteen = (value: string) => {
    const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(value);
    if (!match) return false;

    const [, day, month, year] = match;
    const birthDate = new Date(Number(year), Number(month) - 1, Number(day));
    if (
      birthDate.getFullYear() !== Number(year) ||
      birthDate.getMonth() !== Number(month) - 1 ||
      birthDate.getDate() !== Number(day)
    ) return false;

    const latestAllowedBirthDate = new Date();
    latestAllowedBirthDate.setHours(0, 0, 0, 0);
    latestAllowedBirthDate.setFullYear(latestAllowedBirthDate.getFullYear() - 14);
    return birthDate <= latestAllowedBirthDate;
  };

  const togglePwClass = (value: string) => {
    setPwClassesAttending(current => {
      if (value === 'None') return ['None'];
      const next = current.filter(item => item !== 'None');
      return next.includes(value)
        ? next.filter(item => item !== value)
        : [...next, value];
    });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!fullName.trim()) { toast.error('Please enter your full name'); return; }
    const sanitizedPhone = phone.replace(/\D/g, '');
    if (sanitizedPhone.length < 7) {
      toast.error('Phone number must be at least 7 digits');
      return;
    }
    const sanitizedWhatsapp = whatsappNumber.replace(/\D/g, '');
    if (sanitizedWhatsapp.length !== 10) {
      toast.error('WhatsApp number must be exactly 10 digits');
      return;
    }
    if (!isAtLeastFourteen(dob)) {
      toast.error('Please enter a valid Date of Birth. Participants must be at least 14 years old.');
      return;
    }
    if (!occupation.trim() || /\d/.test(occupation)) {
      toast.error('Occupation must contain letters only (no numbers allowed)');
      return;
    }
    if (!companyName.trim() || /\d/.test(companyName)) {
      toast.error('Company / Institution name must contain letters only (no numbers allowed)');
      return;
    }
    if (!address.trim()) { toast.error('Please enter your full residential address'); return; }
    
    const roundsNum = Number(dailyChantingRounds);
    if (dailyChantingRounds.trim() === '' || isNaN(roundsNum) || roundsNum < 0 || roundsNum > 192) {
      toast.error('Daily Chanting Rounds must be a number less than or equal to 192');
      return;
    }
    
    const readingMins = Number(weeklyReadingHours);
    if (weeklyReadingHours.trim() === '' || isNaN(readingMins) || readingMins < 0) {
      toast.error('Book Reading Weekly Average must be numbers only (in minutes)');
      return;
    }
    
    const hearingMins = Number(weeklyHearingHours);
    if (weeklyHearingHours.trim() === '' || isNaN(hearingMins) || hearingMins < 0) {
      toast.error('Hearing Lectures Weekly Average must be numbers only (in minutes)');
      return;
    }
    
    if (inTouchWithTemple) {
      if (!templeName.trim()) { toast.error('Please enter the temple name'); return; }
      if (!devoteeName.trim()) { toast.error('Please enter the devotee name'); return; }
    }

    setSubmitting(true);
    try {
      const submission = {
        fullName: fullName.trim(),
        phoneCountryCode,
        phone: sanitizedPhone,
        whatsappCountryCode,
        whatsappNumber: sanitizedWhatsapp,
        address: address.trim(),
        occupation: occupation.trim(),
        companyName: companyName.trim(),
        dob,
        gender,
        dailyChantingRounds: roundsNum,
        weeklyReadingHours: `${readingMins} mins`,
        weeklyHearingHours: `${hearingMins} mins`,
        ashrayLevel,
        pwClassesAttending: pwClassesAttending.length ? pwClassesAttending.join(', ') : 'None',
        inTouchWithTemple,
        templeName: inTouchWithTemple ? templeName.trim() : '',
        devoteeName: inTouchWithTemple ? devoteeName.trim() : '',
        timePreference,
        segment: segment || (profile as any)?.segment || ((profile as any)?.isPrabhupadaWorldUser ? 'PW' : 'FOLK'),
      };
      const outcome = await sendOrQueue({
        type: 'bv_registration',
        dedupeKey: `bv_registration:${profile?.userId || fullName.trim()}`,
        payload: submission,
        send: () => registerBvMember(submission),
      });
      if (outcome.status === 'queued') {
        onOpenChange(false);
        return;
      }

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
                <Label htmlFor="dob">Date of Birth *</Label>
                <Input
                  id="dob"
                  type="text"
                  inputMode="numeric"
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
                  onChange={e => setOccupation(e.target.value.replace(/[^a-zA-Z\s.-]/g, ''))}
                  placeholder="e.g. Software Engineer / Student"
                  required
                />
              </div>

              <div className="space-y-1.5 md:col-span-2">
                <Label htmlFor="companyName">Company / Institution Name *</Label>
                <Input
                  id="companyName"
                  value={companyName}
                  onChange={e => setCompanyName(e.target.value.replace(/[^a-zA-Z\s.-]/g, ''))}
                  placeholder="e.g. Infosys / ABC College"
                  required
                />
              </div>

              <div className="space-y-1.5">
                <Label>Phone Number *</Label>
                <div className="flex gap-2">
                  <Input
                    type="text"
                    value={phoneCountryCode}
                    onChange={e => setPhoneCountryCode(e.target.value)}
                    placeholder="+91"
                    className="w-[70px] text-center font-mono px-2"
                  />
                  <Input
                    type="tel"
                    inputMode="numeric"
                    value={phone}
                    onChange={e => setPhone(e.target.value.replace(/\D/g, '').slice(0, 15))}
                    maxLength={15}
                    placeholder={initialPhoneParts.num || "Phone number"}
                    required
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <Label>WhatsApp Number *</Label>
                <div className="flex gap-2">
                  <Input
                    type="text"
                    value={whatsappCountryCode}
                    onChange={e => setWhatsappCountryCode(e.target.value)}
                    placeholder="+91"
                    className="w-[70px] text-center font-mono px-2"
                  />
                  <Input
                    type="tel"
                    inputMode="numeric"
                    value={whatsappNumber}
                    onChange={e => setWhatsappNumber(e.target.value.replace(/\D/g, '').slice(0, 10))}
                    maxLength={10}
                    placeholder={initialPhoneParts.num || "9876543210"}
                    required
                  />
                </div>
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
                  inputMode="numeric"
                  value={dailyChantingRounds}
                  onChange={e => setDailyChantingRounds(e.target.value.replace(/\D/g, ''))}
                  placeholder="e.g. 16"
                  required
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="weeklyReading" className="whitespace-nowrap">Book Reading (Weekly Avg in Minutes) *</Label>
                <Input
                  id="weeklyReading"
                  type="text"
                  inputMode="numeric"
                  value={weeklyReadingHours}
                  onChange={e => setWeeklyReadingHours(e.target.value.replace(/\D/g, ''))}
                  placeholder="e.g. 120 (in minutes)"
                  required
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="weeklyHearing" className="whitespace-nowrap">Hearing Lectures (Weekly Avg in Minutes) *</Label>
                <Input
                  id="weeklyHearing"
                  type="text"
                  inputMode="numeric"
                  value={weeklyHearingHours}
                  onChange={e => setWeeklyHearingHours(e.target.value.replace(/\D/g, ''))}
                  placeholder="e.g. 90 (in minutes)"
                  required
                />
              </div>
            </div>
          </div>

          {/* Section 3: Ashraya & Prabhupada World Classes */}
          <div className="space-y-4 border-b pb-4">
            <h4 className="text-sm font-semibold flex items-center gap-1.5 text-primary">
              <HeartHandshake className="w-4 h-4" /> {activeSegment === 'FOLK' ? 'Ashraya Level' : 'Ashraya Level & Current Classes'}
            </h4>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className={activeSegment === 'FOLK' ? 'space-y-1.5 col-span-1 md:col-span-2' : 'space-y-1.5'}>
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

              {activeSegment !== 'FOLK' && (
                <div className="space-y-1.5">
                  <Label id="pw-classes-label">Prabhupada World Classes Attending *</Label>
                  <Button
                    type="button"
                    variant="outline"
                    className="w-full justify-between font-normal"
                    aria-labelledby="pw-classes-label"
                    aria-expanded={classesOpen}
                    onClick={() => setClassesOpen(open => !open)}
                  >
                    <span className="truncate">{pwClassesAttending.map(value => PW_CLASSES.find(c => c.value === value)?.label || value).join(', ') || 'Select classes'}</span>
                    <ChevronDown className="ml-2 h-4 w-4 shrink-0" />
                  </Button>
                  {classesOpen && (
                    <div className="space-y-1 rounded-md border bg-popover p-1" role="group" aria-labelledby="pw-classes-label">
                      {PW_CLASSES.map(c => {
                        const selected = pwClassesAttending.includes(c.value);
                        return (
                          <Button
                            key={c.value}
                            type="button"
                            variant="ghost"
                            className="w-full justify-start gap-2 px-2 font-normal"
                            aria-pressed={selected}
                            onClick={() => togglePwClass(c.value)}
                          >
                            <span className={`flex h-4 w-4 items-center justify-center rounded border ${selected ? 'border-primary bg-primary text-primary-foreground' : 'border-input'}`}>
                              {selected && <Check className="h-3 w-3" />}
                            </span>
                            {c.label}
                          </Button>
                        );
                      })}
                    </div>
                  )}
                  <p className="text-xs text-muted-foreground">Select all classes that apply. Choosing “None” clears other selections.</p>
                </div>
              )}
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

