import { useState, useRef } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { toast } from 'sonner';
import { Plus, Plane, Pencil, AlertTriangle, CheckCircle, XCircle, Download, Upload } from 'lucide-react';
import { addTrip, updateTrip, requestTripCorrection, approveTripCorrection, importTrips } from 'zite-endpoints-sdk';
import type { GetUserCrmDataOutputType } from 'zite-endpoints-sdk';
import { format } from 'date-fns';
import { exportToCsv } from '@/utils/exportCsv';

type TripType = GetUserCrmDataOutputType['trips'][0];

const PAY_COLORS: Record<string, string> = {
  Paid: 'text-green-700 bg-green-50 border-green-200',
  Partial: 'text-amber-700 bg-amber-50 border-amber-200',
  Unpaid: 'text-destructive bg-destructive/5 border-destructive/20',
};
const CORR_COLORS: Record<string, string> = {
  Pending: 'text-amber-700 bg-amber-50 border-amber-200',
  Rejected: 'text-destructive bg-destructive/5 border-destructive/20',
};

interface TripForm { tripName: string; tripDate: string; destination: string; totalAmount: string; amountPaid: string; paymentStatus: string; notes: string; }
const EMPTY_F: TripForm = { tripName: '', tripDate: '', destination: '', totalAmount: '', amountPaid: '', paymentStatus: 'Unpaid', notes: '' };

interface CorrForm { proposedTotalAmount: string; proposedAmountPaid: string; correctionNotes: string; }
const EMPTY_C: CorrForm = { proposedTotalAmount: '', proposedAmountPaid: '', correctionNotes: '' };

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

