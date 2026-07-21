import { useAuth } from 'zite-auth-sdk';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { LogOut, User, BookOpen, Users, Award, Network, Compass, ShieldAlert } from 'lucide-react';
import { useUserProfile } from '../contexts/UserProfileContext';

const FOLK_LOGO = 'https://images.fillout.com/orgid-615562/flowpublicid-u91plgmzcu/widgetid-default/q1fJEkENG5kbvfjYaFbDeT/pasted-image-1773145742081.png';

interface DashboardLayoutProps {
  title: string;
  subtitle?: string;
  role?: string;
  headerActions?: React.ReactNode;
  children: React.ReactNode;
  maxWidth?: string;
  showProfile?: boolean;
}

export default function DashboardLayout({
  title,
  subtitle,
  role,
  headerActions,
  children,
  maxWidth = 'max-w-6xl',
  showProfile = true,
}: DashboardLayoutProps) {
  const { logout } = useAuth();
  const navigate = useNavigate();
  const { profile } = useUserProfile();

  const ROLE_BADGE_LABELS: Record<string, string> = {
    GUIDE: 'Guide', 'Guide': 'Guide',
    SUPER_GUIDE: 'Super Guide', 'Super Guide': 'Super Guide',
  };
  const showRoleBadge = !!(role && ROLE_BADGE_LABELS[role]);

  const currentPath = window.location.pathname;
  const tabItems = [];

  if (profile) {
    // 1. My Sadhana (available to all non-guides)
    if (profile.role !== 'GUIDE' && profile.role !== 'SUPER_GUIDE') {
      const isMySadhanaActive = ['/user/dashboard', '/sadhana', '/history', '/bhaktivriksha'].includes(currentPath);
      tabItems.push({
        label: 'My Sadhana',
        path: '/user/dashboard',
        active: isMySadhanaActive,
        icon: <BookOpen className="w-4 h-4 mr-1 md:mr-1.5" />,
      });
    }

    // 2. Sadhana Mentor
    if (profile.isSadhanaMentor) {
      const isSadhanaMentorActive = currentPath.startsWith('/mentor');
      tabItems.push({
        label: 'Sadhana Mentor',
        path: '/mentor/dashboard',
        active: isSadhanaMentorActive,
        icon: <Award className="w-4 h-4 mr-1 md:mr-1.5" />,
      });
    }

    // 3. BVSL Dashboard
    if (profile.isBvsl) {
      const isBvslActive = currentPath.startsWith('/bvsl');
      tabItems.push({
        label: 'BVSL',
        path: '/bvsl/dashboard',
        active: isBvslActive,
        icon: <Users className="w-4 h-4 mr-1 md:mr-1.5" />,
      });
    }

    // 4. BV Mentor
    if (profile.isBvMentor) {
      const isBvMentorActive = currentPath.startsWith('/bv-mentor');
      tabItems.push({
        label: 'BV Mentor',
        path: '/bv-mentor/dashboard',
        active: isBvMentorActive,
        icon: <Network className="w-4 h-4 mr-1 md:mr-1.5" />,
      });
    }

    const isPwAdmin = currentPath.startsWith('/pw-admin') || (profile as any)?.email === 'srilaprabhupadaworld@gmail.com';

    // 5. Guide Dashboard (only for non-PW Admin)
    if (!isPwAdmin && (profile.role === 'GUIDE' || profile.role === 'SUPER_GUIDE')) {
      const isGuideActive = currentPath.startsWith('/guide');
      tabItems.push({
        label: 'Guide',
        path: '/guide/dashboard',
        active: isGuideActive,
        icon: <Compass className="w-4 h-4 mr-1 md:mr-1.5" />,
      });
    }

    // 6. Super Guide Dashboard (only for non-PW Admin)
    if (!isPwAdmin && profile.role === 'SUPER_GUIDE') {
      const isSuperGuideActive = currentPath.startsWith('/super');
      tabItems.push({
        label: 'Super Guide',
        path: '/super/dashboard',
        active: isSuperGuideActive,
        icon: <ShieldAlert className="w-4 h-4 mr-1 md:mr-1.5" />,
      });
    }
  }


  return (
    <div className="min-h-screen bg-background">
      <header className="border-b bg-card sticky top-0 z-50 no-print">
        <div className="container mx-auto px-4 py-3">
          <div className="flex justify-between items-center">
            <div className="flex items-center gap-3 flex-1 min-w-0">
              <img src={FOLK_LOGO} alt="FOLK" className="w-9 h-9 object-contain shrink-0" />
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <h1 className="text-base md:text-lg font-bold text-primary truncate leading-tight">{title}</h1>
                  {showRoleBadge && (
                    <span className="text-xs px-2 py-0.5 rounded-full bg-muted text-muted-foreground border border-border font-medium shrink-0">
                      {ROLE_BADGE_LABELS[role!]}
                    </span>
                  )}
                </div>
                {subtitle && <p className="text-xs text-muted-foreground truncate mt-0.5">{subtitle}</p>}
              </div>
            </div>
            <div className="flex items-center gap-1 shrink-0 flex-wrap">
              {headerActions}
              {tabItems.map((item) => (
                <Button
                  key={item.path}
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
              <Button variant="ghost" size="sm" onClick={() => logout()} className="shrink-0">
                <LogOut className="w-4 h-4 mr-1 md:mr-1.5" />
                <span className="hidden md:inline">Logout</span>
              </Button>
            </div>
          </div>
        </div>
      </header>
      <main className={maxWidth === 'max-w-none' || maxWidth === 'max-w-full' ? `w-full px-4 md:px-8 py-6 md:py-8` : `container mx-auto px-4 py-6 md:py-8 ${maxWidth}`}>
        {children}
      </main>
    </div>
  );
}
