import { createHash } from 'crypto';
import {
  BvGroupMembers,
  BvGroups,
  BvMemberRegistrations,
  FolkResidencies,
  Guides,
  Users,
  AppError,
  getFirestoreDb,
} from '@/lib/backend-sdk';
import { normalizeApiRole, type ApiUserContext } from '@/lib/apiAuthorization';
import { getGuideScope } from '@/lib/guideScope';
import { resolveGuideReference } from '@/lib/guideResolution';
import {
  BULK_USER_ASHRAY_LEVELS,
  BULK_USER_COUNTRY_CODES,
  BULK_USER_CSV_HEADERS,
  BULK_USER_GENDERS,
  BULK_USER_MAX_RECORDS,
  BULK_USER_REQUIRED_HEADERS,
  BULK_USER_TIME_PREFERENCES,
} from '@/config/bulkUserCsv';

type RowDisposition = 'new' | 'existing' | 'invalid';

export interface BulkUserRowResult {
  rowNumber: number;
  status: RowDisposition;
  email: string;
  fullName: string;
  errors: string[];
  existingUserId?: string;
  normalized?: NormalizedBulkUser;
}

export interface NormalizedBulkUser {
  email: string;
  fullName: string;
  phoneCountryCode: string;
  phone: string;
  phoneE164: string;
  selectedFolkResidency: string;
  residencyUserClaim: boolean;
  residencyJoinDate: string;
  ashrayLevel: string;
  whatsappCountryCode: string;
  whatsappNumber: string;
  whatsappE164: string;
  address: string;
  occupation: string;
  companyName: string;
  dob: string;
  gender: 'Male' | 'Female' | 'Other';
  dailyChantingRounds: number;
  weeklyReadingHours: number;
  weeklyHearingHours: number;
  inTouchWithTemple: boolean;
  templeName: string;
  devoteeName: string;
  timePreference: string;
}

export interface BulkUserPreview {
  totalRecords: number;
  newUsers: number;
  existingUsers: number;
  invalidRecords: number;
  rows: BulkUserRowResult[];
}

const normalizeText = (value: unknown) => String(value ?? '').trim();
const normalizeEmail = (value: unknown) => normalizeText(value).toLowerCase();
const normalizePhone = (countryCode: unknown, phone: unknown) =>
  `${normalizeText(countryCode).replace(/[^+\d]/g, '')}${normalizeText(phone).replace(/\D/g, '')}`.replace(/\D/g, '');
const phoneKeys = (value: unknown): string[] => {
  const digits = normalizeText(value).replace(/\D/g, '');
  return [...new Set([digits, digits.length >= 10 ? digits.slice(-10) : ''].filter(Boolean))];
};
const refValues = (value: unknown): string[] => (Array.isArray(value) ? value : value == null ? [] : [value])
  .flatMap(item => String(item).split(','))
  .map(item => item.trim().toLowerCase())
  .filter(Boolean);
const optionKey = (value: unknown) => normalizeText(value).toLowerCase().replace(/[–—]/g, '-').replace(/\s+/g, ' ');
const canonicalOption = <T extends readonly string[]>(value: unknown, options: T): T[number] | '' =>
  options.find(option => optionKey(option) === optionKey(value)) || '';

function parseBoolean(value: unknown, field: string, errors: string[]): boolean {
  const normalized = normalizeText(value).toLowerCase();
  if (['yes', 'true', '1', 'y'].includes(normalized)) return true;
  if (['no', 'false', '0', 'n'].includes(normalized)) return false;
  errors.push(`${field} must be Yes or No`);
  return false;
}

function isValidDob(value: string): boolean {
  const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(value);
  if (!match) return false;
  const [, day, month, year] = match;
  const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
  return date.getUTCFullYear() === Number(year) && date.getUTCMonth() === Number(month) - 1 && date.getUTCDate() === Number(day) && date <= new Date();
}

function isValidIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

async function findAll(table: { findAll(input: any): Promise<{ records: any[]; hasMore: boolean }> }, fields?: string[]): Promise<any[]> {
  const records: any[] = [];
  const limit = 2000;
  for (let offset = 0; offset < 100_000; offset += limit) {
    const result = await table.findAll({ fields, limit, offset });
    records.push(...(result.records || []));
    if (!result.hasMore) break;
  }
  return records;
}

