import { useNavigate } from 'react-router-dom';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import {
  BookOpen, CheckCircle2, Users, BarChart2, Calendar, UserCircle,
  ArrowLeft, Flame, ClipboardList, Star, ChevronRight, HelpCircle,
  UserCheck, TreePine, Shield
} from 'lucide-react';

const PWA_LOGO = 'https://images.fillout.com/orgid-615562/flowpublicid-u91plgmzcu/widgetid-default/q1fJEkENG5kbvfjYaFbDeT/pasted-image-1773145742081.png';

function Step({ num, title, desc }: { num: number; title: string; desc: string }) {
  return (
    <div className="flex gap-4 items-start">
      <div className="flex-shrink-0 w-8 h-8 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-sm font-bold">
        {num}
      </div>
      <div>
        <p className="font-semibold text-foreground text-sm">{title}</p>
        <p className="text-sm text-muted-foreground mt-0.5">{desc}</p>
      </div>
    </div>
  );
}

function FeatureCard({ icon: Icon, title, desc }: { icon: any; title: string; desc: string }) {
  return (
    <Card className="border-border">
      <CardContent className="pt-4 pb-4 flex gap-3 items-start">
        <div className="w-9 h-9 rounded-lg bg-secondary flex items-center justify-center flex-shrink-0">
          <Icon className="w-5 h-5 text-primary" />
        </div>
        <div>
          <p className="font-semibold text-sm text-foreground">{title}</p>
          <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">{desc}</p>
        </div>
      </CardContent>
    </Card>
  );
}

function UserGuide() {
  return (
    <div className="space-y-6">
      <div>
        <h3 className="font-bold text-foreground mb-3 flex items-center gap-2">
          <Flame className="w-4 h-4 text-primary" /> Getting Started
        </h3>
        <div className="space-y-4 pl-1">
          <Step num={1} title="Register your account" desc="Click 'Register Here' on the home page and fill in your details via the registration form." />
          <Step num={2} title="Wait for guide approval" desc="Your guide will review and approve your account. You'll see a 'Pending Approval' screen in the meantime." />
          <Step num={3} title="Complete your profile" desc="Once approved, go to Profile and fill in your residency join date, folk residency, and other details." />
          <Step num={4} title="Start tracking sadhana" desc="Go to 'Daily Sadhana' every day to log your spiritual practice." />
        </div>
      </div>

      <div>
        <h3 className="font-bold text-foreground mb-3 flex items-center gap-2">
          <ClipboardList className="w-4 h-4 text-primary" /> Daily Sadhana Form
        </h3>
        <div className="space-y-4 pl-1">
          <Step num={1} title="Open the form each day" desc="Navigate to 'Daily Sadhana' from your dashboard. The form shows today's date by default." />
          <Step num={2} title="Fill all your practice fields" desc="Enter your chanting rounds, reading minutes, attendance, and other fields set by your guide." />
          <Step num={3} title="Submit before midnight" desc="Submit your entry for the day. You can edit it until the next day if needed." />
          <Step num={4} title="Track your score" desc="Each submission is scored automatically. View your score breakdown on the dashboard." />
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <FeatureCard icon={Calendar} title="Submission History" desc="View all your past sadhana entries in calendar or list view under 'History'." />
        <FeatureCard icon={BarChart2} title="Metrics & Trends" desc="Your dashboard shows weekly/monthly score trends and streaks." />
        <FeatureCard icon={Star} title="Leaderboard" desc="See how you rank among other practitioners in your group." />
        <FeatureCard icon={TreePine} title="Bhakti Vriksha" desc="Track your BV group attendance and session history under 'Bhakti Vriksha'." />
      </div>

      <div className="bg-secondary rounded-lg p-4 border border-border">
        <p className="text-sm font-semibold text-foreground mb-2">💡 Pro Tips</p>
        <ul className="space-y-1.5 text-sm text-muted-foreground">
          <li className="flex gap-2"><ChevronRight className="w-4 h-4 text-primary flex-shrink-0 mt-0.5" />Submit sadhana at the same time each day to build a habit.</li>
          <li className="flex gap-2"><ChevronRight className="w-4 h-4 text-primary flex-shrink-0 mt-0.5" />If you were sick or out of station, mark the appropriate status — scoring adjusts automatically.</li>
          <li className="flex gap-2"><ChevronRight className="w-4 h-4 text-primary flex-shrink-0 mt-0.5" />Keep your profile up to date — residency join date affects your scoring criteria.</li>
          <li className="flex gap-2"><ChevronRight className="w-4 h-4 text-primary flex-shrink-0 mt-0.5" />Apply for Ashray upgrade from your Profile page once you meet the criteria.</li>
        </ul>
      </div>
    </div>
  );
}

