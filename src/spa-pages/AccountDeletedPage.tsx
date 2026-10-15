import { useAuth } from '@/lib/auth-sdk';
import { ACCOUNT_DELETED_LOGIN_MESSAGE } from '@/lib/accountDeletionPolicy';
import { getDepartmentLandingUrl } from '@/lib/userDashboardRoutes';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { UserX } from 'lucide-react';

export default function AccountDeletedPage() {
  const { user, logout } = useAuth();

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <Card className="w-full max-w-md text-center shadow-lg">
        <CardHeader className="pb-4">
          <div className="flex justify-center mb-4">
            <div className="w-16 h-16 rounded-full bg-muted flex items-center justify-center">
              <UserX className="w-8 h-8 text-muted-foreground" />
            </div>
          </div>
          <CardTitle className="text-xl">Account Deleted</CardTitle>
          <CardDescription className="text-base mt-2">
            {ACCOUNT_DELETED_LOGIN_MESSAGE}
          </CardDescription>
        </CardHeader>
        {user && (
          <CardContent>
            <Button
              variant="outline"
              onClick={() => logout({ returnTo: getDepartmentLandingUrl() })}
              className="w-full"
            >
              Sign Out
            </Button>
          </CardContent>
        )}
      </Card>
    </div>
  );
}