export default function TripsDuesCard({ userId, trips, canEdit, isOwnProfile, onRefresh }: {
  userId: string; trips: TripType[]; canEdit: boolean; isOwnProfile: boolean; onRefresh: () => void;
}) {
  const [editOpen, setEditOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [corrOpen, setCorrOpen] = useState(false);
  const [corrTrip, setCorrTrip] = useState<TripType | null>(null);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [reviewTrip, setReviewTrip] = useState<TripType | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [importRows, setImportRows] = useState<Record<string, string>[]>([]);
  const [importFile, setImportFile] = useState('');
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState<TripForm>(EMPTY_F);
  const [corrForm, setCorrForm] = useState<CorrForm>(EMPTY_C);
  const [reviewNote, setReviewNote] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  const totalPending = trips.reduce((s, t) => s + Math.max(0, (t.totalAmount ?? 0) - (t.amountPaid ?? 0)), 0);
  const pendingCount = trips.filter(t => t.correctionStatus === 'Pending').length;
  const set = (k: keyof TripForm) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setForm(f => ({ ...f, [k]: e.target.value }));

  const openAdd = () => { setEditId(null); setForm(EMPTY_F); setEditOpen(true); };
  const openEdit = (t: TripType) => {
    setEditId(t.id);
    setForm({ tripName: t.tripName || '', tripDate: t.tripDate || '', destination: t.destination || '',
      totalAmount: String(t.totalAmount ?? ''), amountPaid: String(t.amountPaid ?? ''), paymentStatus: t.paymentStatus || 'Unpaid', notes: t.notes || '' });
    setEditOpen(true);
  };
  const openCorr = (t: TripType) => {
    setCorrTrip(t);
    setCorrForm({ proposedTotalAmount: String(t.totalAmount ?? ''), proposedAmountPaid: String(t.amountPaid ?? ''), correctionNotes: '' });
    setCorrOpen(true);
  };
  const openReview = (t: TripType) => { setReviewTrip(t); setReviewNote(''); setReviewOpen(true); };

  const handleSave = async () => {
    if (!form.tripName.trim()) return;
    setSaving(true);
    try {
      const p = { tripName: form.tripName, tripDate: form.tripDate || undefined, destination: form.destination || undefined,
        totalAmount: parseFloat(form.totalAmount) || 0, amountPaid: parseFloat(form.amountPaid) || 0, paymentStatus: form.paymentStatus, notes: form.notes || undefined };
      if (editId) await updateTrip({ tripId: editId, ...p });
      else await addTrip({ userId, ...p });
      toast.success(editId ? 'Trip updated' : 'Trip added');
      setEditOpen(false); onRefresh();
    } catch { toast.error('Failed to save'); }
    finally { setSaving(false); }
  };

  const handleCorrSubmit = async () => {
    if (!corrTrip || !corrForm.correctionNotes.trim()) return;
    setSaving(true);
    try {
      await requestTripCorrection({ tripId: corrTrip.id,
        proposedTotalAmount: parseFloat(corrForm.proposedTotalAmount) || 0,
        proposedAmountPaid: parseFloat(corrForm.proposedAmountPaid) || 0,
        correctionNotes: corrForm.correctionNotes });
      toast.success('Correction request submitted — awaiting review');
      setCorrOpen(false); onRefresh();
    } catch { toast.error('Failed to submit correction'); }
    finally { setSaving(false); }
  };

  const handleReview = async (action: 'approve' | 'reject') => {
    if (!reviewTrip) return;
    setSaving(true);
    try {
      await approveTripCorrection({ tripId: reviewTrip.id, action, reviewNote: reviewNote || undefined });
      toast.success(action === 'approve' ? 'Correction approved ✓' : 'Correction rejected');
      setReviewOpen(false); onRefresh();
    } catch { toast.error('Failed'); }
    finally { setSaving(false); }
  };

  const handleExport = () => {
    exportToCsv('trips-export.csv',
      ['User ID', 'Trip Name', 'Date', 'Destination', 'Total Amount', 'Amount Paid', 'Balance', 'Payment Status', 'Notes'],
      trips.map(t => [userId, t.tripName || '', t.tripDate || '', t.destination || '',
        t.totalAmount ?? 0, t.amountPaid ?? 0, Math.max(0, (t.totalAmount ?? 0) - (t.amountPaid ?? 0)), t.paymentStatus || '', t.notes || '']));
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
        tripName: r['Trip Name'] || r['tripName'] || '',
        tripDate: r['Date'] || r['tripDate'] || undefined,
        destination: r['Destination'] || r['destination'] || undefined,
        totalAmount: parseFloat(r['Total Amount'] || r['totalAmount'] || '0') || 0,
        amountPaid: parseFloat(r['Amount Paid'] || r['amountPaid'] || '0') || 0,
        paymentStatus: r['Payment Status'] || r['paymentStatus'] || 'Unpaid',
        notes: r['Notes'] || r['notes'] || undefined,
      })).filter(r => r.userId && r.tripName);
      const res = await importTrips({ records });
      toast.success(`Imported ${res.imported} trips${res.failed > 0 ? `, ${res.failed} failed` : ''}`);
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
            <Plane className="w-4 h-4 text-primary" /> Trips & Dues
            {pendingCount > 0 && <span className="text-xs px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700 font-semibold">{pendingCount} pending review</span>}
          </CardTitle>
          <div className="flex items-center gap-2 flex-wrap">
            {totalPending > 0 && <span className="text-sm font-semibold text-destructive">₹{totalPending.toLocaleString('en-IN')} pending</span>}
            {totalPending === 0 && trips.length > 0 && <span className="text-sm font-medium text-green-600">All clear ✓</span>}
            {canEdit && (
              <>
                <Button size="sm" variant="outline" onClick={handleExport} className="h-7 gap-1 text-xs"><Download className="w-3 h-3" />Export</Button>
                <Button size="sm" variant="outline" onClick={() => setImportOpen(true)} className="h-7 gap-1 text-xs"><Upload className="w-3 h-3" />Import</Button>
                <Button size="sm" onClick={openAdd} className="h-7 gap-1 text-xs"><Plus className="w-3 h-3" />Add Trip</Button>
              </>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {trips.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-6">No trips recorded yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[520px]">
              <thead><tr className="border-b text-xs text-muted-foreground">
                <th className="text-left py-2 pr-3 font-medium">Trip</th>
                <th className="text-left py-2 pr-3 font-medium">Date</th>
                <th className="text-right py-2 pr-3 font-medium">Total</th>
                <th className="text-right py-2 pr-3 font-medium">Paid</th>
                <th className="text-right py-2 pr-3 font-medium">Pending</th>
                <th className="text-left py-2 pr-3 font-medium">Status</th>
                <th className="w-16" />
              </tr></thead>
              <tbody>
                {trips.map(t => {
                  const pending = Math.max(0, (t.totalAmount ?? 0) - (t.amountPaid ?? 0));
                  const cs = t.correctionStatus;
                  const hasPending = cs === 'Pending';
                  const hasRejected = cs === 'Rejected';
                  return (
                    <>
                      <tr key={t.id} className={`border-b last:border-0 hover:bg-muted/20 transition-colors ${hasPending ? 'bg-amber-50/30' : ''}`}>
                        <td className="py-2.5 pr-3">
                          <div className="font-medium">{t.tripName || '—'}</div>
                          {t.destination && <div className="text-xs text-muted-foreground">{t.destination}</div>}
                        </td>
                        <td className="py-2.5 pr-3 text-xs text-muted-foreground whitespace-nowrap">
                          {t.tripDate ? format(new Date(t.tripDate + 'T00:00:00'), 'dd MMM yy') : '—'}
                        </td>
                        <td className="py-2.5 pr-3 text-right whitespace-nowrap">₹{(t.totalAmount ?? 0).toLocaleString('en-IN')}</td>
                        <td className="py-2.5 pr-3 text-right text-green-600 whitespace-nowrap">₹{(t.amountPaid ?? 0).toLocaleString('en-IN')}</td>
                        <td className={`py-2.5 pr-3 text-right font-semibold whitespace-nowrap ${pending > 0 ? 'text-destructive' : 'text-green-600'}`}>₹{pending.toLocaleString('en-IN')}</td>
                        <td className="py-2.5 pr-3">
                          <div className="flex flex-col gap-1">
                            <span className={`text-xs px-2 py-0.5 rounded-full border font-medium w-fit ${PAY_COLORS[t.paymentStatus || ''] || 'text-muted-foreground bg-muted border-border'}`}>{t.paymentStatus || '—'}</span>
                            {(hasPending || hasRejected) && (
                              <span className={`text-xs px-2 py-0.5 rounded-full border font-medium w-fit ${CORR_COLORS[cs || '']}`}>
                                {hasPending ? '⏳ Correction Pending' : '✗ Correction Rejected'}
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="py-2.5 text-right">
                          {canEdit && <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={() => openEdit(t)}><Pencil className="w-3 h-3" /></Button>}
                          {canEdit && hasPending && <Button variant="ghost" size="sm" className="h-6 text-xs px-2 text-amber-600" onClick={() => openReview(t)}>Review</Button>}
                          {isOwnProfile && !canEdit && !hasPending && <Button variant="ghost" size="sm" className="h-6 text-xs px-2 text-muted-foreground" onClick={() => openCorr(t)}><AlertTriangle className="w-3 h-3 mr-1" />Dispute</Button>}
                          {isOwnProfile && !canEdit && hasPending && <span className="text-xs text-amber-600 px-1">Pending…</span>}
                        </td>
                      </tr>
                      {canEdit && hasPending && (
                        <tr key={`${t.id}-proposed`} className="bg-amber-50/50 border-b">
                          <td colSpan={7} className="px-3 py-2 text-xs">
                            <span className="font-semibold text-amber-700">Proposed correction: </span>
                            <span>Total ₹{(t.proposedTotalAmount ?? 0).toLocaleString('en-IN')} · Paid ₹{(t.proposedAmountPaid ?? 0).toLocaleString('en-IN')}</span>
                            {t.correctionNotes && <span className="ml-2 text-muted-foreground">"{t.correctionNotes}"</span>}
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
          <DialogHeader><DialogTitle>{editId ? 'Edit Trip' : 'Add New Trip'}</DialogTitle></DialogHeader>
          <div className="grid grid-cols-2 gap-3 mt-1">
            <div className="col-span-2"><Label>Trip Name *</Label><Input value={form.tripName} onChange={set('tripName')} placeholder="e.g. Vrindavan Yatra 2025" className="mt-1" /></div>
            <div><Label>Date</Label><Input type="date" value={form.tripDate} onChange={set('tripDate')} className="mt-1" /></div>
            <div><Label>Destination</Label><Input value={form.destination} onChange={set('destination')} placeholder="e.g. Vrindavan" className="mt-1" /></div>
            <div><Label>Total Amount (₹)</Label><Input type="number" value={form.totalAmount} onChange={set('totalAmount')} placeholder="0" className="mt-1" /></div>
            <div><Label>Amount Paid (₹)</Label><Input type="number" value={form.amountPaid} onChange={set('amountPaid')} placeholder="0" className="mt-1" /></div>
            <div className="col-span-2"><Label>Payment Status</Label>
              <Select value={form.paymentStatus} onValueChange={v => setForm(f => ({ ...f, paymentStatus: v }))}>
                <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="Paid">Paid</SelectItem><SelectItem value="Partial">Partial</SelectItem><SelectItem value="Unpaid">Unpaid</SelectItem></SelectContent>
              </Select>
            </div>
            <div className="col-span-2"><Label>Notes</Label><Textarea value={form.notes} onChange={set('notes')} placeholder="Any additional notes..." rows={2} className="mt-1" /></div>
          </div>
          <Button className="w-full mt-2" onClick={handleSave} disabled={saving || !form.tripName.trim()}>{saving ? 'Saving...' : editId ? 'Update Trip' : 'Add Trip'}</Button>
        </DialogContent>
      </Dialog>

      {/* Correction Request Dialog */}
      <Dialog open={corrOpen} onOpenChange={setCorrOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Request Correction</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">Propose corrected values for <strong>{corrTrip?.tripName}</strong>. A coordinator will review your request.</p>
          <div className="space-y-3 mt-2">
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Correct Total (₹)</Label><Input type="number" value={corrForm.proposedTotalAmount} onChange={e => setCorrForm(f => ({ ...f, proposedTotalAmount: e.target.value }))} className="mt-1" /></div>
              <div><Label>Correct Paid (₹)</Label><Input type="number" value={corrForm.proposedAmountPaid} onChange={e => setCorrForm(f => ({ ...f, proposedAmountPaid: e.target.value }))} className="mt-1" /></div>
            </div>
            <div><Label>Reason for correction *</Label><Textarea value={corrForm.correctionNotes} onChange={e => setCorrForm(f => ({ ...f, correctionNotes: e.target.value }))} placeholder="Explain the discrepancy..." rows={3} className="mt-1" /></div>
            <Button className="w-full" onClick={handleCorrSubmit} disabled={saving || !corrForm.correctionNotes.trim()}>{saving ? 'Submitting...' : 'Submit for Review'}</Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Review Correction Dialog */}
      <Dialog open={reviewOpen} onOpenChange={setReviewOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Review Correction Request</DialogTitle></DialogHeader>
          {reviewTrip && (
            <div className="space-y-4 mt-1">
              <div className="bg-muted/50 rounded-lg p-3 space-y-1 text-sm">
                <div className="font-semibold">{reviewTrip.tripName}</div>
                <div className="grid grid-cols-2 gap-2 text-xs mt-2">
                  <div><span className="text-muted-foreground">Current Total:</span> <span className="font-medium">₹{(reviewTrip.totalAmount ?? 0).toLocaleString('en-IN')}</span></div>
                  <div><span className="text-muted-foreground">Proposed:</span> <span className="font-semibold text-amber-700">₹{(reviewTrip.proposedTotalAmount ?? 0).toLocaleString('en-IN')}</span></div>
                  <div><span className="text-muted-foreground">Current Paid:</span> <span className="font-medium">₹{(reviewTrip.amountPaid ?? 0).toLocaleString('en-IN')}</span></div>
                  <div><span className="text-muted-foreground">Proposed:</span> <span className="font-semibold text-amber-700">₹{(reviewTrip.proposedAmountPaid ?? 0).toLocaleString('en-IN')}</span></div>
                </div>
                {reviewTrip.correctionNotes && <p className="text-xs text-muted-foreground mt-2 italic">"{reviewTrip.correctionNotes}"</p>}
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
          <DialogHeader><DialogTitle>Import Trips from CSV</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div className="bg-muted/50 rounded p-3 text-xs text-muted-foreground">
              <p className="font-medium mb-1">Expected columns:</p>
              <code>User ID, Trip Name, Date, Destination, Total Amount, Amount Paid, Payment Status, Notes</code>
            </div>
            <div>
              <input ref={fileRef} type="file" accept=".csv" onChange={handleFileChange} className="hidden" id="trip-csv-input" />
              <label htmlFor="trip-csv-input">
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
                <Button className="w-full mt-3" onClick={handleImport} disabled={saving}>{saving ? 'Importing...' : `Import ${importRows.length} trips`}</Button>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
