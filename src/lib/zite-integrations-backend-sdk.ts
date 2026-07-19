import { getApps, initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import fs from 'fs';
import path from 'path';

// ══════════════════════════════════════════════════════════════════════════════
// zite-integrations-backend-sdk.ts — Server-side compatibility layer.
// Connects to Firebase Firestore and replicates Zite's table ORM & Email clients.
// ══════════════════════════════════════════════════════════════════════════════

let firestoreDb: any = null;

export function getFirestoreDb() {
  if (!firestoreDb) {
    const apps = getApps();
    if (apps.length === 0) {
      const serviceAccountPath = path.resolve(process.cwd(), 'service-account.json');
      if (fs.existsSync(serviceAccountPath)) {
        try {
          const serviceAccount = JSON.parse(fs.readFileSync(serviceAccountPath, 'utf8'));
          initializeApp({
            credential: cert(serviceAccount),
            projectId: serviceAccount.project_id
          });
        } catch (e) {
          console.error('[Firebase Admin SDK] Failed to initialize using local file:', e);
        }
      } else if (process.env.FIREBASE_SERVICE_ACCOUNT) {
        try {
          const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
          initializeApp({
            credential: cert(serviceAccount),
            projectId: serviceAccount.project_id
          });
        } catch (e) {
          console.error('[Firebase Admin SDK] Failed to initialize using environment variable:', e);
        }
      } else {
        console.warn('[Firebase Admin SDK] FIREBASE_SERVICE_ACCOUNT is empty and service-account.json not found. Initializing default credentials.');
        const projectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || process.env.GCLOUD_PROJECT;
        if (projectId) {
          initializeApp({ projectId });
        } else {
          initializeApp();
        }
      }
    }
    firestoreDb = getFirestore();
    try {
      firestoreDb.settings({ ignoreUndefinedProperties: true });
    } catch (e) {
      // settings can only be set once. Ignore if already initialized.
    }
  }
  return firestoreDb;
}

export function createEndpoint(config: any) {
  return config;
}

export class ZiteError extends Error {
  code: string;
  constructor({ code, message }: { code: string; message: string }) {
    super(message);
    this.code = code;
    this.name = 'ZiteError';
  }
}

function applyFilters(ref: any, filters: any) {
  let q = ref;
  for (const col of Object.keys(filters)) {
    const val = filters[col];
    if (val === undefined) continue;

    if (val === null) {
      q = q.where(col, '==', null);
    } else if (typeof val === 'object' && !Array.isArray(val)) {
      const keys = Object.keys(val);
      for (const op of keys) {
        const opVal = val[op];
        if (op === 'in') {
          if (Array.isArray(opVal) && opVal.length > 0) {
            q = q.where(col, 'in', opVal.slice(0, 30));
          } else {
            q = q.where(col, '==', '__EMPTY_QUERY_RESULT__');
          }
        } else if (op === 'notIn' || op === 'not_in') {
          if (Array.isArray(opVal) && opVal.length > 0) {
            q = q.where(col, 'not-in', opVal.slice(0, 30));
          }
        } else if (op === 'gte') {
          q = q.where(col, '>=', opVal);
        } else if (op === 'lte') {
          q = q.where(col, '<=', opVal);
        } else if (op === 'gt') {
          q = q.where(col, '>', opVal);
        } else if (op === 'lt') {
          q = q.where(col, '<', opVal);
        } else if (op === 'neq' || op === 'ne') {
          q = q.where(col, '!=', opVal);
        }
      }
    } else {
      q = q.where(col, '==', val);
    }
  }
  return q;
}

export class Table {
  tableName: string;

  constructor(tableName: string) {
    this.tableName = tableName;
  }

  async findOne(query: any): Promise<any> {
    const db = getFirestoreDb();
    if (query.id) {
      const doc = await db.collection(this.tableName).doc(query.id).get();
      return doc.exists ? doc.data() : undefined;
    } else if (query.filters) {
      let q = db.collection(this.tableName);
      q = applyFilters(q, query.filters);
      const snapshot = await q.limit(1).get();
      if (!snapshot.empty) {
        return snapshot.docs[0].data();
      }
    }
    return undefined;
  }

  async findAll(query: any = {}): Promise<{ records: any[]; hasMore: boolean }> {
    const db = getFirestoreDb();
    let q = db.collection(this.tableName);

    if (query.id) {
      q = q.where('id', '==', query.id);
    } else if (query.filters) {
      q = applyFilters(q, query.filters);
    }

    if (query.sorts && Array.isArray(query.sorts) && query.sorts.length > 0) {
      query.sorts.forEach((s: any) => {
        q = q.orderBy(s.field, s.dir.toLowerCase() as 'asc' | 'desc');
      });
    }

    const limit = query.limit ? Number(query.limit) : null;
    const offset = query.offset ? Number(query.offset) : null;

    if (limit !== null) {
      q = q.limit(limit + 1);
    }

    if (offset !== null) {
      q = q.offset(offset);
    }

    const snapshot = await q.get();
    const records = snapshot.docs.map((doc: any) => doc.data());

    let hasMore = false;
    if (limit !== null && records.length > limit) {
      hasMore = true;
      records.pop();
    }

    return {
      records,
      hasMore,
    };
  }

  async create({ record }: { record: any }): Promise<any> {
    const db = getFirestoreDb();
    const id = record.id || `rec_${Math.random().toString(36).substring(2, 15)}`;
    const fullRecord = { ...record, id };
    await db.collection(this.tableName).doc(id).set(fullRecord);
    return fullRecord;
  }

  async update({ id, record }: { id: string; record: any }): Promise<any> {
    const db = getFirestoreDb();
    const data: any = {};
    for (const key of Object.keys(record)) {
      if (record[key] !== undefined) {
        data[key] = record[key];
      }
    }
    await db.collection(this.tableName).doc(id).set(data, { merge: true });
    return this.findOne({ id });
  }

  async delete({ id }: { id: string }): Promise<any> {
    const db = getFirestoreDb();
    const record = await this.findOne({ id });
    if (record) {
      await db.collection(this.tableName).doc(id).delete();
    }
    return record;
  }

  async bulkCreate({ records, matchOn }: { records: any[]; matchOn?: string[] }): Promise<{ records: any[] }> {
    const db = getFirestoreDb();
    const results: any[] = [];

    for (const record of records) {
      let existing: any = null;
      if (matchOn && matchOn.length > 0) {
        const filters: any = {};
        for (const col of matchOn) {
          filters[col] = record[col];
        }
        existing = await this.findOne({ filters });
      }

      const id = existing?.id || record.id || `rec_${Math.random().toString(36).substring(2, 15)}`;
      const fullRecord = { ...record, id };
      await db.collection(this.tableName).doc(id).set(fullRecord, { merge: true });
      results.push(fullRecord);
    }

    return { records: results };
  }
}

// ─── EMAIL CLIENT MOCK ────────────────────────────────────────────────────────
export const Email = {
  send: async (params: { to: string; subject: string; body: any[] }) => {
    console.log(`[Email Mock] Sending to: ${params.to}`);
    console.log(`[Email Mock] Subject: ${params.subject}`);
    console.log(`[Email Mock] Body:`, JSON.stringify(params.body, null, 2));
    // In production, configure nodemailer/SMTP here.
    return { success: true };
  }
};

// ─── INSTANTIATE & EXPORT ALL TABLES ──────────────────────────────────────────
export const AshrayChecklist = new Table('AshrayChecklist');
export const AshrayLevels = new Table('AshrayLevels');
export const AshrayUpgradeRequests = new Table('AshrayUpgradeRequests');
export const AttendanceEvents = new Table('AttendanceEvents');
export const AttendanceParticipants = new Table('AttendanceParticipants');
export const AttendanceRecords = new Table('AttendanceRecords');
export const AttendanceSessions = new Table('AttendanceSessions');
export const AttendanceVolunteers = new Table('AttendanceVolunteers');
export const BvAttendance = new Table('BvAttendance');
export const BvGroupMembers = new Table('BvGroupMembers');
export const BvGroupRequests = new Table('BvGroupRequests');
export const BvGroups = new Table('BvGroups');
export const BvQuizSubmissions = new Table('BvQuizSubmissions');
export const BvQuizzes = new Table('BvQuizzes');
export const BvSessions = new Table('BvSessions');
export const BvslPreachingEntries = new Table('BvslPreachingEntries');
export const BvslWeeklyPlans = new Table('BvslWeeklyPlans');
export const ChallengeEnrollments = new Table('ChallengeEnrollments');
export const CleanlinessInspections = new Table('CleanlinessInspections');
export const CleanlinessReviewRequests = new Table('CleanlinessReviewRequests');
export const CleanlinessRooms = new Table('CleanlinessRooms');
export const Config = new Table('Config');
export const FolkResidencies = new Table('FolkResidencies');
export const GuideTransferRequests = new Table('GuideTransferRequests');
export const Guides = new Table('Guides');
export const JigyasaProcessedFiles = new Table('JigyasaProcessedFiles');
export const JigyasaRegistrations = new Table('JigyasaRegistrations');
export const JigyasaSessionAttendance = new Table('JigyasaSessionAttendance');

export const OneToOneMeetings = new Table('OneToOneMeetings');
export const PreachingReportGoals = new Table('PreachingReportGoals');
export const PushSubscriptions = new Table('PushSubscriptions');
export const RentPayments = new Table('RentPayments');
export const ResidencyTransferRequests = new Table('ResidencyTransferRequests');
export const SadhanaEntries = new Table('SadhanaEntries');
export const SadhanaFields = new Table('SadhanaFields');
export const SadhanaFieldsTable = SadhanaFields;
export const SadhanaMonthlySummaries = new Table('SadhanaMonthlySummaries');
export const ServiceAllocations = new Table('ServiceAllocations');
export const ServiceAvailability = new Table('ServiceAvailability');
export const ServicePreferences = new Table('ServicePreferences');
export const ServiceRatings = new Table('ServiceRatings');
export const ServiceSwaps = new Table('ServiceSwaps');
export const Services = new Table('Services');
export const SkillCatalog = new Table('SkillCatalog');
export const TagMangoSyncLog = new Table('TagMangoSyncLog');
export const Trips = new Table('Trips');
export const UnavailabilityRequests = new Table('UnavailabilityRequests');
export const UserSkills = new Table('UserSkills');
export const Users = new Table('Users');
