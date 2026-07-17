import { useAuth } from 'zite-auth-sdk';
import { Leaf, ArrowRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
export default function BvslEntryPage() {
  const { loginWithRedirect } = useAuth();

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <div className="w-full max-w-xs text-center space-y-8">
        <div className="space-y-2">
          <div className="flex items-center justify-center mb-3">
            <div className="w-14 h-14 rounded-full bg-primary/10 flex items-center justify-center">
              <Leaf className="w-7 h-7 text-primary" />
            </div>
          </div>
          <h1 className="text-2xl font-bold">BVSL Dashboard</h1>
          <p className="text-sm text-muted-foreground">
            Bhakti Vriksha Servant Leader Portal
          </p>
        </div>

        <div className="space-y-3">
          <Button
            className="w-full"
            size="lg"
            onClick={() => loginWithRedirect({ redirectUrl: `${window.location.origin}/bvsl/dashboard` })}
          >
            Sign in to BVSL Dashboard
            <ArrowRight className="w-4 h-4 ml-2" />
          </Button>
          <p className="text-xs text-muted-foreground">
            Use the email your guide assigned BVSL access to.
          </p>
        </div>

        <a href="/" className="text-xs text-muted-foreground underline hover:text-foreground">
          Not a BVSL? Go to main app
        </a>
      </div>
    </div>
  );
}
