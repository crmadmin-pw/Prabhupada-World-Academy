import { useReactiveLoader } from '@/hooks/useReactiveLoader';
import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Skeleton } from '@/components/ui/skeleton';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Shield, UserMinus, UserPlus, BarChart3, Users, Search } from 'lucide-react';
import { toast } from 'sonner';
import { getAllBvGroupsAdmin, getGuideUsers, tagUserAsBvsl } from '@/lib/endpoints-sdk';
import type { GetAllBvGroupsAdminOutputType, GetGuideUsersOutputType } from '@/lib/endpoints-sdk';
import BvAdminDataTable from '@/components/bv/BvAdminDataTable';
import BvGroupManagerPanel from './BvGroupManagerPanel';

import { useUserProfile } from '@/contexts/UserProfileContext';
import { organizationalDepartment } from '@/lib/directoryDepartment';

interface Props { guideId: string; }
type BvslInfo = GetAllBvGroupsAdminOutputType['bvsls'][0];
type GuideUser = GetGuideUsersOutputType['users'][0];

export default function BvslManagementTab({ guideId }: Props) {
  const { profile } = useUserProfile();
  const isPwAdmin = organizationalDepartment(profile) === 'PW';

  const [bvsls, setBvsls] = useState<BvslInfo[]>([]);
  const [guideUsers, setGuideUsers] = useState<GuideUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [tagging, setTagging] = useState<string | null>(null);
  const [search, setSearch] = useState('');

  useEffect(() => { loadBvslData(); }, [guideId]);

  const loadBvslData = useReactiveLoader(async (read) => {
    !read.background && !read.cancelled && setLoading(true);
    try {
      const [adminRes, usersRes] = await Promise.all([
        read(() => getAllBvGroupsAdmin({ guideId })),
        read(() => getGuideUsers({ guideId, statusFilter: 'active', residencyFilter: 'all' })),
      ]);
      !read.cancelled && setBvsls(adminRes.bvsls);
      !read.cancelled && setGuideUsers(usersRes.users);
    } catch {
      if (read.cancelled) return; toast.error('Failed to load RGF data'); }
    finally { !read.cancelled && setLoading(false); }
  }, []);

  const handleTag = async (userId: string, action: 'tag' | 'untag', name: string) => {
    setTagging(userId);
    try {
      await tagUserAsBvsl({ userId, action });
      toast.success(action === 'tag' ? `${name} tagged as RGF` : `${name} removed as RGF`);
      loadBvslData();
    } catch { toast.error('Failed to update role'); }
    finally { setTagging(null); }
  };

  // Both sides now use DB UUID (u.id from getGuideUsers = userId, b.userId from getAllBvGroupsAdmin = u.id)
  const bvslIds = new Set(bvsls.map(b => b.userId));
  const eligibleUsers = guideUsers.filter(u => {
    const department = organizationalDepartment(u);
    const matchesSegment = isPwAdmin ? department === 'PW' : department !== 'PW';
    return u.status === 'ACTIVE' && matchesSegment && !bvslIds.has(u.userId);
  });

  const filteredEligible = search.trim()
    ? eligibleUsers.filter(u => u.fullName.toLowerCase().includes(search.toLowerCase()))
    : eligibleUsers;

  if (loading) return <div className="space-y-3"><Skeleton className="h-24" /><Skeleton className="h-64" /></div>;

  return (
    <Tabs defaultValue="bvsls">
      <TabsList className="mb-4 w-full sm:w-auto flex">
        <TabsTrigger value="bvsls" className="flex-1 sm:flex-none"><Shield className="w-4 h-4 mr-1 hidden sm:inline" />RGFs ({bvsls.length})</TabsTrigger>
        <TabsTrigger value="groups" className="flex-1 sm:flex-none"><Users className="w-4 h-4 mr-1 hidden sm:inline" />Groups & Members</TabsTrigger>
        <TabsTrigger value="data" className="flex-1 sm:flex-none"><BarChart3 className="w-4 h-4 mr-1 hidden sm:inline" />Data Table</TabsTrigger>
      </TabsList>

      <TabsContent value="bvsls" className="space-y-4">
        <Card className="border-primary/20 bg-primary/5">
          <CardContent className="pt-4 pb-3">
            <p className="text-sm text-muted-foreground">
              Tag a student as RGF to give them access to the RGF dashboard. Then use <strong>Groups & Members</strong> to create their group and assign members directly — no invite link sharing needed!
            </p>
          </CardContent>
        </Card>

        {eligibleUsers.length > 0 && (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Tag User as RGF</CardTitle>
            </CardHeader>
            <CardContent className="pt-0 space-y-3">
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
                <Input
                  placeholder="Search by name…"
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  className="pl-8 h-8 text-sm"
                />
              </div>
              <div className="max-h-72 overflow-y-auto space-y-2">
                {filteredEligible.length === 0 ? (
                  <p className="text-sm text-muted-foreground text-center py-4">No users match your search</p>
                ) : (
                  filteredEligible.map(u => (
                    <div key={u.userId} className="flex items-center justify-between">
                      <div>
                        <p className="text-sm font-medium">{u.fullName}</p>
                        <p className="text-xs text-muted-foreground">{u.ashrayLevel || u.email}</p>
                      </div>
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button size="sm" variant="outline" disabled={tagging === u.userId}>
                            <UserPlus className="w-3.5 h-3.5 mr-1" />Tag RGF
                          </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>Tag as RGF?</AlertDialogTitle>
                            <AlertDialogDescription>{u.fullName} will get access to the RGF dashboard. You can then create a group for them in the "Groups & Members" tab.</AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>Cancel</AlertDialogCancel>
                            <AlertDialogAction onClick={() => handleTag(u.userId, 'tag', u.fullName)}>Confirm</AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    </div>
                  ))
                )}
              </div>
            </CardContent>
          </Card>
        )}

        {bvsls.length === 0 ? (
          <Card><CardContent className="py-10 text-center text-muted-foreground">
            <Shield className="w-8 h-8 mx-auto mb-2 opacity-40" />
            <p>No RGFs tagged yet</p>
          </CardContent></Card>
        ) : (
          <div className="space-y-3">
            {bvsls.map(b => (
              <Card key={b.userId}>
                <CardContent className="pt-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="font-medium flex items-center gap-2">
                        {b.fullName}<Badge className="bg-purple-500 text-xs">RGF</Badge>
                      </p>
                      <p className="text-sm text-muted-foreground">{b.groupCount} group{b.groupCount !== 1 ? 's' : ''} · {b.totalMembers} members</p>
                    </div>
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button size="sm" variant="outline" className="text-destructive" disabled={tagging === b.userId}>
                          <UserMinus className="w-3.5 h-3.5 mr-1" />Remove
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>Remove RGF role?</AlertDialogTitle>
                          <AlertDialogDescription>{b.fullName} will lose access to the RGF dashboard. Their groups and members will remain.</AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>Cancel</AlertDialogCancel>
                          <AlertDialogAction className="bg-destructive" onClick={() => handleTag(b.userId, 'untag', b.fullName)}>Remove</AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </TabsContent>

      <TabsContent value="groups">
        <BvGroupManagerPanel guideId={guideId} />
      </TabsContent>

      <TabsContent value="data">
        <BvAdminDataTable guideId={guideId} />
      </TabsContent>
    </Tabs>
  );
}
