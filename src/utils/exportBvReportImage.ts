// Canvas-based PNG export for BVSL preaching report
function cssVar(name: string, fallback: string): string {
  try {
    const val = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    if (!val) return fallback;
    const parts = val.split(/\s+/);
    if (parts.length === 3) return `hsl(${parts[0]}, ${parts[1]}, ${parts[2]})`;
    return `hsl(${val})`;
  } catch { return fallback; }
}

function buildPalette() {
  return {
    primary:  cssVar('--primary',    '#E86209'),
    bg:       cssVar('--background', '#FEFDFB'),
    card:     cssVar('--card',       '#FFFFFF'),
    border:   cssVar('--border',     '#EDE8DC'),
    fg:       cssVar('--foreground', '#000000'),
    muted:    cssVar('--muted-foreground', '#7A6E65'),
    mutedBg:  cssVar('--muted',      '#F5F0E8'),
    green: '#16a34a', greenBg: '#dcfce7',
    red:   '#dc2626', redBg:   '#fee2e2',
    amber: '#d97706', amberBg: '#fef9c3',
    white: '#FFFFFF',
  };
}

const FONT = '"Inter", "Helvetica Neue", Arial, sans-serif';

function rr(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number, fill?: string) {
  ctx.beginPath();
  ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
  if (fill) { ctx.fillStyle = fill; ctx.fill(); }
}

