import { useEffect, useState, type RefObject } from 'react';
import { toBlob } from 'html-to-image';
import { MessageCircle, Users } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import SadhanaWhatsAppReminder from './SadhanaWhatsAppReminder';
import { toast } from 'sonner';

const GROUP_MESSAGE = [
  'Hare Krishna, Prabhus! 🙏',
  'Jay Srila Prabhupada',
  '',
  'Just a gentle reminder that some Sadhana entries are still pending, as shown in the attached report.',
  '',
  'Whenever you get a chance, kindly check your pending entries and update them in the application while the submission window is open.',
  '',
  'Please feel free to let me know if you need any help. 😊',
  'Thank you, Prabhus!',
].join('\n');

type Recipient = { id: string; fullName: string; phone?: string | null; segment?: string | null; missingDates: string[] };

export default function MissingSadhanaShareActions({ reportRef, recipients, filename, disabled }: {
  reportRef: RefObject<HTMLDivElement | null>;
  recipients: Recipient[];
  filename: string;
  disabled: boolean;
}) {
  const [individualsOpen, setIndividualsOpen] = useState(false);
  const [preparing, setPreparing] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [image, setImage] = useState<{ file: File; url: string } | null>(null);
  useEffect(() => () => { if (image) URL.revokeObjectURL(image.url); }, [image]);
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
  const pending = recipients.map(person => ({ ...person, missingDates: person.missingDates.filter(date => date <= today) }))
    .filter(person => person.segment === 'FOLK' && person.missingDates.length > 0);

  const prepare = async () => {
    if (!reportRef.current || preparing || disabled) return;
    setPreparing(true);
    // Snapshot the selected view before asynchronous image preparation begins.
    const original = reportRef.current;
    const clone = original.cloneNode(true) as HTMLDivElement;
    const width = Math.max(original.clientWidth, ...Array.from(original.querySelectorAll('table')).map(table => table.scrollWidth + 32));
    Object.assign(clone.style, { position: 'fixed', left: '-100000px', top: '0', width: `${width}px`, maxWidth: 'none', padding: '16px', background: getComputedStyle(original).backgroundColor });
    clone.querySelectorAll('a[href*="wa.me"], .report-scroll-hint').forEach(node => node.remove());
    clone.querySelectorAll<HTMLElement>('[role="region"]').forEach(node => {
      Object.assign(node.style, { overflow: 'visible', maxWidth: 'none', width: '100%' });
    });
    clone.querySelectorAll<HTMLElement>('.sticky').forEach(node => { node.style.position = 'static'; });
    document.body.appendChild(clone);
    try {
      const blob = await toBlob(clone, { pixelRatio: 2, backgroundColor: getComputedStyle(document.body).backgroundColor, style: { position: 'static', left: '0', top: '0' } });
      if (!blob) throw new Error('No image');
      const file = new File([blob], filename, { type: 'image/png' });
      setImage({ file, url: URL.createObjectURL(file) });
    } catch {
      toast.error('Could not create the report image. Try a shorter date range or fewer members.');
    } finally {
      clone.remove();
      setPreparing(false);
    }
  };
  const canShare = !!image && typeof navigator.share === 'function' && typeof navigator.canShare === 'function' &&
    navigator.canShare({ files: [image.file], text: GROUP_MESSAGE });
  const share = async () => {
    if (!image || !canShare || sharing) return;
    setSharing(true);
    try {
      await navigator.share({ files: [image.file], text: GROUP_MESSAGE });
    } catch (error) {
      if ((error as DOMException).name !== 'AbortError') toast.error('Could not start sharing. Download the image and copy the message to WhatsApp.');
    } finally { setSharing(false); }
  };
  return <>
    <Button size="sm" variant="outline" className="h-8 text-xs gap-1.5" onClick={() => setIndividualsOpen(true)} disabled={disabled || pending.length === 0}>
      <MessageCircle className="h-3.5 w-3.5" />Message Individuals
    </Button>
    <Button size="sm" variant="outline" className="h-8 text-xs gap-1.5 text-green-700" onClick={prepare} disabled={disabled || preparing}>
      <Users className="h-3.5 w-3.5" />{preparing ? 'Preparing image…' : 'Share to WhatsApp Group'}
    </Button>
    <Dialog open={individualsOpen} onOpenChange={setIndividualsOpen}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader><DialogTitle>Message individuals</DialogTitle><DialogDescription>Choose a person to open their reminder in WhatsApp. Each message includes only their missing dates from the selected report.</DialogDescription></DialogHeader>
        <div className="max-h-[60vh] overflow-auto space-y-3">
          {pending.map(person => <div key={person.id} className="rounded-lg border p-3">
            <p className="font-medium">{person.fullName}</p>
            <p className="text-xs text-muted-foreground">{person.missingDates.map(date => new Date(`${date}T00:00:00Z`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })).join(', ')}</p>
            <SadhanaWhatsAppReminder {...person} />
          </div>)}
        </div>
      </DialogContent>
    </Dialog>
    <Dialog open={!!image} onOpenChange={open => { if (!open) setImage(null); }}>
      <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-auto">
        <DialogHeader><DialogTitle>Share missing Sadhana report</DialogTitle><DialogDescription>{canShare ? 'Choose WhatsApp and your group in the share menu. The image and message will be shared together.' : 'Download the image and copy the message below, then attach the image and paste the message in your WhatsApp group.'}</DialogDescription></DialogHeader>
        {image && <>
          <div className="max-h-[40vh] overflow-auto rounded-lg border"><img src={image.url} alt="Filtered missing Sadhana report" className="w-full h-auto" /></div>
          <p className="whitespace-pre-line rounded-lg bg-muted p-3 text-sm select-text">{GROUP_MESSAGE}</p>
          <div className="flex flex-wrap justify-end gap-2">
            <Button variant="outline" onClick={async () => { try { await navigator.clipboard.writeText(GROUP_MESSAGE); toast.success('Message copied'); } catch { toast.error('Please select and copy the message above.'); } }}>Copy Message</Button>
            <a href={image.url} download={image.file.name} className="rounded-md border px-3 py-2 text-sm">Download Image</a>
            {canShare ? <Button onClick={share} disabled={sharing}>{sharing ? 'Sharing…' : 'Share Image and Message'}</Button> : <a href="https://web.whatsapp.com/" target="_blank" rel="noopener noreferrer" className="rounded-md border px-3 py-2 text-sm">Open WhatsApp</a>}
          </div>
        </>}
      </DialogContent>
    </Dialog>
  </>;
}
