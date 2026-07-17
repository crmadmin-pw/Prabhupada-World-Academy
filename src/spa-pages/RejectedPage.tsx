import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { XCircle } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

export default function RejectedPage() {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen bg-gradient-to-b from-background to-secondary flex items-center justify-center p-4">
      <Card className="w-full max-w-md text-center">
        <CardHeader>
          <div className="flex justify-center mb-4">
            <XCircle className="w-16 h-16 text-destructive" />
          </div>
          <CardTitle className="text-2xl">Registration Rejected</CardTitle>
          <CardDescription>
            Your registration request has been rejected by your FOLK Guide
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-muted-foreground">
            Please contact your guide directly for more information or to discuss reapplying.
          </p>

          <Button variant="outline" className="w-full" onClick={() => navigate('/')}>
            Return to Home
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
