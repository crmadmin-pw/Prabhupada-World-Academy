import { useState, useRef } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { toast } from 'sonner';
import { Plus, Home, Pencil, AlertTriangle, CheckCircle, XCircle, Download, Upload } from 'lucide-react';
import { addRentPayment, updateRentPayment, requestRentCorrection, approveRentCorrection, importRentPayments } from 'zite-endpoints-sdk';
import type { GetUserCrmDataOutputType } from 'zite-endpoints-sdk';
import { format } from 'date-fns';
import { exportToCsv } from '@/utils/exportCsv';

type RentType = GetUserCrmDataOutputType['rentPayments'][0];

const STATUS_COLORS: Record<string, string> = {
  Paid: 'text-green-700 bg-green-50 border-green-200',
  Partial: 'text-amber-700 bg-amber-50 border-amber-200',
  Unpaid: 'text-destructive bg-destructive/5 border-destructive/20',
  Overdue: 'text-destructive bg-destructive/10 border-destructive/30',
};
const CORR_COLORS: Record<string, string> = {
  Pending: 'text-amber-700 bg-amber-50 border-amber-200',
  Rejected: 'text-destructive bg-destructive/5 border-destructive/20',
};

interface RentForm { month: string; amountDue: string; amountPaid: string; paymentDate: string; status: string; notes: string; }
const EMPTY_F: RentForm = { month: '', amountDue: '', amountPaid: '', paymentDate: '', status: 'Unpaid', notes: '' };
interface CorrForm { proposedAmountDue: string; proposedAmountPaid: string; correctionNotes: string; }
const EMPTY_C: CorrForm = { proposedAmountDue: '', proposedAmountPaid: '', correctionNotes: '' };

function parseCSV(text: string): Record<string, string>[] {
  const lines = text.trim().split('\n').filter(Boolean);
  if (lines.length < 2) return [];
  const headers = lines[0].split(',').map(h => h.trim().replace(/^"|"$/g, ''));
  return lines.slice(1).map(line => {
    const vals: string[] = [];
    let cur = '', inQ = false;
    for (const ch of line) {
      if (ch === '"') inQ = !inQ;
      else if (ch === ',' && !inQ) { vals.push(cur.trim()); cur = ''; }
      else cur += ch;
    }
    vals.push(cur.trim());
    return Object.fromEntries(headers.map((h, i) => [h, vals[i]?.replace(/^"|"$/g, '') || '']));
  });
}