export async function requireBulkUserManager(user: ApiUserContext | null) {
  if (!user || !user.isActive) throw new AppError({ code: 'UNAUTHORIZED', message: 'Authentication required' });
  const role = normalizeApiRole(user.role);
  if (!['GUIDE', 'SUPER_GUIDE', 'SUPER_ADMIN'].includes(role) || String(user.segment || '').toUpperCase() === 'PW') {
    throw new AppError({ code: 'FORBIDDEN', message: 'Only active FOLK Guides and FOLK Super Guides can manage bulk users' });
  }
  const guideScope = await getGuideScope(user.email);
  if (!guideScope?.guideId) throw new AppError({ code: 'FORBIDDEN', message: 'Your active FOLK Guide profile could not be resolved' });
  // Use the same canonical ID advertised by getGuides/registerUser. This is a
  // Guides document ID when one exists, otherwise the caller's Users document
  // ID (not a legacy userId alias).
  const canonicalGuide = await resolveGuideReference(user.email);
  const canonicalScope = canonicalGuide?.id
    ? { ...guideScope, guideId: canonicalGuide.id, guideName: canonicalGuide.fullName || guideScope.guideName }
    : guideScope;
  return { user, role, guideScope: canonicalScope, isSuperGuide: ['SUPER_GUIDE', 'SUPER_ADMIN'].includes(role) };
}

function validateHeaders(headers: string[]): string[] {
  const errors: string[] = [];
  const missing = BULK_USER_REQUIRED_HEADERS.filter(header => !headers.includes(header));
  const unknown = headers.filter(header => !BULK_USER_CSV_HEADERS.includes(header as any));
  if (missing.length) errors.push(`Missing required columns: ${missing.join(', ')}`);
  if (unknown.length) errors.push(`Unknown columns: ${unknown.join(', ')}`);
  return errors;
}

