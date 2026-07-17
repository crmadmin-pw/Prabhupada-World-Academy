import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Input } from '@/components/ui/input';
import { Search } from 'lucide-react';
import { toast } from 'sonner';
import { getGuides, getGuideUsers } from 'zite-endpoints-sdk';
import type { GetGuidesOutputType } from 'zite-endpoints-sdk';

type GuideEntry = GetGuidesOutputType['guides'][0] & { userCount: number };

export default function SuperGuidesPanel() {
  const [guides, setGuides] = useState<GuideEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');

  useEffect(() => {
    const load = async () => {
      try {
        const { guides: list } = await getGuides({});
        const counts = await Promise.all(
          list.map(g =>
            getGuideUsers({ guideId: g.guideId, statusFilter: 'active' })
              .then(r => r.users.length).catch(() => 0)
          )
        );
        setGuides(list.map((g, i) => ({ ...g, userCount: counts[i] })));
      } catch { toast.error('Failed to load guides'); }
      finally { setLoading(false); }
    };
    load();
  }, []);

  const filtered = guides.filter(g =>
    !search || g.name.toLowerCase().includes(search.toLowerCase()) || (g.email ?? '').toLowerCase().includes(search.toLowerCase())
  );

  if (loading) return <div className="space-y-2">{[...Array(6)].map((_, i) => <Skeleton key={i} className="h-10" />)}</div>;

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <CardTitle className="text-base">All Guides ({guides.length})</CardTitle>
          <div className="relative w-56">
            <Search className="absolute left-2.5 top-2.5 w-4 h-4 text-muted-foreground" />
            <Input placeholder="Search guides..." className="pl-8 h-9" value={search} onChange={e => setSearch(e.target.value)} />
          </div>
        </div>
      </CardHeader>
      <CardContent className="p-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-10">#</TableHead>
              <TableHead>Name</TableHead>
              <TableHead>Email</TableHead>
              <TableHead className="text-center">Active Users</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.map((g, i) => (
              <TableRow key={g.guideId}>
                <TableCell className="text-muted-foreground text-xs">{i + 1}</TableCell>
                <TableCell className="font-medium">{g.name}</TableCell>
                <TableCell className="text-sm text-muted-foreground">{g.email}</TableCell>
                <TableCell className="text-center">
                  <Badge variant="secondary">{g.userCount}</Badge>
                </TableCell>
              </TableRow>
            ))}
            {filtered.length === 0 && (
              <TableRow><TableCell colSpan={4} className="text-center py-8 text-muted-foreground">No guides found</TableCell></TableRow>
            )}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