function minsToHHMM(mins: number): string {
  if (!mins || mins <= 0) return '00:00';
  const h = Math.floor(mins / 60), m = Math.round(mins % 60);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

function durColor(mins: number, C: ReturnType<typeof buildPalette>) {
  if (mins >= 30) return { bg: C.greenBg, fg: C.green };
  if (mins >= 15) return { bg: C.amberBg, fg: C.amber };
  return { bg: C.redBg, fg: C.red };
}
function cntColor(n: number, C: ReturnType<typeof buildPalette>) {
  if (n >= 2) return { bg: C.greenBg, fg: C.green };
  if (n === 1) return { bg: C.amberBg, fg: C.amber };
  return { bg: C.redBg, fg: C.red };
}
function totColor(mins: number, C: ReturnType<typeof buildPalette>) {
  if (mins >= 120) return { bg: C.greenBg, fg: C.green };
  if (mins >= 60)  return { bg: C.amberBg, fg: C.amber };
  return { bg: C.redBg, fg: C.red };
}

export interface BvslRow {
  fullName: string;
  groupName: string;
  submitted: boolean;
  callingTime: number;
  oneOnOneTime: number;
  bookDistTime: number;
  rduaTime: number;
  planTime: number;
  booksDistributed: number;
  contactsCollected: number;
  uniqueOneOnOnes: number;
  totalMinutes: number;
}

export interface BvslReportSummary {
  total: number;
  submitted: number;
  totalMins: number;
  totalBooks: number;
  totalContacts: number;
  totalOneOnOnes: number;
  avgMins: number;
  avgBooks: number;
}

export function exportBvslReportAsImage(
  rows: BvslRow[],
  summary: BvslReportSummary,
  dateLabel: string,
  filename: string,
) {
  const C = buildPalette();
  const PAD = 20;
  const ROW_H = 28;
  const TH_H = 36;
  const HDR_H = 58;
  const STATS_H = 96;

  const COL_RANK = 32;
  const COL_NAME = 150;
  const COL_GRP  = 90;
  const COL_DUR  = 68;  // calling, 1-on-1, book-dist, rdua, plan
  const COL_CNT  = 56;  // books, contacts, 1-on-1s
  const COL_TOT  = 72;

  const cols = [COL_DUR, COL_DUR, COL_DUR, COL_DUR, COL_DUR, COL_CNT, COL_CNT, COL_CNT, COL_TOT];
  const tableW = COL_RANK + COL_NAME + COL_GRP + cols.reduce((a, b) => a + b, 0);
  const canvasW = Math.max(tableW + PAD * 2, 900);
  const canvasH = HDR_H + STATS_H + TH_H + rows.length * ROW_H + PAD * 2 + 16;

  const _scaleByDim = Math.floor(Math.min(16384 / canvasW, 16384 / canvasH));
  const SCALE = Math.min(12, Math.max(3, _scaleByDim));

  const canvas = document.createElement('canvas');
  canvas.width = canvasW * SCALE;
  canvas.height = canvasH * SCALE;
  const ctx = canvas.getContext('2d')!;
  ctx.scale(SCALE, SCALE);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';

  // Background
  ctx.fillStyle = C.bg; ctx.fillRect(0, 0, canvasW, canvasH);

  // Header
  ctx.fillStyle = C.primary; ctx.fillRect(0, 0, canvasW, HDR_H);
  ctx.fillStyle = C.white; ctx.font = `bold 17px ${FONT}`;
  ctx.fillText('BVSL Preaching Report', PAD, 26);
  if (dateLabel) {
    ctx.font = `bold 12px ${FONT}`; ctx.fillStyle = 'rgba(255,255,255,0.9)';
    ctx.fillText(dateLabel, PAD, 46);
  }

  let y = HDR_H + PAD;

  // Summary stat cards
  const statItems = [
    { label: 'Total BVSLs',     value: String(summary.total) },
    { label: 'Submitted',       value: String(summary.submitted) },
    { label: 'Total Preaching', value: minsToHHMM(summary.totalMins) },
    { label: 'Avg Preaching',   value: minsToHHMM(summary.avgMins) },
    { label: 'Total Books',     value: String(summary.totalBooks) },
    { label: 'Avg Books',       value: String(summary.avgBooks) },
    { label: 'Total 1-on-1s',   value: String(summary.totalOneOnOnes) },
    { label: 'Total Contacts',  value: String(summary.totalContacts) },
  ];
  const CARD_H = 76;
  const cardW = Math.floor((canvasW - PAD * 2) / statItems.length);
  statItems.forEach((s, i) => {
    const sx = PAD + i * cardW;
    rr(ctx, sx, y, cardW - 5, CARD_H, 5, C.card);
    ctx.strokeStyle = C.border; ctx.lineWidth = 1;
    ctx.strokeRect(sx, y, cardW - 5, CARD_H);
    ctx.fillStyle = C.primary; ctx.font = `bold 17px ${FONT}`; ctx.textAlign = 'center';
    ctx.fillText(s.value, sx + (cardW - 5) / 2, y + 38);
    ctx.fillStyle = C.muted; ctx.font = `bold 9px ${FONT}`;
    ctx.fillText(s.label, sx + (cardW - 5) / 2, y + 58);
  });
  ctx.textAlign = 'left';
  y += STATS_H;

  // Table header
  const tL = PAD;
  ctx.fillStyle = C.mutedBg; ctx.fillRect(tL, y, tableW, TH_H);
  ctx.strokeStyle = C.border; ctx.lineWidth = 1; ctx.strokeRect(tL, y, tableW, TH_H);

  const headers = ['#', 'Name', 'Group', 'Calling', '1-on-1', 'Bk Dist', 'RDUA', 'Plan', 'Books', 'Contacts', '1-on-1s', 'Total'];
  const colWidths = [COL_RANK, COL_NAME, COL_GRP, ...cols];
  let hx = tL;
  ctx.fillStyle = C.fg; ctx.font = `bold 10px ${FONT}`; ctx.textAlign = 'center';
  headers.forEach((h, i) => {
    const cw = colWidths[i];
    ctx.fillText(h, hx + cw / 2, y + TH_H / 2 + 4);
    if (i < headers.length - 1) {
      ctx.strokeStyle = C.border; ctx.lineWidth = 0.5;
      ctx.beginPath(); ctx.moveTo(hx + cw, y); ctx.lineTo(hx + cw, y + TH_H); ctx.stroke();
    }
    hx += cw;
  });
  ctx.textAlign = 'left';
  y += TH_H;

  // Data rows
  rows.forEach((row, idx) => {
    const ry = y + idx * ROW_H;
    ctx.fillStyle = idx % 2 === 0 ? C.card : C.mutedBg;
    ctx.fillRect(tL, ry, tableW, ROW_H);
    ctx.strokeStyle = C.border; ctx.lineWidth = 0.5; ctx.strokeRect(tL, ry, tableW, ROW_H);

    if (!row.submitted) {
      ctx.fillStyle = C.muted; ctx.font = `10px ${FONT}`; ctx.textAlign = 'center';
      ctx.fillText(String(idx + 1), tL + COL_RANK / 2, ry + ROW_H / 2 + 4);
      ctx.textAlign = 'left'; ctx.font = `10px ${FONT}`; ctx.fillStyle = '#999';
      ctx.fillText(row.fullName.slice(0, 20), tL + COL_RANK + 6, ry + ROW_H / 2 + 4);
      ctx.fillStyle = C.red; ctx.font = `bold 8px ${FONT}`;
      ctx.fillText('MISSING', tL + COL_RANK + 6, ry + ROW_H - 4);
      return;
    }

    let rx = tL;
    // Rank
    ctx.fillStyle = C.muted; ctx.font = `10px ${FONT}`; ctx.textAlign = 'center';
    ctx.fillText(String(idx + 1), rx + COL_RANK / 2, ry + ROW_H / 2 + 4);
    rx += COL_RANK;
    // Name
    ctx.fillStyle = C.fg; ctx.font = `bold 10px ${FONT}`; ctx.textAlign = 'left';
    ctx.fillText(row.fullName.slice(0, 22), rx + 5, ry + ROW_H / 2 + 4);
    rx += COL_NAME;
    // Group
    ctx.fillStyle = C.muted; ctx.font = `9px ${FONT}`;
    ctx.fillText(row.groupName.slice(0, 14), rx + 4, ry + ROW_H / 2 + 4);
    rx += COL_GRP;

    // Duration cells
    const durFields = [row.callingTime, row.oneOnOneTime, row.bookDistTime, row.rduaTime, row.planTime];
    for (const mins of durFields) {
      const { bg, fg } = durColor(mins, C);
      ctx.fillStyle = bg; ctx.fillRect(rx, ry, COL_DUR, ROW_H);
      ctx.fillStyle = fg; ctx.font = `bold 10px ${FONT}`; ctx.textAlign = 'center';
      ctx.fillText(minsToHHMM(mins), rx + COL_DUR / 2, ry + ROW_H / 2 + 4);
      ctx.strokeStyle = C.border; ctx.lineWidth = 0.5;
      ctx.beginPath(); ctx.moveTo(rx, ry); ctx.lineTo(rx, ry + ROW_H); ctx.stroke();
      rx += COL_DUR;
    }
    // Count cells
    const cntFields = [row.booksDistributed, row.contactsCollected, row.uniqueOneOnOnes];
    for (const n of cntFields) {
      const { bg, fg } = cntColor(n, C);
      ctx.fillStyle = bg; ctx.fillRect(rx, ry, COL_CNT, ROW_H);
      ctx.fillStyle = fg; ctx.font = `bold 10px ${FONT}`; ctx.textAlign = 'center';
      ctx.fillText(String(n), rx + COL_CNT / 2, ry + ROW_H / 2 + 4);
      ctx.strokeStyle = C.border; ctx.lineWidth = 0.5;
      ctx.beginPath(); ctx.moveTo(rx, ry); ctx.lineTo(rx, ry + ROW_H); ctx.stroke();
      rx += COL_CNT;
    }
    // Total
    const { bg: totBg, fg: totFg } = totColor(row.totalMinutes, C);
    ctx.fillStyle = totBg; ctx.fillRect(rx, ry, COL_TOT, ROW_H);
    ctx.fillStyle = totFg; ctx.font = `bold 11px ${FONT}`; ctx.textAlign = 'center';
    ctx.fillText(minsToHHMM(row.totalMinutes), rx + COL_TOT / 2, ry + ROW_H / 2 + 4);
    ctx.textAlign = 'left';
  });

  // Footer
  const footerY = y + rows.length * ROW_H + 10;
  ctx.fillStyle = C.muted; ctx.font = `9px ${FONT}`;
  ctx.fillText('Prabhupada World Academy', PAD, footerY);

  // Download
  try {
    const link = document.createElement('a');
    link.download = filename;
    link.href = canvas.toDataURL('image/png');
    link.click();
  } catch {
    canvas.toBlob(blob => {
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.download = filename; link.href = url; link.click();
      setTimeout(() => URL.revokeObjectURL(url), 10000);
    }, 'image/png');
  }
}
