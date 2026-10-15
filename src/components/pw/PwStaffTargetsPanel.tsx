import { useEffect, useState } from 'react';
import { listPwStaffTargets } from '@/lib/endpoints-sdk';
import PwTargetEditor from '@/components/pw/PwTargetEditor';
import { toast } from 'sonner';

export default function PwStaffTargetsPanel() {
  const [members, setMembers] = useState<Array<{ userId: string; fullName: string; roleLabel: string; ashrayLevel: string | null; pwTargets: any }>>([]);

  const load = () => {
    listPwStaffTargets({}).then(result => setMembers(result.members || [])).catch(() => toast.error('Could not load RGF and supervisor targets'));
  };

  useEffect(() => { load(); }, []);

  return (
    <div className="space-y-3">
      <div>
        <h3 className="font-semibold">RGF and supervisor targets</h3>
        <p className="text-sm text-muted-foreground">Admins set these. BV members and RGSFs are set by their RGF.</p>
      </div>
      {members.length === 0 ? (
        <p className="text-sm text-muted-foreground">No RGFs or supervisors in your scope.</p>
      ) : (
        <ul className="divide-y rounded-lg border">
          {members.map(member => (
            <li key={member.userId} className="flex items-center justify-between gap-3 p-3">
              <div>
                <p className="font-medium">{member.fullName}</p>
                <p className="text-xs text-muted-foreground">{member.roleLabel}{member.ashrayLevel ? ` · ${member.ashrayLevel}` : ''}</p>
              </div>
              <PwTargetEditor userId={member.userId} fullName={member.fullName} targets={member.pwTargets} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
