import React, { useState } from 'react';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet';
import { useAuth } from '@/lib/auth-sdk';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Menu, LogOut, User, BookOpen, Users, Award, Network, ShieldAlert } from 'lucide-react';
import { useUserProfile } from '../contexts/UserProfileContext';
import TransferNoticeModal from '@/components/TransferNoticeModal';
import { useMeetingReminderScheduler } from '@/hooks/useMeetingReminderScheduler';
import { getDepartmentLandingUrl, getUserDashboardPath, isManagementProfile } from '@/lib/userDashboardRoutes';

const FOLK_LOGO = 'https://images.fillout.com/orgid-615562/flowpublicid-u91plgmzcu/widgetid-default/q1fJEkENG5kbvfjYaFbDeT/pasted-image-1773145742081.png';

interface DashboardLayoutProps {
  hasBottomNavigation?: boolean;
  title: string;
  subtitle?: string;
  role?: string;
  headerActions?: React.ReactNode;
  children: React.ReactNode;
  maxWidth?: string;
  showProfile?: boolean;
  meetingDepartment?: 'FOLK' | 'PW';
}

export default function DashboardLayout({
  title,
  hasBottomNavigation = false,
  subtitle,
  role,
  headerActions,
  children,
  maxWidth = 'max-w-7xl',
  showProfile = true,
  meetingDepartment,
}: DashboardLayoutProps) {
  const { logout } = useAuth();
  const [accountOpen, setAccountOpen] = useState(false);
  const navigate = useNavigate();
  const { profile } = useUserProfile();

  const isFolkUser = profile?.segment === 'FOLK';

  const ROLE_BADGE_LABELS: Record<string, string> = {
    SUPER_ADMIN: isFolkUser ? 'Super Guide' : 'Super Admin', 
    'Super Admin': isFolkUser ? 'Super Guide' : 'Super Admin',
    ADMIN: isFolkUser ? 'Guide' : 'Admin', 
    'Admin': isFolkUser ? 'Guide' : 'Admin',
    SUPER_GUIDE: 'Super Guide', 
    'Super Guide': 'Super Guide',
    GUIDE: 'Guide', 
    'Guide': 'Guide',
    SUPERVISOR: 'Supervisor', 'Supervisor': 'Supervisor', 'BV_SUPERVISOR': 'Supervisor',
    BV_MENTOR: 'BV Mentor', 'BV Mentor': 'BV Mentor', 'BB_MENTOR': 'BV Mentor', 'BB Mentor': 'BV Mentor',
    BVSL: 'RGF',
    RGF: 'RGF',
    RGSF: 'RGSF',
    SADHANA_MENTOR: 'Sadhana Mentor', 'Sadhana Mentor': 'Sadhana Mentor',
    USER: 'User', 'User': 'User',
  };

  const currentPath = typeof window !== 'undefined' ? window.location.pathname : '';
  const tabItems: Array<{ label: string; path: string; active: boolean; icon: React.ReactNode }> = [];


  const isSuperAdminUser = !!(
    role === 'SUPER_ADMIN' ||
    profile?.isBvSuperAdmin ||
    profile?.role === 'SUPER_ADMIN' ||
    profile?.role === 'SUPER_GUIDE'
  );
  const canManageMeetings = !!(
    profile?.isBvSuperAdmin ||
    profile?.isBvAdmin ||
    profile?.role === 'SUPER_ADMIN' ||
    profile?.role === 'SUPER_GUIDE' ||
    (profile?.role as string) === 'ADMIN'
  );
  const resolvedMeetingDepartment = meetingDepartment || (isFolkUser ? 'FOLK' : 'PW');
  useMeetingReminderScheduler(resolvedMeetingDepartment, canManageMeetings && resolvedMeetingDepartment === 'PW');

  const effectiveRole = isSuperAdminUser ? 'SUPER_ADMIN' : (role || profile?.role);
  const showRoleBadge = !!(effectiveRole && ROLE_BADGE_LABELS[effectiveRole]);

  if (profile) {
    const isBvAdmin = isManagementProfile(profile) || !!(
      profile?.isBvSuperAdmin ||
      profile?.isBvAdmin ||
      (profile?.role as string) === 'ADMIN' ||
      (profile?.role as string) === 'SUPER_ADMIN' ||
      isSuperAdminUser
    );

    const isFolkUser = profile.segment === 'FOLK';
    const adminPath = isFolkUser ? '/folk-guide/dashboard' : '/pw-admin/dashboard';

    // 1. Admin / Super Admin Dashboard
    if (isBvAdmin) {
      if (profile?.role === 'SUPER_GUIDE' && isFolkUser) {
        const queryParams = typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : new URLSearchParams();
        const isGuideMode = queryParams.get('mode') === 'guide';
        
        tabItems.push({
          label: 'FOLK Super Guide',
          path: '/folk-guide/dashboard',
          active: currentPath.startsWith('/folk-guide') && !isGuideMode,
          icon: <ShieldAlert className="w-4 h-4 mr-1 md:mr-1.5" />,
        });
        
        tabItems.push({
          label: 'FOLK Guide',
          path: '/folk-guide/dashboard?mode=guide',
          active: currentPath.startsWith('/folk-guide') && isGuideMode,
          icon: <ShieldAlert className="w-4 h-4 mr-1 md:mr-1.5" />,
        });
      } else {
        const isAdminActive = currentPath.startsWith('/pw-admin') || currentPath.startsWith('/folk-guide') || currentPath.startsWith('/super-admin');
        tabItems.push({
          label: isSuperAdminUser ? (isFolkUser ? 'FOLK Super Guide' : 'PW Super Admin') : (isFolkUser ? 'FOLK Guide' : 'PW Admin'),
          path: adminPath,
          active: isAdminActive,
          icon: <ShieldAlert className="w-4 h-4 mr-1 md:mr-1.5" />,
        });
      }
    }

    // 2. BV Supervisor Dashboard — ONLY visible for explicitly assigned Supervisors/Mentors
    if (profile.isBvSupervisor || profile.isBvMentor) {
      const isBvSupervisorActive = currentPath.startsWith('/bv-supervisor') || currentPath.startsWith('/supervisor');
      tabItems.push({
        label: 'Supervisor',
        path: '/bv-supervisor/dashboard',
        active: isBvSupervisorActive,
        icon: <Network className="w-4 h-4 mr-1 md:mr-1.5" />,
      });
    }

    // 3. RGF Dashboard — visible if assigned Facilitator/RGF
    if (profile.isBvFacilitator || profile.isBvsl) {
      const isBvslActive = currentPath.startsWith('/bvsl') || currentPath.startsWith('/rgf');
      tabItems.push({
        label: 'RGF',
        path: '/bvsl/dashboard',
        active: isBvslActive,
        icon: <Users className="w-4 h-4 mr-1 md:mr-1.5" />,
      });
    }

    // 4. RGSF Dashboard — visible if assigned Sub-Facilitator/RGSF
    if (profile.isBvSubFacilitator) {
      const isRgsfActive = currentPath.startsWith('/rgsf') || (currentPath.startsWith('/bvsl') && window.location.search.includes('mode=rgsf'));
      tabItems.push({
        label: 'RGSF',
        // Use the dedicated RGSF route.  The BVSL route is the RGF dashboard
        // and does not switch dashboards based on a query-string mode.
        path: '/rgsf/dashboard',
        active: isRgsfActive,
        icon: <Users className="w-4 h-4 mr-1 md:mr-1.5" />,
      });
    }

    // 4. Sadhana Mentor Dashboard (if applicable)
    if (profile.isSadhanaMentor || (role as string) === 'SADHANA_MENTOR') {
      const isSadhanaMentorActive = currentPath.startsWith('/mentor');
      tabItems.push({
        label: 'Sadhana Mentor',
        path: '/mentor/dashboard',
        active: isSadhanaMentorActive,
        icon: <Award className="w-4 h-4 mr-1 md:mr-1.5" />,
      });
    }

    // 5. My Sadhana (Placed just before Profile & Logout) — Only for regular members/users who fill sadhana
    if (!isManagementProfile(profile) && !isSuperAdminUser) {
      const personalDashboardPath = getUserDashboardPath(profile);
      const isMySadhanaActive = [personalDashboardPath, '/sadhana', '/history', '/bhaktivriksha'].includes(currentPath);
      tabItems.push({
        label: 'My Sadhana',
        path: personalDashboardPath,
        active: isMySadhanaActive,
        icon: <BookOpen className="w-4 h-4 mr-1 md:mr-1.5" />,
      });
    }
  }
  return (
    <div className={`dashboard-shell bg-background ${hasBottomNavigation ? "dashboard-with-bottom-nav" : ""}`}>
      <TransferNoticeModal />
      <header className="dashboard-header border-b bg-card sticky top-0 z-40 no-print">
        <div className="mx-auto px-3 py-2 md:px-6 md:py-3">
          <div className="flex justify-between items-center">
            <div className="flex items-center gap-2.5 flex-1 min-w-0">
              <img src={FOLK_LOGO} alt="FOLK" className="w-9 h-9 object-contain shrink-0" />
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <h1 className="text-sm md:text-lg font-bold text-primary leading-tight line-clamp-2">{title}</h1>
                  {showRoleBadge && (
                    <span className="text-xs px-2 py-0.5 rounded-full bg-muted text-muted-foreground border border-border font-medium shrink-0">
                      {ROLE_BADGE_LABELS[effectiveRole!]}
                    </span>
                  )}
                </div>
                {subtitle && <p className="text-xs text-muted-foreground truncate mt-0.5">{subtitle}</p>}
              </div>
            </div>
            <div className="hidden md:flex items-center gap-1 shrink-0 flex-wrap">
              {headerActions}
              {tabItems.map((item) => (
                <Button
                  key={item.path}
                  aria-label={item.label}
                  variant={item.active ? "default" : "ghost"}
                  size="sm"
                  onClick={() => navigate(item.path)}
                  className="font-medium shrink-0"
                >
                  {item.icon}
                  <span className="hidden sm:inline">{item.label}</span>
                </Button>
              ))}
              {showProfile && (
                <Button
                  variant={currentPath === '/profile' ? "default" : "ghost"}
                  size="sm"
                  onClick={() => navigate('/profile')}
                  className="font-medium shrink-0"
                >
                  <User className="w-4 h-4 mr-1 md:mr-1.5" />
                  <span className="hidden md:inline">Profile</span>
                </Button>
              )}
              <Button variant="ghost" size="sm" onClick={() => logout({ returnTo: getDepartmentLandingUrl(profile) })} className="shrink-0">
                <LogOut className="w-4 h-4 mr-1 md:mr-1.5" />
                <span className="hidden md:inline">Logout</span>
              </Button>
            </div>
            <Sheet open={accountOpen} onOpenChange={setAccountOpen}>
              <Button variant="ghost" size="icon" className="ml-2 md:hidden" aria-label="Open account menu" onClick={() => setAccountOpen(true)}><Menu className="size-5" /></Button>
              <SheetContent side="right" className="w-[min(88vw,360px)] gap-0">
                <SheetHeader className="border-b px-5 py-6 pr-14"><SheetTitle>My account</SheetTitle><SheetDescription className="break-words">{profile?.fullName || title}</SheetDescription></SheetHeader>
                <nav aria-label="Account and dashboards" className="space-y-2 overflow-y-auto p-4">
                  {headerActions && <div className="flex flex-wrap gap-2">{headerActions}</div>}
                  {tabItems.map(item => <Button key={item.path} variant={item.active ? 'secondary' : 'ghost'} className="w-full justify-start whitespace-normal text-left" onClick={() => { navigate(item.path); setAccountOpen(false); }}>{item.icon}{item.label}</Button>)}
                  {showProfile && <Button variant="ghost" className="w-full justify-start" onClick={() => { navigate('/profile'); setAccountOpen(false); }}><User className="size-4" />Profile</Button>}
                  <Button variant="ghost" className="w-full justify-start" onClick={() => logout({ returnTo: getDepartmentLandingUrl(profile) })}><LogOut className="size-4" />Logout</Button>
                </nav>
              </SheetContent>
            </Sheet>
          </div>
        </div>
      </header>
      <main className={`dashboard-main mx-auto ${maxWidth}`}>
        {children}
      </main>
    </div>
  );
}
