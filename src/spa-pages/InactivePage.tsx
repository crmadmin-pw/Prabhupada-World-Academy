import { useAuth } from 'zite-auth-sdk';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { UserX } from 'lucide-react';

export default function InactivePage() {
  const { logout } = useAuth();

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <Card className="w-full max-w-md text-center shadow-lg">
        <CardHeader className="pb-4">
          <div className="flex justify-center mb-4">
            <div className="w-16 h-16 rounded-full bg-muted flex items-center justify-center">
              <UserX className="w-8 h-8 text-muted-foreground" />
            </div>
          </div>
          <CardTitle className="text-xl">Account Deactivated</CardTitle>
          <CardDescription className="text-base mt-2">
            Your account has been temporarily deactivated by your guide.
            <br />
            Please contact your FOLK guide for assistance.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button
            variant="outline"
            onClick={() => logout({ returnTo: window.location.origin })}
            className="w-full"
          >
            Sign Out
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
