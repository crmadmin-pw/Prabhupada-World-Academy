import { Config } from '@/lib/backend-sdk';
import { ASHRAY_LEVELS } from '@/types/enums';
import { emptyPwTargets, pwTarget, pwTime, readPwTargets, withLegacyTargets, type PwTargets } from '@/lib/pwSadhana';

export const PW_ASHRAYA_CONFIG_KEY = 'pw_ashraya_targets';
export type PwTargetSource = 'rgf' | 'admin' | 'mentor' | 'ashraya';

export interface PwAshrayaConfig {
  submissionDeadline: string;
  levels: Record<string, PwTargets>;
}

function refs(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(refs);
  if (value == null || value === '') return [];
  return String(value).split(',').map(item => item.trim().toLowerCase()).filter(Boolean);
}

function roleText(user: any): string {
  return String(user?.role || '').toUpperCase().replace(/[\s-]+/g, '_');
}

export function isPwAdmin(user: any): boolean {
  const role = roleText(user);
  return !!(user?.isBvAdmin || user?.isBvSuperAdmin || user?.isPwAdmin || ['ADMIN', 'SUPER_ADMIN', 'PW_ADMIN'].includes(role));
}

export function isPwRgf(user: any): boolean {
  const role = roleText(user);
  return !!(user?.isBvFacilitator || user?.isBvsl || ['RGF', 'FACILITATOR', 'BVSL'].includes(role));
}

export function isPwRgsf(user: any): boolean {
  const role = roleText(user);
  return !!(user?.isBvSubFacilitator || user?.isRgsf || role.includes('RGSF'));
}

export function isPwSupervisor(user: any): boolean {
  return !!(user?.isBvSupervisor || roleText(user).includes('SUPERVISOR'));
}

export function hasSadhanaMentor(user: any): boolean {
  return refs(user?.sadhanaMentor).length > 0;
}

export function isAssignedSadhanaMentor(actor: any, member: any): boolean {
  if (!actor?.isSadhanaMentor && roleText(actor) !== 'SADHANA_MENTOR') return false;
  const keys = new Set(refs([actor?.id, actor?.userId, actor?.email, actor?.uid]));
  return refs(member?.sadhanaMentor).some(ref => keys.has(ref));
}

/** Who the member's targets come from. Staff is checked before group membership. */
export function pwTargetSource(member: any, inBvGroup = false): PwTargetSource {
  if (isPwRgf(member) || isPwSupervisor(member)) return 'admin';
  if (isPwRgsf(member) || member?.isBvMember || member?.bvGroupId || inBvGroup) return 'rgf';
  if (hasSadhanaMentor(member)) return 'mentor';
  return 'ashraya';
}

export function canSetPwTargets(actor: any, member: any, inBvGroup = false): { allowed: boolean; source: PwTargetSource; message: string } {
  const source = pwTargetSource(member, inBvGroup);
  if (source === 'rgf') {
    return {
      allowed: isPwRgf(actor) || isPwAdmin(actor),
      source,
      message: 'An RGF sets sadhana targets for BV members and RGSFs',
    };
  }
  if (source === 'admin') {
    return {
      allowed: isPwAdmin(actor),
      source,
      message: 'An admin sets sadhana targets for RGFs and supervisors',
    };
  }
  if (source === 'mentor') {
    return {
      allowed: isAssignedSadhanaMentor(actor, member),
      source,
      message: 'The assigned sadhana mentor sets this member\'s targets',
    };
  }
  return {
    allowed: false,
    source,
    message: 'This member is scored from the Ashraya-level targets set by the admin',
  };
}

export function defaultAshrayaConfig(): PwAshrayaConfig {
  return {
    submissionDeadline: '10:00',
    levels: Object.fromEntries(ASHRAY_LEVELS.map(level => [level, emptyPwTargets()])),
  };
}

export function parseAshrayaConfig(value: unknown): PwAshrayaConfig {
  const fallback = defaultAshrayaConfig();
  let parsed: any = value;
  if (typeof value === 'string') {
    try { parsed = JSON.parse(value); } catch { return fallback; }
  }
  if (!parsed || typeof parsed !== 'object') return fallback;
  const levels = { ...fallback.levels };
  const incoming = parsed.levels && typeof parsed.levels === 'object' ? parsed.levels : {};
  for (const level of ASHRAY_LEVELS) {
    levels[level] = readPwTargets(incoming[level]);
  }
  return {
    submissionDeadline: pwTime(parsed.submissionDeadline) || '10:00',
    levels,
  };
}

export async function loadAshrayaConfig(): Promise<PwAshrayaConfig> {
  const existing = await Config.findOne({ filters: { configKey: PW_ASHRAYA_CONFIG_KEY }, fields: ['id', 'configKey', 'configValue'] });
  return parseAshrayaConfig(existing?.configValue);
}

export async function saveAshrayaConfig(config: PwAshrayaConfig, updatedBy: string) {
  const normalized = parseAshrayaConfig(config);
  const record = {
    configKey: PW_ASHRAYA_CONFIG_KEY,
    configValue: JSON.stringify({ ...normalized, updatedAt: new Date().toISOString(), updatedBy }),
  };
  const existing = await Config.findOne({ filters: { configKey: PW_ASHRAYA_CONFIG_KEY }, fields: ['id'] });
  if (existing?.id) await Config.update({ id: existing.id, record });
  else await Config.create({ record });
  return normalized;
}

export async function resolvePwTargetsForUser(user: any, inBvGroup = false): Promise<{
  source: PwTargetSource;
  targets: PwTargets;
  deadline: string;
  setByRole: string | null;
}> {
  const source = pwTargetSource(user, inBvGroup);
  const config = await loadAshrayaConfig();
  let targets = emptyPwTargets();
  let setByRole: string | null = null;
  if (source === 'ashraya') {
    const level = String(user?.ashrayLevel || 'Jigyasa');
    targets = config.levels[level] || emptyPwTargets();
    setByRole = 'ashraya';
  } else {
    const stored = user?.pwTargets;
    const role = stored && typeof stored === 'object' ? String(stored.setByRole || '') : '';
    if (!role || role === source) {
      targets = readPwTargets(stored);
      setByRole = role || null;
    }
  }
  return {
    source,
    targets: withLegacyTargets(targets, user),
    deadline: '10:00',
    setByRole,
  };
}

export function legacyTargetNumbers(targets: PwTargets) {
  return {
    pwChantingTarget: pwTarget(targets.chanting),
    pwReadingTarget: pwTarget(targets.readingMin),
  };
}