function BvslGuide() {
  return (
    <div className="space-y-6">
      <div>
        <h3 className="font-bold text-foreground mb-3 flex items-center gap-2">
          <TreePine className="w-4 h-4 text-primary" /> Managing Your BV Group
        </h3>
        <div className="space-y-4 pl-1">
          <Step num={1} title="Access BVSL Dashboard" desc="After login, go to 'BVSL Dashboard' from the navigation. You manage your group here." />
          <Step num={2} title="View your members" desc="The Members tab shows all active members in your Bhakti Vriksha group with their attendance." />
          <Step num={3} title="Conduct a session" desc="Go to 'Sessions' tab → click 'Conduct Session' → mark attendance for present members." />
          <Step num={4} title="Handle join requests" desc="Members who request to join appear in the 'Join Requests' tab. Approve or reject them." />
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <FeatureCard icon={Users} title="Member Overview" desc="See each member's attendance rate, last session, and overall participation." />
        <FeatureCard icon={CheckCircle2} title="Session Records" desc="All conducted sessions are logged with date, attendees, and attendance rate." />
        <FeatureCard icon={ClipboardList} title="Preaching Reports" desc="Log preaching activities and outreach efforts for your group." />
        <FeatureCard icon={BarChart2} title="Group Stats" desc="Track your group's overall attendance trends over time." />
      </div>

      <div className="bg-secondary rounded-lg p-4 border border-border">
        <p className="text-sm font-semibold text-foreground mb-2">💡 BVSL Tips</p>
        <ul className="space-y-1.5 text-sm text-muted-foreground">
          <li className="flex gap-2"><ChevronRight className="w-4 h-4 text-primary flex-shrink-0 mt-0.5" />Conduct sessions promptly after each BV meeting so attendance is recorded accurately.</li>
          <li className="flex gap-2"><ChevronRight className="w-4 h-4 text-primary flex-shrink-0 mt-0.5" />You also track your own sadhana — use the User Dashboard for your daily practice.</li>
          <li className="flex gap-2"><ChevronRight className="w-4 h-4 text-primary flex-shrink-0 mt-0.5" />Contact your guide if you need to add members who can't request themselves.</li>
        </ul>
      </div>
    </div>
  );
}

function GuideGuide() {
  return (
    <div className="space-y-6">
      <div>
        <h3 className="font-bold text-foreground mb-3 flex items-center gap-2">
          <Shield className="w-4 h-4 text-primary" /> Guide Responsibilities
        </h3>
        <div className="space-y-4 pl-1">
          <Step num={1} title="Approve new members" desc="New registrations appear in 'Pending Approvals'. Review and approve or reject each request." />
          <Step num={2} title="Set up sadhana fields" desc="Go to 'Field Setup' to configure which sadhana fields your users see and their scoring criteria." />
          <Step num={3} title="Monitor your users" desc="The 'Users' tab shows all your practitioners with their submission rates and scores." />
          <Step num={4} title="Review reports" desc="Use the 'Reports' tab to generate detailed sadhana reports for any date range." />
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <FeatureCard icon={UserCheck} title="Approvals" desc="Approve new users, handle Ashray upgrade requests, and manage guide transfer requests." />
        <FeatureCard icon={BarChart2} title="Overview Metrics" desc="Dashboard shows submission rates, missing users today, and 7-day averages at a glance." />
        <FeatureCard icon={BookOpen} title="Detailed Reports" desc="Export CSV, PNG image, or print/PDF reports. Use 'Export Image' to save a shareable PNG of the full report." />
        <FeatureCard icon={TreePine} title="BV Management" desc="Oversee all Bhakti Vriksha groups under your guidance from the BV tab." />
      </div>

      <div className="bg-secondary rounded-lg p-4 border border-border">
        <p className="text-sm font-semibold text-foreground mb-2">💡 Guide Tips</p>
        <ul className="space-y-1.5 text-sm text-muted-foreground">
          <li className="flex gap-2"><ChevronRight className="w-4 h-4 text-primary flex-shrink-0 mt-0.5" />Set field criteria carefully — scoring is based on the criteria you define in Field Setup.</li>
          <li className="flex gap-2"><ChevronRight className="w-4 h-4 text-primary flex-shrink-0 mt-0.5" />Use the 'Missing Today' count on your overview to follow up with practitioners who haven't submitted.</li>
          <li className="flex gap-2"><ChevronRight className="w-4 h-4 text-primary flex-shrink-0 mt-0.5" />Resident and Non-Resident users have separate scoring — check Field Setup for each type.</li>
          <li className="flex gap-2"><ChevronRight className="w-4 h-4 text-primary flex-shrink-0 mt-0.5" />Use <strong>Export Image</strong> in Reports to download a color-coded PNG of the full sadhana table — great for sharing in group chats.</li>
        </ul>
      </div>
    </div>
  );
}

