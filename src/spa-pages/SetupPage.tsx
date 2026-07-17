import { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { CheckCircle2, UserPlus, FlaskConical, Database, Loader2, Users } from 'lucide-react';
import { seedData, seedUsers } from 'zite-endpoints-sdk';
import { toast } from 'sonner';

export default function SetupPage() {
  const [seeding, setSeeding] = useState(false);
  const [seeded, setSeeded] = useState(false);
  const [seedingUsers, setSeedingUsers] = useState(false);
  const [usersSeeded, setUsersSeeded] = useState(false);

  const handleSeedUsers = async () => {
    setSeedingUsers(true);
    try {
      const result = await seedUsers({ confirm: 'SEED_USERS' });
      toast.success(result.status);
      setUsersSeeded(true);
    } catch (e: any) {
      toast.error('Seeding users failed: ' + e.message);
    } finally {
      setSeedingUsers(false);
    }
  };

  const handleSeedData = async () => {
    setSeeding(true);
    try {
      const result = await seedData({ confirm: 'SEED_REAL_DATA' });
      toast.success(`${result.status} — ${result.levelsCreated} ashray levels + ${result.configCreated} config entries loaded.`);
      setSeeded(true);
    } catch (e: any) {
      toast.error('Seeding failed: ' + e.message);
    } finally {
      setSeeding(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-background to-secondary p-4">
      <div className="container mx-auto max-w-4xl py-8">
        <h1 className="text-4xl font-bold mb-2 text-primary">FOLK Sadhana Tracker Setup</h1>
        <p className="text-muted-foreground mb-8">
          Complete these steps to set up your sadhana tracking system
        </p>

        <div className="space-y-6">
          {/* Step 0: Seed Data */}
          <Card className={seeded ? 'border-green-500' : ''}>
            <CardHeader>
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-full bg-primary text-primary-foreground flex items-center justify-center font-bold">0</div>
                <CardTitle>Seed Config &amp; Ashray Levels Data</CardTitle>
              </div>
              <CardDescription>Populate Config and AshrayLevels tables with the real FOLK data</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-start gap-3 p-4 bg-muted rounded-lg">
                <Database className="h-5 w-5 text-primary mt-0.5 shrink-0" />
                <div className="text-sm space-y-1">
                  <p>This will delete any placeholder/dummy records in the <strong>AshrayLevels</strong> and <strong>Config</strong> tables and populate them with the correct FOLK data:</p>
                  <ul className="list-disc list-inside mt-2 space-y-1 text-muted-foreground">
                    <li>7 Ashray levels: Jigyasa → Harinam Diksha (with full requirements)</li>
                    <li>Config: Next Ashray Exam date + WhatsApp reminder template</li>
                  </ul>
                </div>
              </div>
              {seeded ? (
                <div className="flex items-center gap-2 text-green-600 font-medium">
                  <CheckCircle2 className="h-5 w-5" /> Data seeded successfully!
                </div>
              ) : (
                <Button onClick={handleSeedData} disabled={seeding}>
                  {seeding ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Seeding...</> : 'Seed Real Data'}
                </Button>
              )}
            </CardContent>
          </Card>

          {/* Step 0b: Seed Users */}
          <Card className={usersSeeded ? 'border-green-500' : ''}>
            <CardHeader>
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-full bg-primary text-primary-foreground flex items-center justify-center font-bold">0b</div>
                <CardTitle>Seed Users Data</CardTitle>
              </div>
              <CardDescription>Populate the Users table with all 52 real users from the PDF</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-start gap-3 p-4 bg-muted rounded-lg">
                <Users className="h-5 w-5 text-primary mt-0.5 shrink-0" />
                <div className="text-sm space-y-1">
                  <p>This will upsert all users from the PDF into the <strong>Users</strong> table (matched by userId). Includes:</p>
                  <ul className="list-disc list-inside mt-2 space-y-1 text-muted-foreground">
                    <li>52 users: Guides, BVSLs, Sadhana Mentors, and regular Users</li>
                    <li>Ashray levels, residency status, roles, and status fields</li>
                    <li>Existing records are updated (not duplicated)</li>
                  </ul>
                </div>
              </div>
              {usersSeeded ? (
                <div className="flex items-center gap-2 text-green-600 font-medium">
                  <CheckCircle2 className="h-5 w-5" /> Users seeded successfully!
                </div>
              ) : (
                <Button onClick={handleSeedUsers} disabled={seedingUsers}>
                  {seedingUsers ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Seeding Users...</> : 'Seed Users Data'}
                </Button>
              )}
            </CardContent>
          </Card>

          {/* Step 1 */}
          <Card>
            <CardHeader>
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-full bg-primary text-primary-foreground flex items-center justify-center font-bold">1</div>
                <CardTitle>Add Guides via the Database</CardTitle>
              </div>
              <CardDescription>Add FOLK Guides directly in the connected Zite database</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-start gap-3 p-4 bg-muted rounded-lg">
                <UserPlus className="h-5 w-5 text-primary mt-0.5 shrink-0" />
                <div className="text-sm space-y-1">
                  <p>Open the <strong>Guides</strong> table in your Zite database and add rows with the following fields:</p>
                  <div className="grid grid-cols-2 gap-2 mt-3 font-mono">
                    <div className="font-bold">Field</div><div className="font-bold">Example Value</div>
                    <div>full_name</div><div>Prabhu Name</div>
                    <div>email</div><div>guide@folk.com</div>
                    <div>phone</div><div>9876543210</div>
                    <div>role</div><div>guide</div>
                    <div>is_active</div><div>TRUE</div>
                  </div>
                  <p className="mt-2 text-muted-foreground">
                    For Super Guides, set role to <code className="bg-background px-1 rounded">super_guide</code>
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Step 2 */}
          <Card>
            <CardHeader>
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-full bg-primary text-primary-foreground flex items-center justify-center font-bold">2</div>
                <CardTitle>Configure Sadhana Fields</CardTitle>
              </div>
              <CardDescription>Sadhana fields are loaded from the database automatically</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-start gap-3 p-4 bg-muted rounded-lg">
                <CheckCircle2 className="h-5 w-5 text-primary mt-0.5 shrink-0" />
                <p className="text-sm">
                  The <strong>SadhanaFields</strong> table contains all form fields (MA/NA, Rounds, SP Reading, etc.).
                  These are already set up. Guides can configure them via the Guide Dashboard → Field Setup page.
                </p>
              </div>
            </CardContent>
          </Card>

          {/* Step 3 */}
          <Card>
            <CardHeader>
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-full bg-primary text-primary-foreground flex items-center justify-center font-bold">3</div>
                <CardTitle>Test User Registration</CardTitle>
              </div>
              <CardDescription>Register a test user to verify the flow</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-start gap-3 p-4 bg-muted rounded-lg">
                <FlaskConical className="h-5 w-5 text-primary mt-0.5 shrink-0" />
                <ol className="list-decimal list-inside space-y-2 text-sm">
                  <li>Go to the registration page and fill in user details</li>
                  <li>User will be in <strong>pending</strong> status</li>
                  <li>Guide approves from the Guide Dashboard → Approvals tab</li>
                  <li>User can now log in and submit sadhana</li>
                </ol>
              </div>
              <Button variant="outline" onClick={() => window.location.href = '/register'}>
                Go to Registration
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