export async function previewBulkUsers(headers: string[], rawRows: Record<string, string>[]): Promise<BulkUserPreview> {
  if (rawRows.length === 0) throw new AppError({ code: 'BAD_REQUEST', message: 'The CSV contains no user records' });
  if (rawRows.length > BULK_USER_MAX_RECORDS) throw new AppError({ code: 'BAD_REQUEST', message: `A maximum of ${BULK_USER_MAX_RECORDS} users can be imported at once` });
  const headerErrors = validateHeaders(headers);
  if (headerErrors.length) throw new AppError({ code: 'BAD_REQUEST', message: headerErrors.join('. ') });

  const [residencies, existingUsers] = await Promise.all([
    findAll(FolkResidencies, ['id', 'residencyId', 'residencyName']),
    findAll(Users, ['id', 'userId', 'email', 'phone', 'role', 'segment']),
  ]);
  const residencyByRef = new Map<string, string>();
  for (const residency of residencies) {
    for (const ref of [residency.id, residency.residencyId, residency.residencyName]) {
      if (ref) residencyByRef.set(String(ref).trim().toLowerCase(), String(residency.id));
    }
  }

  const existingByEmail = new Map<string, any>();
  const existingByPhone = new Map<string, any>();
  for (const existing of existingUsers) {
    const email = normalizeEmail(existing.email);
    if (email) existingByEmail.set(email, existing);
    for (const phone of phoneKeys(existing.phone)) existingByPhone.set(phone, existing);
  }

  const csvEmailCount = new Map<string, number>();
  const csvPhoneCount = new Map<string, number>();
  for (const rawRow of rawRows) {
    const email = normalizeEmail(rawRow.email);
    const phone = normalizePhone(rawRow.phoneCountryCode, rawRow.phone);
    if (email) csvEmailCount.set(email, (csvEmailCount.get(email) || 0) + 1);
    for (const key of phoneKeys(phone)) csvPhoneCount.set(key, (csvPhoneCount.get(key) || 0) + 1);
  }

  const rows: BulkUserRowResult[] = rawRows.map((raw, index) => {
    const errors: string[] = [];
    for (const field of BULK_USER_REQUIRED_HEADERS) {
      if (!normalizeText(raw[field])) errors.push(`${field} is required`);
    }

    const email = normalizeEmail(raw.email);
    const fullName = normalizeText(raw.fullName);
    const phoneCountryCode = normalizeText(raw.phoneCountryCode);
    const phone = normalizeText(raw.phone).replace(/\D/g, '');
    const phoneE164 = normalizePhone(phoneCountryCode, phone);
    const whatsappCountryCode = normalizeText(raw.whatsappCountryCode);
    const whatsappNumber = normalizeText(raw.whatsappNumber).replace(/\D/g, '');
    const whatsappE164 = normalizePhone(whatsappCountryCode, whatsappNumber);
    const residencyRef = normalizeText(raw.selectedFolkResidency);
    const selectedFolkResidency = residencyByRef.get(residencyRef.toLowerCase()) || '';
    const residencyUserClaim = parseBoolean(raw.residencyUserClaim, 'residencyUserClaim', errors);
    const residencyJoinDate = normalizeText(raw.residencyJoinDate);
    const inTouchWithTemple = parseBoolean(raw.inTouchWithTemple, 'inTouchWithTemple', errors);
    const ashrayLevel = canonicalOption(raw.ashrayLevel, BULK_USER_ASHRAY_LEVELS);
    const dob = normalizeText(raw.dob);
    const gender = canonicalOption(raw.gender, BULK_USER_GENDERS) as NormalizedBulkUser['gender'];
    const dailyChantingRounds = Number(normalizeText(raw.dailyChantingRounds));
    const weeklyReadingHours = Number(normalizeText(raw.weeklyReadingHours));
    const weeklyHearingHours = Number(normalizeText(raw.weeklyHearingHours));
    const timePreference = canonicalOption(raw.timePreference, BULK_USER_TIME_PREFERENCES);

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 320) errors.push('email is invalid');
    if (fullName.length > 200) errors.push('fullName must be 200 characters or fewer');
    if (!/^\+\d{1,4}$/.test(phoneCountryCode)) errors.push('phoneCountryCode must look like +91');
    else if (!BULK_USER_COUNTRY_CODES.includes(phoneCountryCode as any)) errors.push('phoneCountryCode is not available in the registration forms');
    if (phone.length < 7 || phone.length > 15) errors.push('phone must contain 7 to 15 digits');
    if (phoneCountryCode === '+91' && (phone.length !== 10 || !/^[6-9]/.test(phone))) errors.push('Indian phone must be 10 digits and start with 6, 7, 8, or 9');
    if (!/^\+\d{1,4}$/.test(whatsappCountryCode)) errors.push('whatsappCountryCode must look like +91');
    else if (!BULK_USER_COUNTRY_CODES.includes(whatsappCountryCode as any)) errors.push('whatsappCountryCode is not available in the Bhakti Vriksha form');
    if (whatsappNumber.length !== 10) errors.push('whatsappNumber must contain exactly 10 digits');
    if (!selectedFolkResidency) errors.push('selectedFolkResidency does not match an existing FOLK center ID or name');
    if (residencyUserClaim && !isValidIsoDate(residencyJoinDate)) errors.push('residencyJoinDate must be a valid YYYY-MM-DD date for residents');
    if (residencyJoinDate && !isValidIsoDate(residencyJoinDate)) errors.push('residencyJoinDate must use YYYY-MM-DD');
    if (!BULK_USER_ASHRAY_LEVELS.includes(ashrayLevel as any) || ashrayLevel === 'None') errors.push('ashrayLevel must match the Create Your Account form');
    if (!isValidDob(dob)) errors.push('dob must be a valid past date in DD/MM/YYYY format');
    if (!BULK_USER_GENDERS.includes(gender as any)) errors.push('gender must be Male, Female, or Other');
    if (!Number.isInteger(dailyChantingRounds) || dailyChantingRounds < 0 || dailyChantingRounds > 192) errors.push('dailyChantingRounds must be a whole number from 0 to 192');
    if (!Number.isFinite(weeklyReadingHours) || weeklyReadingHours < 0) errors.push('weeklyReadingHours must be zero or a positive number of minutes');
    if (!Number.isFinite(weeklyHearingHours) || weeklyHearingHours < 0) errors.push('weeklyHearingHours must be zero or a positive number of minutes');
    if (!BULK_USER_TIME_PREFERENCES.includes(timePreference as any)) errors.push('timePreference does not match an option in the Bhakti Vriksha form');
    if (normalizeText(raw.address).length > 500) errors.push('address must be 500 characters or fewer');
    if (!/^[A-Za-z\s.-]+$/.test(normalizeText(raw.occupation)) || normalizeText(raw.occupation).length > 200) errors.push('occupation must contain letters only and be 200 characters or fewer');
    if (!/^[A-Za-z\s.-]+$/.test(normalizeText(raw.companyName)) || normalizeText(raw.companyName).length > 200) errors.push('companyName must contain letters only and be 200 characters or fewer');
    if (normalizeText(raw.templeName).length > 200) errors.push('templeName must be 200 characters or fewer');
    if (normalizeText(raw.devoteeName).length > 200) errors.push('devoteeName must be 200 characters or fewer');
    if (inTouchWithTemple && !normalizeText(raw.templeName)) errors.push('templeName is required when inTouchWithTemple is Yes');
    if (inTouchWithTemple && !normalizeText(raw.devoteeName)) errors.push('devoteeName is required when inTouchWithTemple is Yes');
    if (csvEmailCount.get(email)! > 1) errors.push('Duplicate email inside this CSV');
    if (phoneKeys(phoneE164).some(key => (csvPhoneCount.get(key) || 0) > 1)) errors.push('Duplicate phone number inside this CSV');

    const emailMatch = existingByEmail.get(email);
    const phoneMatch = phoneKeys(phoneE164).map(key => existingByPhone.get(key)).find(Boolean);
    if (emailMatch && phoneMatch && emailMatch.id !== phoneMatch.id) {
      errors.push('Email and phone number belong to different existing users');
    }

    const existing = emailMatch || phoneMatch;
    const normalized: NormalizedBulkUser = {
      email, fullName, phoneCountryCode, phone, phoneE164,
      selectedFolkResidency, residencyUserClaim, residencyJoinDate, ashrayLevel,
      whatsappCountryCode, whatsappNumber, whatsappE164,
      address: normalizeText(raw.address), occupation: normalizeText(raw.occupation), companyName: normalizeText(raw.companyName),
      dob, gender, dailyChantingRounds, weeklyReadingHours, weeklyHearingHours,
      inTouchWithTemple, templeName: normalizeText(raw.templeName), devoteeName: normalizeText(raw.devoteeName), timePreference,
    };

    return {
      rowNumber: index + 2,
      status: errors.length ? 'invalid' : existing ? 'existing' : 'new',
      email,
      fullName,
      errors,
      ...(existing ? { existingUserId: existing.userId || existing.id } : {}),
      normalized,
    };
  });

  return {
    totalRecords: rows.length,
    newUsers: rows.filter(row => row.status === 'new').length,
    existingUsers: rows.filter(row => row.status === 'existing').length,
    invalidRecords: rows.filter(row => row.status === 'invalid').length,
    rows,
  };
}

