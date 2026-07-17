import { useEffect, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { User, Users, Info } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { getFieldsForUser, getGuideGroups, GetFieldsForUserOutputType } from 'zite-endpoints-sdk';

interface FormsTabProps {
  guideId: string;
}

type FieldType = GetFieldsForUserOutputType['fields'][0];

export default function FormsTab({ guideId }: FormsTabProps) {
  const [loading, setLoading] = useState(false);
  const [selectedUserId, setSelectedUserId] = useState<string>('');
  const [fields, setFields] = useState<FieldType[]>([]);
  const [availableUsers, setAvailableUsers] = useState<Array<{ userId: string; fullName: string }>>([]);
  const [templateMode, setTemplateMode] = useState<string>('');

  useEffect(() => { loadUsers(); }, [guideId]);

  const loadUsers = async () => {
    try {
      const result = await getGuideGroups({ guideId });
      const allUsers = new Map<string, { userId: string; fullName: string }>();
      result.groups.forEach(group => {
        group.members.forEach(member => {
          if (member.userId && member.fullName) allUsers.set(member.userId, { userId: member.userId, fullName: member.fullName });
        });
      });
      result.availableUsers.forEach(user => {
        if (user.userId && user.fullName) allUsers.set(user.userId, { userId: user.userId, fullName: user.fullName });
      });
      setAvailableUsers(Array.from(allUsers.values()));
    } catch (error) {
      console.error('Failed to load users:', error);
    }
  };

  const loadFieldsForUser = async (userId: string) => {
    if (!userId) return;
    setLoading(true);
    try {
      const result = await getFieldsForUser({ userId });
      setFields(result.fields);
      setTemplateMode(result.templateMode || '');
    } catch (error) {
      console.error('Failed to load fields:', error);
    } finally {
      setLoading(false);
    }
  };

  const isResident = templateMode.includes('RESIDENT') && !templateMode.includes('NON');

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold">Form Fields</h2>
        <p className="text-muted-foreground">View the sadhana form fields for each user based on their resident/non-resident status</p>
      </div>

      <Alert>
        <Info className="h-4 w-4" />
        <AlertDescription>
          Fields are determined by each user's residency status. Residents see 17 scored fields;
          non-residents see 8 tracking fields. Field definitions are managed in the
          <strong> ResidentFields</strong> and <strong>NonResidentFields</strong> sheets.
        </AlertDescription>
      </Alert>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <User className="w-5 h-5" />
            View User Form Fields
          </CardTitle>
          <CardDescription>Select a user to see which fields they will see in their sadhana form</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <Label htmlFor="userSelect">Select User</Label>
            <Select value={selectedUserId} onValueChange={(userId) => { setSelectedUserId(userId); loadFieldsForUser(userId); }}>
              <SelectTrigger id="userSelect">
                <SelectValue placeholder="Choose a user..." />
              </SelectTrigger>
              <SelectContent>
                {availableUsers.map(user => (
                  <SelectItem key={user.userId} value={user.userId}>{user.fullName}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {selectedUserId && templateMode && (
            <div className="flex items-center gap-2">
              <Badge variant={isResident ? 'default' : 'secondary'}>
                {isResident ? '🏠 Resident' : '🌐 Non-Resident'}
              </Badge>
              <span className="text-sm text-muted-foreground">{fields.length} fields</span>
            </div>
          )}

          {loading && <Skeleton className="h-64" />}

          {!loading && selectedUserId && fields.length > 0 && (
            <div className="border rounded-lg overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>#</TableHead>
                    <TableHead>Field</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead className="text-center">Required</TableHead>
                    <TableHead className="text-center">Scored</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {fields.map((field, i) => (
                    <TableRow key={field.fieldId}>
                      <TableCell className="text-muted-foreground text-sm">{i + 1}</TableCell>
                      <TableCell>
                        <div className="font-medium">{field.fieldLabel}</div>
                        {field.helpText && <div className="text-xs text-muted-foreground">{field.helpText}</div>}
                      </TableCell>
                      <TableCell><Badge variant="outline">{field.fieldType}</Badge></TableCell>
                      <TableCell className="text-center">{field.isRequired ? '✅' : '—'}</TableCell>
                      <TableCell className="text-center">{field.contributesToScore ? '✅' : '—'}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}

          {!loading && !selectedUserId && (
            <div className="text-center py-8 text-muted-foreground">
              <Users className="w-12 h-12 mx-auto mb-2 opacity-50" />
              <p>Select a user to view their form fields</p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
