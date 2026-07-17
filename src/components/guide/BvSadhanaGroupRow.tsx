import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ChevronDown, ChevronRight, MessageCircle, CheckCircle2, XCircle, Flame } from 'lucide-react';
import { format } from 'date-fns';
type Group = { groupId: string; groupDbId: string; groupName: string; bvslName: string; bvslPhone: string; memberCount: number; filledCount: number; pendingCount: number; fillPercent: number; weeklyAvgPercent: number; members: { userId: string; fullName: string; filledToday: boolean; currentStreak: number; lastFilledDate: string | null }[] };

interface Props { group: Group; targetDate: string; }

function fillColor(pct: number) {
  if (pct >= 80) return 'text-green-600 font-bold';
  if (pct >= 50) return 'text-yellow-600 font-bold';
  return 'text-destructive font-bold';
}
function fillBg(pct: number) {
  if (pct >= 80) return 'bg-green-50 border-green-200';
  if (pct >= 50) return 'bg-yellow-50 border-yellow-200';
  return 'bg-red-50 border-red-200';
}

export default function BvSadhanaGroupRow({ group, targetDate }: Props) {
  const [expanded, setExpanded] = useState(false);

  const pendingMembers = group.members.filter(m => !m.filledToday);
  const filledMembers = group.members.filter(m => m.filledToday);

  const sendWhatsApp = () => {
    if (!group.bvslPhone) { alert('No phone number for this BVSL'); return; }
    const dateLabel = format(new Date(targetDate + 'T00:00:00'), 'd MMM yyyy');
    const pendingNames = pendingMembers.map(m => m.fullName).join(', ');
    const msg = `🙏 Hare Krishna ${group.bvslName} Prabhuji!\n\nSadhana update for your group *"${group.groupName}"* (${dateLabel}):\n✅ Filled: ${group.filledCount}/${group.memberCount} members\n❌ Pending: ${pendingNames || 'None'}\n\nPlease ensure all members fill their sadhana form today.\n\nHare Krishna! 🙏`;
    const phone = group.bvslPhone.replace(/\D/g, '');
    const dialCode = phone.startsWith('91') ? phone : `91${phone}`;
    window.open(`https://wa.me/${dialCode}?text=${encodeURIComponent(msg)}`, '_blank');
  };

  return (
    <>
      <tr className={`border-b cursor-pointer hover:bg-muted/20 ${fillBg(group.fillPercent)}`} onClick={() => setExpanded(e => !e)}>
        <td className="py-2 px-3 text-sm">
          <div className="flex items-center gap-1.5">
            {expanded ? <ChevronDown className="w-3.5 h-3.5 text-muted-foreground shrink-0" /> : <ChevronRight className="w-3.5 h-3.5 text-muted-foreground shrink-0" />}
            <span className="font-medium">{group.groupName}</span>
          </div>
        </td>
        <td className="py-2 px-3 text-sm text-muted-foreground whitespace-nowrap">{group.bvslName || '—'}</td>
        <td className="py-2 px-3 text-sm text-center">{group.memberCount}</td>
        <td className="py-2 px-3 text-sm text-center text-green-600 font-medium">{group.filledCount}</td>
        <td className="py-2 px-3 text-sm text-center text-destructive font-medium">{group.pendingCount}</td>
        <td className={`py-2 px-3 text-sm text-center ${fillColor(group.fillPercent)}`}>{group.fillPercent}%</td>
        <td className={`py-2 px-3 text-sm text-center ${fillColor(group.weeklyAvgPercent)}`}>{group.weeklyAvgPercent}%</td>
        <td className="py-2 px-3 text-center" onClick={e => e.stopPropagation()}>
          {group.bvslPhone && group.pendingCount > 0 && (
            <Button size="sm" variant="outline" className="h-6 text-[10px] gap-1 border-green-500 text-green-700 hover:bg-green-50" onClick={sendWhatsApp}>
              <MessageCircle className="w-3 h-3" />Nudge
            </Button>
          )}
        </td>
      </tr>
      {expanded && (
        <tr className="bg-muted/10">
          <td colSpan={8} className="px-4 py-2">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-1">
              {filledMembers.map(m => (
                <div key={m.userId} className="flex items-center gap-2 text-xs py-0.5">
                  <CheckCircle2 className="w-3.5 h-3.5 text-green-500 shrink-0" />
                  <span className="font-medium">{m.fullName}</span>
                  {m.currentStreak > 0 && <span className="flex items-center gap-0.5 text-orange-500"><Flame className="w-3 h-3" />{m.currentStreak}d</span>}
                </div>
              ))}
              {pendingMembers.map(m => (
                <div key={m.userId} className="flex items-center gap-2 text-xs py-0.5">
                  <XCircle className="w-3.5 h-3.5 text-destructive shrink-0" />
                  <span className="font-medium text-muted-foreground">{m.fullName}</span>
                  {m.lastFilledDate && <span className="text-muted-foreground/70">last: {format(new Date(m.lastFilledDate + 'T00:00:00'), 'd MMM')}</span>}
                  {!m.lastFilledDate && <Badge variant="outline" className="text-[9px] py-0 text-destructive border-destructive/30">Never filled</Badge>}
                </div>
              ))}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}