function userDocumentId(email: string): string {
  return `USER-${createHash('sha256').update(email).digest('hex').slice(0, 32)}`;
}

function appUserId(index: number): string {
  return `USER-${Date.now() * 1000 + index}`;
}

export async function createBulkUser(row: NormalizedBulkUser, manager: Awaited<ReturnType<typeof requireBulkUserManager>>, index: number) {
  const now = new Date().toISOString();
  const userDbId = userDocumentId(row.email);
  const userId = appUserId(index);
  const userRecord = {
    id: userDbId,
    userId,
    fullName: row.fullName,
    phone: row.phoneE164,
    email: row.email,
    guide: manager.guideScope.guideId,
    residency: row.selectedFolkResidency,
    role: 'User',
    status: 'Active',
    residencyClaimed: row.residencyUserClaim,
    residencyApproved: row.residencyUserClaim,
    residencyJoinDate: row.residencyJoinDate || null,
    ashrayLevel: row.ashrayLevel,
    bvServiceAllocated: false,
    isPrabhupadaWorldUser: false,
    segment: 'FOLK',
    bvRegistrationStatus: 'Approved',
    isBvMember: false,
    isBvAdmin: false,
    isBvSuperAdmin: false,
    isBvSupervisor: false,
    isBvMentor: false,
    isBvFacilitator: false,
    isBvSubFacilitator: false,
    isBvsl: false,
    createdAt: now,
    statusChangedAt: now,
  };
  const registrationRecord = {
    id: `BVREG-${userDbId}`,
    userId,
    userDbId,
    email: row.email,
    fullName: row.fullName,
    phoneCountryCode: row.phoneCountryCode,
    phone: row.phone,
    phoneE164: row.phoneE164,
    whatsappCountryCode: row.whatsappCountryCode,
    whatsappNumber: row.whatsappNumber,
    whatsappE164: row.whatsappE164,
    address: row.address,
    occupation: row.occupation,
    companyName: row.companyName,
    dob: row.dob,
    gender: row.gender,
    dailyChantingRounds: String(row.dailyChantingRounds),
    weeklyReadingHours: `${row.weeklyReadingHours} mins`,
    weeklyHearingHours: `${row.weeklyHearingHours} mins`,
    ashrayLevel: row.ashrayLevel,
    pwClassesAttending: 'None',
    inTouchWithTemple: row.inTouchWithTemple,
    templeName: row.inTouchWithTemple ? row.templeName : '',
    devoteeName: row.inTouchWithTemple ? row.devoteeName : '',
    timePreference: row.timePreference,
    isPrabhupadaWorldUser: false,
    segment: 'FOLK',
    status: 'Approved',
    submittedAt: now,
    approvedAt: now,
    approvedBy: manager.user.id,
    assignedGroupId: null,
    assignedGroupName: '',
  };

  // Recheck immediately before writing. The deterministic email document ID
  // also prevents two simultaneous imports from creating duplicate profiles.
  const [emailExisting, phoneExisting] = await Promise.all([
    Users.findOne({ filters: { email: row.email } }),
    Users.findOne({ filters: { phone: row.phoneE164 } }),
  ]);
  if (emailExisting || phoneExisting) return { status: 'existing' as const, userId: (emailExisting || phoneExisting).userId || (emailExisting || phoneExisting).id };

  const db = getFirestoreDb();
  if (db) {
    await db.runTransaction(async (transaction: any) => {
      const userRef = db.collection('Users').doc(userDbId);
      const registrationRef = db.collection('BvMemberRegistrations').doc(registrationRecord.id);
      const emailQuery = db.collection('Users').where('email', '==', row.email).limit(1);
      const phoneQuery = db.collection('Users').where('phone', '==', row.phoneE164).limit(1);
      const existingSnapshot = await transaction.get(userRef);
      const emailSnapshot = await transaction.get(emailQuery);
      const phoneSnapshot = await transaction.get(phoneQuery);
      if (existingSnapshot.exists || !emailSnapshot.empty || !phoneSnapshot.empty) {
        throw new AppError({ code: 'CONFLICT', message: 'User already exists' });
      }
      transaction.create(userRef, userRecord);
      transaction.create(registrationRef, registrationRecord);
    });
  } else {
    await Users.create({ record: userRecord });
    try {
      await BvMemberRegistrations.create({ record: registrationRecord });
    } catch (error) {
      await Users.delete({ id: userDbId });
      throw error;
    }
  }
  return { status: 'created' as const, userId };
}