const faqs = [
  { q: "I submitted the wrong data — can I edit it?", a: "Yes. Open the Daily Sadhana form for that date (use History to navigate to it) and resubmit. The latest submission for a date is kept." },
  { q: "Why is my score lower than expected?", a: "Scores depend on your residency type (Resident vs Non-Resident), join date, and the criteria set by your guide. Check your profile to make sure your residency join date is correct." },
  { q: "My account is stuck on 'Pending Approval'", a: "Your guide needs to approve your account. Contact your guide directly. If you don't know who your guide is, reach out to the app admin." },
  { q: "How do I join a Bhakti Vriksha group?", a: "Go to 'Bhakti Vriksha' from your dashboard and browse available groups. Click 'Request to Join' on the group you want to join. Your BVSL will approve the request." },
  { q: "What is Ashray and how do I apply?", a: "Ashray is a spiritual upgrade level. Go to your Profile page — if you meet the criteria, an 'Apply for Ashray' section will appear. Fill the checklist and submit." },
  { q: "Can I use the app on my phone?", a: "Yes! The app is fully responsive and works on all screen sizes. Simply open it in your mobile browser for the best experience." },
];

export default function HowToUsePage() {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <div className="border-b border-border bg-card sticky top-0 z-10">
        <div className="max-w-3xl mx-auto px-4 py-3 flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={() => navigate(-1)} className="gap-1.5">
            <ArrowLeft className="w-4 h-4" /> Back
          </Button>
          <div className="flex items-center gap-2">
            <img src={PWA_LOGO} alt="PWA" className="w-7 h-7 object-contain" />
            <span className="font-semibold text-foreground text-sm">How to Use the App</span>
          </div>
        </div>
      </div>

      <div className="max-w-3xl mx-auto px-4 py-8 space-y-8">
        {/* Hero */}
        <div className="text-center space-y-2">
          <Badge variant="secondary" className="text-primary border-primary/20">User Guide</Badge>
          <h1 className="text-2xl font-bold text-foreground">Welcome to Prabhupada World Academy</h1>
          <p className="text-muted-foreground text-sm max-w-md mx-auto">
            This guide will help you get the most out of the sadhana tracker — from daily submissions to understanding your scores.
          </p>
        </div>

        {/* Role Tabs */}
        <Tabs defaultValue="user">
          <TabsList className="grid grid-cols-3 w-full">
            <TabsTrigger value="user" className="gap-1.5 text-xs sm:text-sm">
              <UserCircle className="w-4 h-4" /> Practitioner
            </TabsTrigger>
            <TabsTrigger value="bvsl" className="gap-1.5 text-xs sm:text-sm">
              <TreePine className="w-4 h-4" /> BVSL
            </TabsTrigger>
            <TabsTrigger value="guide" className="gap-1.5 text-xs sm:text-sm">
              <Shield className="w-4 h-4" /> Guide
            </TabsTrigger>
          </TabsList>
          <TabsContent value="user" className="mt-6"><UserGuide /></TabsContent>
          <TabsContent value="bvsl" className="mt-6"><BvslGuide /></TabsContent>
          <TabsContent value="guide" className="mt-6"><GuideGuide /></TabsContent>
        </Tabs>

        {/* FAQ */}
        <div>
          <h2 className="text-lg font-bold text-foreground mb-4 flex items-center gap-2">
            <HelpCircle className="w-5 h-5 text-primary" /> Frequently Asked Questions
          </h2>
          <Accordion type="single" collapsible className="space-y-2">
            {faqs.map((faq, i) => (
              <AccordionItem key={i} value={`faq-${i}`} className="border border-border rounded-lg px-4">
                <AccordionTrigger className="text-sm font-medium text-foreground hover:no-underline py-3">
                  {faq.q}
                </AccordionTrigger>
                <AccordionContent className="text-sm text-muted-foreground pb-3">
                  {faq.a}
                </AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>
        </div>

        {/* CTA */}
        <div className="text-center py-4 border-t border-border">
          <p className="text-sm text-muted-foreground mb-3">Ready to begin your practice?</p>
          <Button onClick={() => navigate('/')} className="gap-2">
            <Flame className="w-4 h-4" /> Go to Home
          </Button>
        </div>
      </div>
    </div>
  );
}
