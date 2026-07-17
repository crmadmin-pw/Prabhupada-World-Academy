// Native Canvas-based PNG export for sadhana reports (no third-party libs)
import type { FieldDef, UserRow } from '@/components/guide/SadhanaDetailTable';
import { computeCell } from '@/utils/cellRenderer';

/** Round to max 2 decimal places, strip trailing zeros for display */
function r2(n: number | null | undefined): string {
  if (n == null) return '0';
  return String(parseFloat((Math.round(n * 100) / 100).toFixed(2)));
}

/** Read a CSS variable as an hsl() color string, with fallback. */
function cssVar(name: string, fallback: string): string {
  try {
    const val = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    if (!val) return fallback;
    const parts = val.split(/\s+/);
    if (parts.length === 3) return `hsl(${parts[0]}, ${parts[1]}, ${parts[2]})`;
    return `hsl(${val})`;
  } catch {
    return fallback;
  }
}

/** Build color palette from live CSS variables so theme changes are reflected in exports */
function buildPalette() {
  return {
    primary:   cssVar('--primary',    '#E86209'),
    bg:        cssVar('--background', '#FEFDFB'),
    card:      cssVar('--card',       '#FFFFFF'),
    border:    cssVar('--border',     '#EDE8DC'),
    fg:        cssVar('--foreground', '#000000'),
    muted:     cssVar('--muted-foreground', '#7A6E65'),
    mutedBg:   cssVar('--muted',      '#F5F0E8'),
    green:     '#16a34a',
    greenBg:   '#dcfce7',
    red:       '#dc2626',
    redBg:     '#fee2e2',
    amber:     '#d97706',
    amberBg:   '#fef9c3',
    white:     '#FFFFFF',
    indigo:    '#4f46e5',
    indigoBg:  '#e0e7ff',
    purple:    '#7c3aed',
    purpleBg:  '#ede9fe',
  };
}

const FONT = '"Inter", "Helvetica Neue", Arial, sans-serif';

function rr(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number, fill?: string, stroke?: string) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
  if (fill) { ctx.fillStyle = fill; ctx.fill(); }
  if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = 1; ctx.stroke(); }
}

function clip(str: string, max: number) {
  return str.length > max ? str.slice(0, max - 1) + '…' : str;
}

export interface ReportSummary {
  totalUsers: number;
  submitted?: number;
  missing?: number;
  chantingAvg?: number | null;
  readingAvg?: number | null;
  hearingAvg?: number | null;
  scorePercentAvg?: number | null;
}

