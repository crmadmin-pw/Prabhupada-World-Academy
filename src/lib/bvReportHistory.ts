import { BvAttendance } from '@/lib/backend-sdk';
import { collectOwnerKeys } from './scopedEntryReads';
import type { ReportAttendanceRecord } from './bvReportAttendance';

export const BV_REPORT_IDENTITY_FIELDS = ['id', 'userId', 'email', 'uid', 'authUid', 'firebaseUid',
  'firebaseUserId', 'firebaseAuthUid', 'authId', 'authUserId', 'firebaseId', 'firebaseAuthId', 'firebase_id'];

/** Read history only for members already authorized by the report's group scope.
 * Former groups may belong to another facilitator; their other members must
 * never be included. Equality queries also support legacy relation arrays. */
export async function readBvReportHistory(users: Record<string, unknown>[], startDate?: string, endDate?: string) {
  const values = collectOwnerKeys(users, BV_REPORT_IDENTITY_FIELDS).flatMap(key => [key, [key]]);
  const records = new Map<string, ReportAttendanceRecord & { id: string }>();
  const chunks: typeof values[] = [];
  for (let index = 0; index < values.length; index += 30) chunks.push(values.slice(index, index + 30));
  let next = 0;
  const worker = async () => {
    while (next < chunks.length) {
      const chunk = chunks[next++];
      let offset = 0;
      while (true) {
        const page = await BvAttendance.findAll({
          filters: { user: { in: chunk } },
          fields: ['id', 'user', 'group', 'groupId', 'attendanceDate', 'present'],
          limit: 2000, offset,
        });
        for (const record of page.records) {
          const date = String(record.attendanceDate || '').slice(0, 10);
          // Sadhana-generated, group-less rows are not official attendance.
          if (!(record.group || record.groupId) || !date || (startDate && date < startDate) || (endDate && date > endDate)) continue;
          records.set(String(record.id), record);
        }
        if (!page.hasMore || page.records.length === 0) break;
        offset += page.records.length;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(8, chunks.length) }, worker));
  return [...records.values()];
}
