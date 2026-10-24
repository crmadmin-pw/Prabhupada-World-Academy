import { MessageCircle } from 'lucide-react';
import { sadhanaWhatsAppLink } from '@/lib/sadhanaWhatsApp';

export default function SadhanaWhatsAppReminder(props: Parameters<typeof sadhanaWhatsAppLink>[0]) {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
  if (props.segment !== 'FOLK' || !props.missingDates.some(date => date <= today)) return null;
  const href = sadhanaWhatsAppLink(props);
  if (!href) return <span className="block text-xs text-muted-foreground">WhatsApp unavailable</span>;
  return (
    <a href={href} target="_blank" rel="noopener noreferrer"
      onClick={event => event.stopPropagation()}
      aria-label={`Remind ${props.fullName} about missing Sadhana on WhatsApp`}
      className="no-print-col inline-flex min-h-9 items-center gap-1 rounded-md px-2 text-xs font-medium text-green-700 hover:bg-green-100 dark:text-green-400 dark:hover:bg-green-950">
      <MessageCircle className="h-3.5 w-3.5" /> WhatsApp
    </a>
  );
}