export function exportReportAsImage(
  summary: ReportSummary | null,
  users: UserRow[],
  fieldDefs: FieldDef[],
  filename: string,
  avgPreachingMins?: number | null,
  avgBooksDistributed?: number | null,
  folkResidencyName?: string,
  ashrayLevelLabel?: string,
  dateLabel?: string,
  avgSleepMins?: number | null,
  /** 'resident' | 'non_resident' | 'all' — used for Avg Score % color thresholds */
  residencyFilter?: string,
  /** When false, hides the FOLK column */
  showFolkColumn?: boolean,
  /** 'daily' | 'weekly' | 'monthly' — used for dynamic title */
  reportType?: string,
) {
  const C = buildPalette();
  const _showFolk = showFolkColumn !== false;

  const PAD = 20;
  const COL_RANK = 36;
  const COL_NAME = 160;
  const COL_LEVEL = 64;
  const COL_FOLK = _showFolk ? 58 : 0;
  const COL_STREAK = 44;
  const COL_F = 70;
  const COL_TOT = 72;
  const ROW_H = 30;
  const TH_H = 38;
  const HDR_H = 62;
  const STATS_H = summary ? 100 : 0;

  const GROUP_H = 38; // group-header divider row height

  const tableW = COL_RANK + COL_NAME + COL_LEVEL + COL_FOLK + COL_STREAK + fieldDefs.length * COL_F + COL_TOT;
  const canvasW = Math.max(tableW + PAD * 2, 820);
  const totalRowHeight = users.reduce((sum, u) => sum + ((u as any)._groupHeader ? GROUP_H : ROW_H), 0);
  const canvasH = HDR_H + STATS_H + TH_H + totalRowHeight + PAD * 2 + 16;

  const _scaleByTotal = Math.floor(Math.sqrt(500_000_000 / (canvasW * canvasH)));
  const _scaleByDim   = Math.floor(Math.min(16384 / canvasW, 16384 / canvasH));
  const SCALE = Math.min(16, Math.max(3, Math.min(_scaleByTotal, _scaleByDim)));
  const canvas = document.createElement('canvas');
  canvas.width = canvasW * SCALE;
  canvas.height = canvasH * SCALE;
  const ctx = canvas.getContext('2d')!;
  ctx.scale(SCALE, SCALE);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';

  // ── Background ──────────────────────────────────────────────────────────────
  ctx.fillStyle = C.bg;
  ctx.fillRect(0, 0, canvasW, canvasH);

  // ── Header bar ──────────────────────────────────────────────────────────────
  ctx.fillStyle = C.primary;
  ctx.fillRect(0, 0, canvasW, HDR_H);

  const titlePrefix = reportType === 'daily' ? 'Daily' : reportType === 'weekly' ? 'Weekly' : reportType === 'monthly' ? 'Monthly' : '';
  const mainTitle = titlePrefix ? `${titlePrefix} Sadhana Report` : 'Sadhana Report';

  ctx.fillStyle = C.white;
  ctx.font = `bold 17px ${FONT}`;
  ctx.fillText(mainTitle, PAD, 26);

  const subtitleParts = [folkResidencyName, ashrayLevelLabel, dateLabel].filter(Boolean);
  if (subtitleParts.length > 0) {
    ctx.font = `bold 13px ${FONT}`;
    ctx.fillStyle = 'rgba(255,255,255,0.95)';
    ctx.fillText(subtitleParts.join(' · '), PAD, 48);
  }

  let y = HDR_H + PAD;

  // ── Summary stat cards ────────────────────────────────────────────────────
  if (summary) {
    function sbPtsToMinsLocal(pts: number): number { return pts <= 0 ? 0 : pts >= 2 ? 30 : 15; }

    const scoreVal = summary.scorePercentAvg ?? null;
    const isResidentContext = residencyFilter !== 'non_resident';
    const scoreGreenPct = isResidentContext ? 95 : 75;
    const scoreAmberPct = isResidentContext ? 85 : 50;
    const avgScoreColor = scoreVal == null
      ? C.fg
      : scoreVal >= scoreGreenPct ? C.green
      : scoreVal >= scoreAmberPct ? C.amber
      : C.red;

    const stats: { label: string; value: string; color: string }[] = [
      { label: 'Total Members',      value: String(summary.totalUsers ?? 0),                                                         color: C.fg },
      { label: 'Total Books',        value: avgBooksDistributed != null ? String(avgBooksDistributed) : '0',                         color: C.primary },
      { label: 'Total Preaching',    value: avgPreachingMins != null ? (() => { const h = Math.floor(avgPreachingMins / 60); const m = avgPreachingMins % 60; return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}`; })() : '00:00', color: C.primary },
      { label: 'Avg Rounds',          value: summary.chantingAvg != null ? String(r2(summary.chantingAvg)) : '0',                    color: C.primary },
      { label: 'Avg Reading',        value: summary.readingAvg != null ? (() => { const rm = Math.round(summary.readingAvg!); const rh = Math.floor(rm / 60); const rmm = rm % 60; return `${String(rh).padStart(2,'0')}:${String(rmm).padStart(2,'0')}`; })() : '00:00', color: C.primary },
      { label: 'Avg Hearing',        value: summary.hearingAvg != null ? (() => { const hm = Math.round(summary.hearingAvg!); const hh = Math.floor(hm / 60); const hmm = hm % 60; return `${String(hh).padStart(2,'0')}:${String(hmm).padStart(2,'0')}`; })() : ((summary as any).sbAvg != null ? (() => { const sm = sbPtsToMinsLocal((summary as any).sbAvg); const sh = Math.floor(sm / 60); const smm = sm % 60; return `${String(sh).padStart(2,'0')}:${String(smm).padStart(2,'0')}`; })() : '00:00'), color: C.primary },
      ...(avgSleepMins != null ? [{ label: 'Avg Sleep (hrs)', value: (() => { const h = Math.floor(avgSleepMins / 60); const m = avgSleepMins % 60; return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}`; })(), color: C.indigo }] : []),
      { label: 'Avg Score %',        value: scoreVal != null ? `${r2(scoreVal)}%` : '0%',                                           color: avgScoreColor },
    ];

    ctx.fillStyle = C.muted;
    ctx.font = `9px ${FONT}`;
    ctx.textAlign = 'left';
    const submittedNote = `Averages · ${summary.submitted ?? '?'} of ${summary.totalUsers ?? '?'} submitted`;
    ctx.fillText(submittedNote, PAD, y - 4);

    const CARD_H = 80;
    const cardW = Math.floor((canvasW - PAD * 2) / stats.length);
    stats.forEach((s, i) => {
      const sx = PAD + i * cardW;
      rr(ctx, sx, y, cardW - 6, CARD_H, 6, C.card, C.border);
      ctx.fillStyle = s.color;
      ctx.font = `bold 20px ${FONT}`;
      ctx.textAlign = 'center';
      ctx.fillText(s.value, sx + (cardW - 6) / 2, y + 40);
      ctx.fillStyle = C.muted;
      ctx.font = `bold 10px ${FONT}`;
      ctx.fillText(s.label, sx + (cardW - 6) / 2, y + 64);
    });
    ctx.textAlign = 'left';
    y += STATS_H;
  }

  // ── Table header row ─────────────────────────────────────────────────────────
  const tLeft = PAD;

  ctx.fillStyle = C.mutedBg;
  ctx.fillRect(tLeft, y, tableW, TH_H);
  ctx.strokeStyle = C.border;
  ctx.lineWidth = 1;
  ctx.strokeRect(tLeft, y, tableW, TH_H);

  ctx.fillStyle = C.muted;
  ctx.font = `bold 10px ${FONT}`;
  ctx.textAlign = 'center';
  ctx.fillText('#', tLeft + COL_RANK / 2, y + TH_H / 2 + 4);
  ctx.strokeStyle = C.border; ctx.lineWidth = 0.5;
  ctx.beginPath(); ctx.moveTo(tLeft + COL_RANK, y); ctx.lineTo(tLeft + COL_RANK, y + TH_H); ctx.stroke();

  ctx.fillStyle = C.fg;
  ctx.font = `bold 11px ${FONT}`;
  ctx.textAlign = 'left';
  ctx.fillText('Name', tLeft + COL_RANK + 8, y + TH_H / 2 + 4);

  ctx.strokeStyle = C.border; ctx.lineWidth = 0.5;
  ctx.beginPath(); ctx.moveTo(tLeft + COL_RANK + COL_NAME, y); ctx.lineTo(tLeft + COL_RANK + COL_NAME, y + TH_H); ctx.stroke();
  ctx.fillStyle = C.fg;
  ctx.font = `bold 10px ${FONT}`;
  ctx.textAlign = 'center';
  ctx.fillText('Level', tLeft + COL_RANK + COL_NAME + COL_LEVEL / 2, y + TH_H / 2 + 4);

  let hx = tLeft + COL_RANK + COL_NAME + COL_LEVEL;
  ctx.beginPath(); ctx.moveTo(hx, y); ctx.lineTo(hx, y + TH_H); ctx.stroke();

  if (_showFolk) {
    ctx.fillText('FOLK', hx + COL_FOLK / 2, y + TH_H / 2 + 4);
    hx += COL_FOLK;
    ctx.beginPath(); ctx.moveTo(hx, y); ctx.lineTo(hx, y + TH_H); ctx.stroke();
  }

  ctx.fillText('STK', hx + COL_STREAK / 2, y + TH_H / 2 + 4);

  let cx = hx + COL_STREAK;
  fieldDefs.forEach(d => {
    ctx.fillStyle = C.fg;
    ctx.font = `bold 10px ${FONT}`;
    ctx.textAlign = 'center';
    const showMax = d.maxPoints != null && (d.forResident || d.forNR);
    ctx.fillText(d.shortLabel, cx + COL_F / 2, y + (showMax ? 15 : TH_H / 2 + 4));
    if (showMax) {
      ctx.fillStyle = C.muted;
      ctx.font = `9px ${FONT}`;
      ctx.fillText(`/${d.maxPoints}`, cx + COL_F / 2, y + 28);
    }
    ctx.strokeStyle = C.border;
    ctx.lineWidth = 0.5;
    ctx.beginPath(); ctx.moveTo(cx, y); ctx.lineTo(cx, y + TH_H); ctx.stroke();
    cx += COL_F;
  });

  ctx.fillStyle = C.fg;
  ctx.font = `bold 11px ${FONT}`;
  ctx.fillText('Total %', cx + COL_TOT / 2, y + TH_H / 2 + 4);
  ctx.textAlign = 'left';
  y += TH_H;

  // ── Data rows ────────────────────────────────────────────────────────────────
  let ry = y;
  users.forEach((user) => {
    const isGroupHeader = !!(user as any)._groupHeader;
    const rowH = isGroupHeader ? GROUP_H : ROW_H;

    if (isGroupHeader) {
      // Draw group-header divider band
      ctx.globalAlpha = 0.10;
      ctx.fillStyle = C.primary;
      ctx.fillRect(tLeft, ry, tableW, rowH);
      ctx.globalAlpha = 1;

      // Left accent bar
      ctx.fillStyle = C.primary;
      ctx.fillRect(tLeft, ry, 4, rowH);

      // Level name
      ctx.fillStyle = C.primary;
      ctx.font = `bold 12px ${FONT}`;
      ctx.textAlign = 'left';
      ctx.fillText(`✨ ${(user as any)._groupHeader}`, tLeft + 12, ry + rowH / 2 + 4);

      // Group stats
      const gs = (user as any)._groupStats as { count: number; submitted: number; avgScore: number | null } | undefined;
      if (gs) {
        const avgText = gs.avgScore !== null ? ` · Avg: ${gs.avgScore}%` : '';
        ctx.fillStyle = C.muted;
        ctx.font = `10px ${FONT}`;
        ctx.fillText(`${gs.count} members · ${gs.submitted} submitted${avgText}`, tLeft + 200, ry + rowH / 2 + 4);
      }

      // Bottom border
      ctx.strokeStyle = C.border;
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(tLeft, ry + rowH); ctx.lineTo(tLeft + tableW, ry + rowH); ctx.stroke();

      ry += rowH;
      return;
    }

    // Normal user data row continues below...

    const rowBg = C.card;
    ctx.fillStyle = rowBg;
    ctx.fillRect(tLeft, ry, tableW, ROW_H);
    ctx.strokeStyle = C.border;
    ctx.lineWidth = 0.5;
    ctx.strokeRect(tLeft, ry, tableW, ROW_H);

    // Rank cell
    ctx.strokeStyle = C.border; ctx.lineWidth = 0.5;
    ctx.beginPath(); ctx.moveTo(tLeft + COL_RANK, ry); ctx.lineTo(tLeft + COL_RANK, ry + ROW_H); ctx.stroke();
    const rankPct = typeof user.scorePercent === 'number' ? user.scorePercent : null;
    const rankGreenPct = user.isResident ? 95 : 75;
    const rankAmberPct = user.isResident ? 85 : 50;
    if (user.submitted && rankPct != null) {
      const rankBg = rankPct >= rankGreenPct ? C.greenBg : rankPct >= rankAmberPct ? C.amberBg : C.redBg;
      const rankFg = rankPct >= rankGreenPct ? C.green : rankPct >= rankAmberPct ? C.amber : C.red;
      ctx.fillStyle = rankBg;
      ctx.fillRect(tLeft, ry, COL_RANK, ROW_H);
      ctx.fillStyle = rankFg;
    } else {
      ctx.fillStyle = C.muted;
    }
    ctx.font = `bold 10px ${FONT}`;
    ctx.textAlign = 'center';
    const rankVal = user.submitted && (user as any).rank != null ? String((user as any).rank) : '';
    ctx.fillText(rankVal, tLeft + COL_RANK / 2, ry + ROW_H / 2 + 4);

    // Name cell — bold (matching dashboard)
    ctx.fillStyle = user.submitted ? C.fg : '#999999';
    ctx.font = `bold 11px ${FONT}`;
    ctx.textAlign = 'left';
    const hasSickOs = user.flagSick || user.flagOs;
    const isScholar = !!(user as any).isTempResident;
    const nameMaxChars = (hasSickOs || isScholar) ? 18 : 24;
    ctx.fillText(clip(user.fullName, nameMaxChars), tLeft + COL_RANK + 8, ry + ROW_H / 2 + 4);
    if (!user.submitted) {
      ctx.fillStyle = C.red;
      ctx.font = `bold 8px ${FONT}`;
      ctx.fillText('MISSING', tLeft + COL_RANK + 8, ry + ROW_H - 5);
    }

    // R / NR inline badge (only when FOLK column is shown = "All" filter is active)
    if (_showFolk) {
      const isRes = user.isResident;
      const abbrName = isRes ? 'R' : 'NR';
      ctx.font = `bold 8px ${FONT}`;
      const badgeText = abbrName;
      const bw = ctx.measureText(badgeText).width + 8;
      // Position badge below name, left-aligned
      const bx = tLeft + COL_RANK + 8;
      const by = ry + ROW_H - 13;
      const badgeBg = isRes ? C.greenBg : C.mutedBg;
      const badgeFg = isRes ? C.green : C.muted;
      rr(ctx, bx, by, bw, 11, 2, badgeBg);
      ctx.fillStyle = badgeFg;
      ctx.textAlign = 'center';
      ctx.fillText(badgeText, bx + bw / 2, by + 8);
      ctx.textAlign = 'left';
    }

    if (isScholar && !hasSickOs) {
      ctx.font = `bold 8px ${FONT}`;
      const badge = 'SCHLR';
      const bw = ctx.measureText(badge).width + 8;
      const bx = tLeft + COL_RANK + COL_NAME - bw - 4;
      const by = ry + 7;
      rr(ctx, bx, by, bw, 14, 3, C.indigoBg);
      ctx.fillStyle = C.indigo;
      ctx.textAlign = 'center';
      ctx.fillText(badge, bx + bw / 2, by + 10);
      ctx.textAlign = 'left';
    }
    if (hasSickOs) {
      const badge = user.flagSick && user.flagOs ? 'SICK·OS' : user.flagSick ? 'SICK' : 'OS';
      const badgeBg = user.flagSick ? C.redBg : C.amberBg;
      const badgeFg = user.flagSick ? C.red : C.amber;
      ctx.font = `bold 8px ${FONT}`;
      const bw = ctx.measureText(badge).width + 8;
      const bx = tLeft + COL_RANK + COL_NAME - bw - 4;
      const by = ry + 7;
      rr(ctx, bx, by, bw, 14, 3, badgeBg);
      ctx.fillStyle = badgeFg;
      ctx.textAlign = 'center';
      ctx.fillText(badge, bx + bw / 2, by + 10);
      ctx.textAlign = 'left';
    }

    ctx.strokeStyle = C.border; ctx.lineWidth = 0.5;
    ctx.beginPath(); ctx.moveTo(tLeft + COL_RANK + COL_NAME, ry); ctx.lineTo(tLeft + COL_RANK + COL_NAME, ry + ROW_H); ctx.stroke();
    ctx.fillStyle = (!user.submitted || !user.ashrayLevel) ? C.muted : C.fg;
    ctx.font = `10px ${FONT}`;
    ctx.textAlign = 'center';
    ctx.fillText(clip(user.ashrayLevel || '—', 10), tLeft + COL_RANK + COL_NAME + COL_LEVEL / 2, ry + ROW_H / 2 + 4);

    let rowX = tLeft + COL_RANK + COL_NAME + COL_LEVEL;
    ctx.beginPath(); ctx.moveTo(rowX, ry); ctx.lineTo(rowX, ry + ROW_H); ctx.stroke();

    if (_showFolk) {
      const folkDisplay = user.residencyName || (user.isResident ? 'Res.' : 'NR');
      ctx.fillStyle = user.residencyName ? C.primary : (user.isResident ? C.primary : C.muted);
      ctx.font = `10px ${FONT}`;
      ctx.fillText(clip(folkDisplay, 8), rowX + COL_FOLK / 2, ry + ROW_H / 2 + 4);
      rowX += COL_FOLK;
      ctx.beginPath(); ctx.moveTo(rowX, ry); ctx.lineTo(rowX, ry + ROW_H); ctx.stroke();
    }

    const streak = (user as any).currentStreak ?? 0;
    ctx.fillStyle = streak > 0 ? '#ea580c' : C.muted;
    ctx.font = streak > 0 ? `bold 11px ${FONT}` : `10px ${FONT}`;
    ctx.fillText(streak > 0 ? String(streak) : '—', rowX + COL_STREAK / 2, ry + ROW_H / 2 + 4);

    // ── Field cells — via shared SSOT computeCell() ──────────────────────────
    let fcx = rowX + COL_STREAK;
    fieldDefs.forEach(d => {
      ctx.strokeStyle = C.border;
      ctx.lineWidth = 0.5;
      ctx.beginPath(); ctx.moveTo(fcx, ry); ctx.lineTo(fcx, ry + ROW_H); ctx.stroke();

      const { displayText, colorType } = computeCell(user, d, false);

      // Map colorType → canvas fill + text color
      let cellBg: string | null = null;
      let textColor: string = C.fg;

      switch (colorType) {
        case 'green':     cellBg = C.greenBg;   textColor = C.green;   break;
        case 'amber':     cellBg = C.amberBg;   textColor = C.amber;   break;
        case 'red':       cellBg = C.redBg;     textColor = C.red;     break;
        case 'purple':    cellBg = C.purpleBg;  textColor = C.purple;  break;
        case 'greenText': textColor = C.green;                          break;
        case 'amberText': textColor = C.amber;                          break;
        case 'muted':     cellBg = C.mutedBg;   textColor = C.muted;   break;
        case 'na':        cellBg = C.mutedBg;   textColor = C.muted;   break;
        case 'neutral':   textColor = C.fg;                             break;
        case 'none':      textColor = C.muted;                          break;
      }

      if (cellBg) { ctx.fillStyle = cellBg; ctx.fillRect(fcx, ry, COL_F, ROW_H); }

      ctx.fillStyle = textColor;
      ctx.font = (colorType === 'green' || colorType === 'purple' || colorType === 'greenText') ? `bold 11px ${FONT}` : `11px ${FONT}`;
      ctx.textAlign = 'center';
      ctx.fillText(displayText, fcx + COL_F / 2, ry + ROW_H / 2 + 4);

      fcx += COL_F;
    });

    ctx.strokeStyle = C.border;
    ctx.lineWidth = 0.5;
    ctx.beginPath(); ctx.moveTo(fcx, ry); ctx.lineTo(fcx, ry + ROW_H); ctx.stroke();

    // Total % cell
    const pct = typeof user.scorePercent === 'number' ? user.scorePercent : null;
    const greenPct = user.isResident ? 95 : 75;
    const amberPct = user.isResident ? 85 : 50;
    const pctBg = pct == null ? C.card : pct >= greenPct ? C.greenBg : pct >= amberPct ? C.amberBg : C.redBg;
    const pctFg = pct == null ? C.muted : pct >= greenPct ? C.green : pct >= amberPct ? C.amber : C.red;
    ctx.fillStyle = pctBg;
    ctx.fillRect(fcx, ry, COL_TOT, ROW_H);
    ctx.fillStyle = pctFg;
    ctx.font = `bold 11px ${FONT}`;
    ctx.textAlign = 'center';
    ctx.fillText(pct != null ? `${pct}%` : '', fcx + COL_TOT / 2, ry + ROW_H / 2 + 4);
    ctx.textAlign = 'left';

    ry += ROW_H;
  });

  // ── Footer line ──────────────────────────────────────────────────────────────
  const footerY = ry + 10;
  ctx.fillStyle = C.muted;
  ctx.font = `9px ${FONT}`;
  ctx.fillText('Prabhupada World Academy', PAD, footerY);

  // ── Download ─────────────────────────────────────────────────────────────────
  try {
    const link = document.createElement('a');
    link.download = filename;
    link.href = canvas.toDataURL('image/png');
    link.click();
  } catch (err) {
    console.warn('exportReportImage: toDataURL failed, trying toBlob fallback', err);
    try {
      canvas.toBlob(blob => {
        if (!blob) return;
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.download = filename;
        link.href = url;
        link.click();
        setTimeout(() => URL.revokeObjectURL(url), 10000);
      }, 'image/png');
    } catch (e2) {
      console.error('exportReportImage: export failed entirely', e2);
    }
  }
}