export default function RentHistoryCard({ userId, rentPayments, canEdit, isOwnProfile, isResident, onRefresh }: {
  userId: string; rentPayments: RentType[]; canEdit: boolean; isOwnProfile: boolean; isResident: boolean; onRefresh: () => void;
}) {
  const [editOpen, setEditOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [corrOpen, setCorrOpen] = useState(false);
  const [corrRent, setCorrRent] = useState<RentType | null>(null);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [reviewRent, setReviewRent] = useState<RentType | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [importRows, setImportRows] = useState<Record<string, string>[]>([]);
  const [importFile, setImportFile] = useState('');
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState<RentForm>(EMPTY_F);
  const [corrForm, setCorrForm] = useState<CorrForm>(EMPTY_C);
  const [reviewNote, setReviewNote] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  if (!isResident) return null;

  const totalDue = rentPayments.reduce((s, r) => s + Math.max(0, (r.amountDue ?? 0) - (r.amountPaid ?? 0)), 0);
  const pendingCount = rentPayments.filter(r => r.correctionStatus === 'Pending').length;
  const set = (k: keyof RentForm) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setForm(f => ({ ...f, [k]: e.target.value }));

  const openAdd = () => { setEditId(null); setForm(EMPTY_F); setEditOpen(true); };
  const openEdit = (r: RentType) => {
    setEditId(r.id);
    setForm({ month: r.month || '', amountDue: String(r.amountDue ?? ''), amountPaid: String(r.amountPaid ?? ''), paymentDate: r.paymentDate || '', status: r.status || 'Unpaid', notes: r.notes || '' });
    setEditOpen(true);
  };
  const openCorr = (r: RentType) => {
    setCorrRent(r);
    setCorrForm({ proposedAmountDue: String(r.amountDue ?? ''), proposedAmountPaid: String(r.amountPaid ?? ''), correctionNotes: '' });
    setCorrOpen(true);
  };
  const openReview = (r: RentType) => { setReviewRent(r); setReviewNote(''); setReviewOpen(true); };

  const handleSave = async () => {
    if (!form.month.trim()) return;
    setSaving(true);
    try {
      const p = { month: form.month, amountDue: parseFloat(form.amountDue) || 0, amountPaid: parseFloat(form.amountPaid) || 0, paymentDate: form.paymentDate || undefined, status: form.status, notes: form.notes || undefined };
      if (editId) await updateRentPayment({ paymentId: editId, ...p });
      else await addRentPayment({ userId, ...p });
      toast.success(editId ? 'Payment updated' : 'Payment added');
      setEditOpen(false); onRefresh();
    } catch { toast.error('Failed to save'); }
    finally { setSaving(false); }
  };

  const handleCorrSubmit = async () => {
    if (!corrRent || !corrForm.correctionNotes.trim()) return;
    setSaving(true);
    try {
      await requestRentCorrection({ paymentId: corrRent.id,
        proposedAmountDue: parseFloat(corrForm.proposedAmountDue) || 0,
        proposedAmountPaid: parseFloat(corrForm.proposedAmountPaid) || 0,
        correctionNotes: corrForm.correctionNotes });
      toast.success('Correction request submitted — awaiting review');
      setCorrOpen(false); onRefresh();
    } catch { toast.error('Failed to submit'); }
    finally { setSaving(false); }
  };

  const handleReview = async (action: 'approve' | 'reject') => {
    if (!reviewRent) return;
    setSaving(true);
    try {
      await approveRentCorrection({ paymentId: reviewRent.id, action, reviewNote: reviewNote || undefined });
      toast.success(action === 'approve' ? 'Correction approved ✓' : 'Correction rejected');
      setReviewOpen(false); onRefresh();
    } catch { toast.error('Failed'); }
    finally { setSaving(false); }
  };

  const handleExport = () => {
    exportToCsv('rent-payments-export.csv',
      ['User ID', 'Month', 'Amount Due', 'Amount Paid', 'Balance', 'Payment Date', 'Status', 'Notes'],
      rentPayments.map(r => [userId, r.month || '', r.amountDue ?? 0, r.amountPaid ?? 0,
        Math.max(0, (r.amountDue ?? 0) - (r.amountPaid ?? 0)), r.paymentDate || '', r.status || '', r.notes || '']));
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setImportFile(file.name);
    const reader = new FileReader();
    reader.onload = ev => { setImportRows(parseCSV(ev.target?.result as string)); };
    reader.readAsText(file);
  };

  const handleImport = async () => {
    if (!importRows.length) return;
    setSaving(true);
    try {
      const records = importRows.map(r => ({
        userId: r['User ID'] || r['userId'] || '',
        month: r['Month'] || r['month'] || '',
        amountDue: parseFloat(r['Amount Due'] || r['amountDue'] || '0') || 0,
        amountPaid: parseFloat(r['Amount Paid'] || r['amountPaid'] || '0') || 0,
        paymentDate: r['Payment Date'] || r['paymentDate'] || undefined,
        status: r['Status'] || r['status'] || 'Unpaid',
        notes: r['Notes'] || r['notes'] || undefined,
      })).filter(r => r.userId && r.month);
      const res = await importRentPayments({ records });
      toast.success(`Imported ${res.imported} payments${res.failed > 0 ? `, ${res.failed} failed` : ''}`);
      setImportOpen(false); setImportRows([]); setImportFile('');
      if (fileRef.current) fileRef.current.value = '';
      onRefresh();
    } catch { toast.error('Import failed'); }
    finally { setSaving(false); }
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <CardTitle className="text-base flex items-center gap-2">
            <Home className="w-4 h-4 text-primary" /> Rent History
            {pendingCount > 0 && <span className="text-xs px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700 font-semibold">{pendingCount} pending review</span>}
          </CardTitle>
          <div className="flex items-center gap-2 flex-wrap">
            {totalDue > 0 && <span className="text-sm font-semibold text-destructive">₹{totalDue.toLocaleString('en-IN')} outstanding</span>}
            {totalDue === 0 && rentPayments.length > 0 && <span className="text-sm font-medium text-green-600">All paid ✓</span>}
            {canEdit && (
              <>
                <Button size="sm" variant="outline" onClick={handleExport} className="h-7 gap-1 text-xs"><Download className="w-3 h-3" />Export</Button>
                <Button size="sm" variant="outline" onClick={() => setImportOpen(true)} className="h-7 gap-1 text-xs"><Upload className="w-3 h-3" />Import</Button>
                <Button size="sm" onClick={openAdd} className="h-7 gap-1 text-xs"><Plus className="w-3 h-3" />Add</Button>
              </>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {rentPayments.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-6">No rent payments recorded.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[420px]">
              <thead><tr className="border-b text-xs text-muted-foreground">
                <th className="text-left py-2 pr-3 font-medium">Month</th>
                <th className="text-right py-2 pr-3 font-medium">Due</th>
                <th className="text-right py-2 pr-3 font-medium">Paid</th>
                <th className="text-right py-2 pr-3 font-medium">Balance</th>
                <th className="text-left py-2 pr-3 font-medium">Status</th>
                <th className="text-left py-2 pr-3 font-medium hidden sm:table-cell">Paid On</th>
                <th className="w-16" />
              </tr></thead>
              <tbody>
                {rentPayments.map(r => {
                  const balance = Math.max(0, (r.amountDue ?? 0) - (r.amountPaid ?? 0));
                  const cs = r.correctionStatus;
                  const hasPending = cs === 'Pending';
                  const hasRejected = cs === 'Rejected';
                  return (
                    <>
                      <tr key={r.id} className={`border-b last:border-0 hover:bg-muted/20 transition-colors ${hasPending ? 'bg-amber-50/30' : ''}`}>
                        <td className="py-2.5 pr-3 font-medium">{r.month || '—'}</td>
                        <td className="py-2.5 pr-3 text-right whitespace-nowrap">₹{(r.amountDue ?? 0).toLocaleString('en-IN')}</td>
                        <td className="py-2.5 pr-3 text-right text-green-600 whitespace-nowrap">₹{(r.amountPaid ?? 0).toLocaleString('en-IN')}</td>
                        <td className={`py-2.5 pr-3 text-right font-semibold whitespace-nowrap ${balance > 0 ? 'text-destructive' : 'text-green-600'}`}>₹{balance.toLocaleString('en-IN')}</td>
                        <td className="py-2.5 pr-3">
                          <div className="flex flex-col gap-1">
                            <span className={`text-xs px-2 py-0.5 rounded-full border font-medium w-fit ${STATUS_COLORS[r.status || ''] || 'text-muted-foreground bg-muted border-border'}`}>{r.status || '—'}</span>
                            {(hasPending || hasRejected) && (
                              <span className={`text-xs px-2 py-0.5 rounded-full border font-medium w-fit ${CORR_COLORS[cs || '']}`}>
                                {hasPending ? '⏳ Correction Pending' : '✗ Rejected'}
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="py-2.5 pr-3 text-xs text-muted-foreground hidden sm:table-cell whitespace-nowrap">
                          {r.paymentDate ? format(new Date(r.paymentDate + 'T00:00:00'), 'dd MMM yy') : '—'}
                        </td>
                        <td className="py-2.5 text-right">
                          {canEdit && <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={() => openEdit(r)}><Pencil className="w-3 h-3" /></Button>}
                          {canEdit && hasPending && <Button variant="ghost" size="sm" className="h-6 text-xs px-2 text-amber-600" onClick={() => openReview(r)}>Review</Button>}
                          {isOwnProfile && !canEdit && !hasPending && <Button variant="ghost" size="sm" className="h-6 text-xs px-2 text-muted-foreground" onClick={() => openCorr(r)}><AlertTriangle className="w-3 h-3 mr-1" />Dispute</Button>}
                          {isOwnProfile && !canEdit && hasPending && <span className="text-xs text-amber-600 px-1">Pending…</span>}
                        </td>
                      </tr>
                      {canEdit && hasPending && (
                        <tr key={`${r.id}-proposed`} className="bg-amber-50/50 border-b">
                          <td colSpan={7} className="px-3 py-2 text-xs">
                            <span className="font-semibold text-amber-700">Proposed: </span>
                            <span>Due ₹{(r.proposedAmountDue ?? 0).toLocaleString('en-IN')} · Paid ₹{(r.proposedAmountPaid ?? 0).toLocaleString('en-IN')}</span>
                            {r.correctionNotes && <span className="ml-2 text-muted-foreground">"{r.correctionNotes}"</span>}
                          </td>
                        </tr>
                      )}
                    </>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>

      {/* Add/Edit Dialog */}
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>{editId ? 'Edit Payment' : 'Add Rent Payment'}</DialogTitle></DialogHeader>
          <div className="grid grid-cols-2 gap-3 mt-1">
            <div className="col-span-2"><Label>Month *</Label><Input value={form.month} onChange={set('month')} placeholder="e.g. Jan 2025" className="mt-1" /></div>
            <div><Label>Amount Due (₹)</Label><Input type="number" value={form.amountDue} onChange={set('amountDue')} placeholder="0" className="mt-1" /></div>
            <div><Label>Amount Paid (₹)</Label><Input type="number" value={form.amountPaid} onChange={set('amountPaid')} placeholder="0" className="mt-1" /></div>
            <div><Label>Payment Date</Label><Input type="date" value={form.paymentDate} onChange={set('paymentDate')} className="mt-1" /></div>
            <div><Label>Status</Label>
              <Select value={form.status} onValueChange={v => setForm(f => ({ ...f, status: v }))}>
                <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="Paid">Paid</SelectItem><SelectItem value="Partial">Partial</SelectItem><SelectItem value="Unpaid">Unpaid</SelectItem><SelectItem value="Overdue">Overdue</SelectItem></SelectContent>
              </Select>
            </div>
            <div className="col-span-2"><Label>Notes</Label><Textarea value={form.notes} onChange={set('notes')} placeholder="Any notes..." rows={2} className="mt-1" /></div>
          </div>
          <Button className="w-full mt-2" onClick={handleSave} disabled={saving || !form.month.trim()}>{saving ? 'Saving...' : editId ? 'Update' : 'Add Payment'}</Button>
        </DialogContent>
      </Dialog>

      {/* Correction Request Dialog */}
      <Dialog open={corrOpen} onOpenChange={setCorrOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Request Rent Correction</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">Propose corrected amounts for <strong>{corrRent?.month}</strong>. A FOLK Lead or Guide will review.</p>
          <div className="space-y-3 mt-2">
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Correct Due (₹)</Label><Input type="number" value={corrForm.proposedAmountDue} onChange={e => setCorrForm(f => ({ ...f, proposedAmountDue: e.target.value }))} className="mt-1" /></div>
              <div><Label>Correct Paid (₹)</Label><Input type="number" value={corrForm.proposedAmountPaid} onChange={e => setCorrForm(f => ({ ...f, proposedAmountPaid: e.target.value }))} className="mt-1" /></div>
            </div>
            <div><Label>Reason *</Label><Textarea value={corrForm.correctionNotes} onChange={e => setCorrForm(f => ({ ...f, correctionNotes: e.target.value }))} placeholder="Explain the discrepancy..." rows={3} className="mt-1" /></div>
            <Button className="w-full" onClick={handleCorrSubmit} disabled={saving || !corrForm.correctionNotes.trim()}>{saving ? 'Submitting...' : 'Submit for Review'}</Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Review Correction Dialog */}
      <Dialog open={reviewOpen} onOpenChange={setReviewOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Review Rent Correction</DialogTitle></DialogHeader>
          {reviewRent && (
            <div className="space-y-4 mt-1">
              <div className="bg-muted/50 rounded-lg p-3 space-y-1 text-sm">
                <div className="font-semibold">{reviewRent.month}</div>
                <div className="grid grid-cols-2 gap-2 text-xs mt-2">
                  <div><span className="text-muted-foreground">Current Due:</span> <span className="font-medium">₹{(reviewRent.amountDue ?? 0).toLocaleString('en-IN')}</span></div>
                  <div><span className="text-muted-foreground">Proposed:</span> <span className="font-semibold text-amber-700">₹{(reviewRent.proposedAmountDue ?? 0).toLocaleString('en-IN')}</span></div>
                  <div><span className="text-muted-foreground">Current Paid:</span> <span className="font-medium">₹{(reviewRent.amountPaid ?? 0).toLocaleString('en-IN')}</span></div>
                  <div><span className="text-muted-foreground">Proposed:</span> <span className="font-semibold text-amber-700">₹{(reviewRent.proposedAmountPaid ?? 0).toLocaleString('en-IN')}</span></div>
                </div>
                {reviewRent.correctionNotes && <p className="text-xs text-muted-foreground mt-2 italic">"{reviewRent.correctionNotes}"</p>}
              </div>
              <div><Label>Review note (optional)</Label><Input value={reviewNote} onChange={e => setReviewNote(e.target.value)} placeholder="Add a note for the user..." className="mt-1" /></div>
              <div className="flex gap-2">
                <Button className="flex-1" onClick={() => handleReview('approve')} disabled={saving}><CheckCircle className="w-4 h-4 mr-2" />Approve</Button>
                <Button variant="outline" className="flex-1 border-destructive text-destructive" onClick={() => handleReview('reject')} disabled={saving}><XCircle className="w-4 h-4 mr-2" />Reject</Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Import Dialog */}
      <Dialog open={importOpen} onOpenChange={setImportOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>Import Rent Payments from CSV</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div className="bg-muted/50 rounded p-3 text-xs text-muted-foreground">
              <p className="font-medium mb-1">Expected columns:</p>
              <code>User ID, Month, Amount Due, Amount Paid, Payment Date, Status, Notes</code>
            </div>
            <div>
              <input ref={fileRef} type="file" accept=".csv" onChange={handleFileChange} className="hidden" id="rent-csv-input" />
              <label htmlFor="rent-csv-input">
                <Button variant="outline" className="w-full" asChild><span><Upload className="w-4 h-4 mr-2" />{importFile || 'Choose CSV file'}</span></Button>
              </label>
            </div>
            {importRows.length > 0 && (
              <div>
                <p className="text-sm font-medium mb-2">{importRows.length} rows found — Preview (first 3):</p>
                <div className="overflow-x-auto border rounded">
                  <table className="text-xs w-full">
                    <thead><tr className="bg-muted">{Object.keys(importRows[0]).slice(0, 5).map(h => <th key={h} className="px-2 py-1 text-left font-medium">{h}</th>)}</tr></thead>
                    <tbody>{importRows.slice(0, 3).map((r, i) => <tr key={i} className="border-t">{Object.values(r).slice(0, 5).map((v, j) => <td key={j} className="px-2 py-1">{String(v).slice(0, 20)}</td>)}</tr>)}</tbody>
                  </table>
                </div>
                <Button className="w-full mt-3" onClick={handleImport} disabled={saving}>{saving ? 'Importing...' : `Import ${importRows.length} payments`}</Button>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