export async function getBulkExportData(
  manager: Awaited<ReturnType<typeof requireBulkUserManager>>,
  filters: { status?: string; startDate?: string; endDate?: string; groupId?: string; assignedGuideId?: string },
) {
  const [users, registrations, memberships, groups, guides, residencies] = await Promise.all([
    findAll(Users), findAll(BvMemberRegistrations), findAll(BvGroupMembers), findAll(BvGroups), findAll(Guides), findAll(FolkResidencies),
  ]);
  const registrationByUser = new Map<string, any>();
  for (const registration of registrations) {
    for (const ref of [registration.userDbId, registration.userId, registration.email]) {
      if (ref) registrationByUser.set(String(ref).toLowerCase(), registration);
    }
  }
  const groupByRef = new Map<string, any>();
  for (const group of groups) for (const ref of [group.id, group.groupId]) if (ref) groupByRef.set(String(ref).toLowerCase(), group);
  const membershipByUser = new Map<string, any>();
  for (const membership of memberships) for (const ref of [membership.user, membership.userId]) if (ref) membershipByUser.set(String(ref).toLowerCase(), membership);
  const guideNameByRef = new Map<string, string>();
  for (const guide of guides) {
    const name = String(guide.fullName || guide.name || guide.email || '');
    for (const ref of [guide.id, guide.guideId, guide.email]) if (ref) guideNameByRef.set(String(ref).toLowerCase(), name);
  }
  for (const possibleGuide of users) {
    const name = String(possibleGuide.fullName || possibleGuide.name || possibleGuide.email || '');
    for (const ref of [possibleGuide.id, possibleGuide.userId, possibleGuide.email]) if (ref) guideNameByRef.set(String(ref).toLowerCase(), name);
  }
  const residencyNameByRef = new Map<string, string>();
  for (const residency of residencies) {
    const name = String(residency.residencyName || residency.name || '');
    if (!name) continue;
    for (const ref of [residency.id, residency.residencyId, residency.residencyName]) {
      if (ref) residencyNameByRef.set(String(ref).toLowerCase(), name);
    }
  }
  const residencyName = (reference: unknown) => residencyNameByRef.get(String(reference || '').toLowerCase()) || '';
  const personName = (reference: unknown) => guideNameByRef.get(String(reference || '').toLowerCase()) || '';
  const excludedExportFields = new Set([
    'assignedGuideId', 'bvGroupId', 'user.assignedGuideId', 'user.bvGroupId',
    'bvRegistration.assignedGroupId', 'bvRegistration.assignedGroupld',
    'bvRegistration.pwClassesAttending', 'bvRegistration.isPrabhupadaWorldUser',
    'bvRegistration.userDbId', 'bvRegistration.userDbld', 'bvRegistration.userId', 'bvRegistration.userld',
    'user.bvReportingAdminId', 'user.bvReportingAdminld',
    'user.bvReportingFacilitatorId', 'user.bvReportingFacilitatorld',
    'user.bvReportingSupervisorId', 'user.bvReportingSupervisorld', 'user.guide',
    'bvRegistration.segment', 'user.lastLoginAt', 'user.lastStreakUpdatedAt',
    'user.roleNoticeAcknowledged', 'user.segment',
    'bvRegistration.id', 'user.currentStreak', 'user.id',
    'user.selectedGuideId', 'user.selectedGuideld', 'user.pendingRoleNotice', 'user.statusChangedAt',
  ]);

  const scoped = users.filter(user => {
    const role = normalizeApiRole(user.role);
    if (role !== 'USER' || String(user.segment || '').toUpperCase() !== 'FOLK') return false;
    const guideRefs = refValues(user.guide);
    if (!manager.isSuperGuide && !guideRefs.includes(manager.guideScope.guideId.toLowerCase())) return false;
    if (filters.assignedGuideId && filters.assignedGuideId !== 'all' && !guideRefs.includes(filters.assignedGuideId.toLowerCase())) return false;
    const normalizedStatus = String(user.status || '').toLowerCase().replace(/[ _-]/g, '');
    if (filters.status === 'active' && normalizedStatus !== 'active') return false;
    if (filters.status === 'inactive' && normalizedStatus !== 'inactive') return false;
    const createdDate = String(user.createdAt || '').slice(0, 10);
    if (filters.startDate && createdDate < filters.startDate) return false;
    if (filters.endDate && createdDate > filters.endDate) return false;
    const membership = membershipByUser.get(String(user.id).toLowerCase()) || membershipByUser.get(String(user.userId || '').toLowerCase());
    const groupRef = String(user.bvGroupId || membership?.groupId || membership?.group || '').toLowerCase();
    if (filters.groupId && filters.groupId !== 'all' && groupRef !== filters.groupId.toLowerCase()) return false;
    return true;
  });

  const rows = scoped.map(user => {
    const registration = registrationByUser.get(String(user.id).toLowerCase()) || registrationByUser.get(String(user.userId || '').toLowerCase()) || registrationByUser.get(String(user.email || '').toLowerCase()) || {};
    const membership = membershipByUser.get(String(user.id).toLowerCase()) || membershipByUser.get(String(user.userId || '').toLowerCase());
    const groupRef = String(user.bvGroupId || membership?.groupId || membership?.group || '');
    const group = groupByRef.get(groupRef.toLowerCase());
    const combined: Record<string, unknown> = {};
    for (const header of BULK_USER_CSV_HEADERS) {
      if (header === 'selectedFolkResidency') combined[header] = residencyName(user.residency || registration.selectedFolkResidency);
      else if (header === 'residencyUserClaim') combined[header] = user.residencyClaimed ? 'Yes' : 'No';
      else if (header === 'phone') combined[header] = registration.phone || user.phone || '';
      else combined[header] = registration[header] ?? user[header] ?? '';
    }
    const assignedGuideId = Array.isArray(user.guide) ? user.guide[0] : user.guide || '';
    combined.assignedGuideName = personName(assignedGuideId);
    combined.bvGroupName = group?.groupName || user.bvGroupName || '';
    for (const [key, value] of Object.entries(user)) {
      const exportKey = `user.${key}`;
      if (!(key in combined) && value !== undefined && !excludedExportFields.has(exportKey)) {
        combined[exportKey] = key === 'residency' ? residencyName(value) : value;
      }
    }
    for (const [key, value] of Object.entries(registration)) {
      const exportKey = `bvRegistration.${key}`;
      if (!(key in combined) && value !== undefined && !excludedExportFields.has(exportKey)) {
        combined[exportKey] = key === 'approvedBy' ? personName(value) : value;
      }
    }
    return combined;
  });

  const preferred = [...BULK_USER_CSV_HEADERS, 'assignedGuideName', 'bvGroupName'];
  const dynamic = [...new Set(rows.flatMap(row => Object.keys(row)))].filter(key => !preferred.includes(key as any)).sort();
  const headers = [...preferred, ...dynamic];
  const serialize = (header: string, value: unknown) => {
    if (value == null) return '';
    const text = typeof value === 'object' ? JSON.stringify(value) : String(value);
    if (/(?:phone|whatsapp)/i.test(header)) {
      let clean = text.replace(/^'+/, '').trim();
      let digits = clean.replace(/[^\d]/g, '');
      if (digits.length >= 10) {
        if (!clean.startsWith('+')) {
          if (digits.length === 10) {
            clean = '+91' + digits;
          } else {
            clean = '+' + digits;
          }
        } else {
          clean = '+' + digits;
        }
      }
      return clean;
    }
    return text;
  };
  return {
    headers,
    rows: rows.map(row => headers.map(header => serialize(header, row[header]))),
    filename: `folk-users-${new Date().toISOString().slice(0, 10)}.csv`,
  };
}

export async function getBulkExportOptions(manager: Awaited<ReturnType<typeof requireBulkUserManager>>) {
  const [groups, guides, users, memberships] = await Promise.all([
    findAll(BvGroups, ['id', 'groupId', 'groupName', 'guide', 'segment']),
    findAll(Guides, ['id', 'fullName', 'name', 'email']),
    findAll(Users, ['id', 'userId', 'guide', 'bvGroupId']),
    findAll(BvGroupMembers, ['user', 'userId', 'group', 'groupId']),
  ]);
  let scopedGroups = groups;
  if (manager.isSuperGuide) {
    scopedGroups = groups.filter(group => {
      const segment = String(group.segment || '').toUpperCase();
      return segment !== 'PW';
    });
  } else {
    const guideIdLower = manager.guideScope.guideId.toLowerCase();
    const guideEmailLower = (manager.user.email || '').toLowerCase();
    const guideNameLower = (manager.guideScope.guideName || '').toLowerCase();

    const canonical = await resolveGuideReference(manager.user.email);
    const aliases = new Set<string>([
      guideIdLower,
      guideEmailLower,
      guideNameLower,
      String(manager.user.id || '').toLowerCase(),
      String(manager.user.userId || '').toLowerCase(),
      String(manager.user.fullName || '').toLowerCase(),
      String(manager.user.name || '').toLowerCase(),
    ].filter(Boolean));

    if (canonical) {
      if (canonical.id) aliases.add(canonical.id.toLowerCase());
      if (canonical.userId) aliases.add(canonical.userId.toLowerCase());
      if (canonical.email) aliases.add(canonical.email.toLowerCase());
      if (canonical.fullName) aliases.add(canonical.fullName.toLowerCase());
    }

    scopedGroups = groups.filter(group => {
      const segment = String(group.segment || '').toUpperCase();
      if (segment === 'PW') return false;
      const refs = refValues(group.guide).map(v => String(v).toLowerCase());
      return refs.some(ref => aliases.has(ref));
    });
  }
  return {
    groups: scopedGroups.map(group => ({ id: String(group.id), name: String(group.groupName || group.groupId || group.id) })).sort((a, b) => a.name.localeCompare(b.name)),
    guides: manager.isSuperGuide
      ? guides.map(guide => ({ id: String(guide.id), name: String(guide.fullName || guide.name || guide.email || guide.id) })).sort((a, b) => a.name.localeCompare(b.name))
      : [{ id: manager.guideScope.guideId, name: manager.guideScope.guideName || manager.user.fullName || manager.user.email }],
  };
}
