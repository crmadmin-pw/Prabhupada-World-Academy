import { Users, Config, FolkResidencies, ZiteError } from 'zite-integrations-backend-sdk';

const DEFAULT_TAGMANGO_API_URL = 'https://api-prod-new.tagmango.com/integration/action/migrate-user';

export type EnrollmentResult = {
  status: 'Enrolled' | 'Failed' | 'Skipped';
  error?: string;
};

export async function resolveApiKey(): Promise<string | undefined> {
  const dbRecord = await Config.findOne({
    filters: { configKey: 'tagmango_api_key' },
  });
  if (dbRecord?.configValue) return dbRecord.configValue;
  return process.env.ZITE_TAGMANGO_API_KEY || undefined;
}

export async function resolveApiUrl(): Promise<string> {
  const dbRecord = await Config.findOne({
    filters: { configKey: 'tagmango_api_url' },
  });
  if (dbRecord?.configValue) return dbRecord.configValue;
  return DEFAULT_TAGMANGO_API_URL;
}

/**
 * Resolve the mangoId for a user based on their residency + ashray level.
 * The course_config is now: { "CenterName": { "Jigyasa": "mangoId", ... }, ... }
 */
export async function resolveMangoId(residencyIds: string[] | string | undefined, ashrayLevel: string): Promise<string | undefined> {
  const courseConfigRecord = await Config.findOne({
    filters: { configKey: 'course_config' },
  });
  if (!courseConfigRecord?.configValue) return undefined;

  let courseConfig: Record<string, Record<string, string>>;
  try { courseConfig = JSON.parse(courseConfigRecord.configValue); } catch { return undefined; }

  // Resolve residency name from the linked record ID
  let residencyName: string | undefined;
  if (residencyIds) {
    const rid = Array.isArray(residencyIds) ? residencyIds[0] : residencyIds;
    if (rid) {
      const res = await FolkResidencies.findOne({ id: rid, fields: ['residencyName'] });
      residencyName = res?.residencyName;
    }
  }

  if (residencyName && courseConfig[residencyName]?.[ashrayLevel]) {
    return courseConfig[residencyName][ashrayLevel];
  }

  // Fallback: search all centers for the level (in case residency not set)
  for (const centerConfig of Object.values(courseConfig)) {
    if (centerConfig[ashrayLevel]) return centerConfig[ashrayLevel];
  }

  return undefined;
}

export async function enrollUserOnTagMango(opts: {
  userId: string;
  name: string;
  email: string;
  phone: string;
  ashrayLevel: string | undefined;
  currentAttempts?: number;
}): Promise<EnrollmentResult> {
  const { userId, name, email, phone, ashrayLevel, currentAttempts = 0 } = opts;
  const now = new Date().toISOString();

  if (!ashrayLevel) {
    return { status: 'Skipped', error: 'No Ashray level set' };
  }

  const apiKey = await resolveApiKey();
  if (!apiKey) {
    return { status: 'Skipped', error: 'TagMango API key not configured' };
  }

  const apiUrl = await resolveApiUrl();

  // Fetch user's residency
  const userRecord = await Users.findOne({ id: userId, fields: ['residency'] });
  const mangoId = await resolveMangoId(userRecord?.residency, ashrayLevel);

  if (!mangoId) {
    return { status: 'Skipped', error: `No TagMango course mapped for level "${ashrayLevel}" (check center-specific mapping)` };
  }

  // Mark as Processing
  await Users.update({
    id: userId,
    record: {
      tagMangoEnrollmentStatus: 'Processing',
      tagMangoEnrollmentAttempts: currentAttempts + 1,
      tagMangoLastAttempt: now,
    },
  });

  try {
    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'x-whitelabel-host': 'learn.prabhupadaworld.com',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ name, email, phone: Number(phone), mangoId }),
    });

    const body = await response.text();

    if (!response.ok) {
      const errMsg = `HTTP ${response.status}: ${body.slice(0, 500)}`;
      await Users.update({
        id: userId,
        record: {
          tagMangoEnrollmentStatus: 'Failed',
          tagMangoError: errMsg,
          enrolledLevel: ashrayLevel,
        },
      });
      return { status: 'Failed', error: errMsg };
    }

    let parsed: any;
    try { parsed = JSON.parse(body); } catch { parsed = {}; }

    // TagMango nests the result under `result`
    const result = parsed?.result || parsed;
    const errorMessage = result?.errorMessage || parsed?.errorMessage;

    if (errorMessage && errorMessage !== "None") {
      const errMsg = `TagMango error: ${errorMessage}`;
      await Users.update({
        id: userId,
        record: {
          tagMangoEnrollmentStatus: 'Failed',
          tagMangoError: errMsg,
          enrolledLevel: ashrayLevel,
        },
      });
      return { status: 'Failed', error: errMsg };
    }

    const tagMangoUserId = result?.userId || result?.subscriberId || parsed?.userId || parsed?.id || '';

    await Users.update({
      id: userId,
      record: {
        tagMangoEnrollmentStatus: 'Enrolled',
        tagMangoUserId: String(tagMangoUserId),
        tagMangoError: '',
        enrolledLevel: ashrayLevel,
      },
    });

    return { status: 'Enrolled' };
  } catch (err: any) {
    const errMsg = err?.message || 'Unknown network error';
    await Users.update({
      id: userId,
      record: {
        tagMangoEnrollmentStatus: 'Failed',
        tagMangoError: errMsg,
        enrolledLevel: ashrayLevel,
      },
    });
    return { status: 'Failed', error: errMsg };
  }
}

/**
 * Revoke a user's TagMango access for a given level.
 * Returns 'Revoked', 'Failed', or 'Skipped'.
 */
export async function revokeUserFromTagMango(opts: {
  userId: string;
  email: string;
  residencyIds?: string[] | string;
  level: string;
}): Promise<'Revoked' | 'Failed' | 'Skipped'> {
  const apiKey = await resolveApiKey();
  if (!apiKey) return 'Skipped';

  const mangoId = await resolveMangoId(opts.residencyIds, opts.level);
  if (!mangoId) return 'Skipped';

  try {
    const response = await fetch('https://api-prod-new.tagmango.com/integration/action/revoke-user', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: opts.email, mangoId }),
    });

    if (!response.ok) {
      const body = await response.text();
      await Users.update({ id: opts.userId, record: { tagMangoError: `Revoke HTTP ${response.status}: ${body.slice(0, 300)}` } });
      return 'Failed';
    }

    await Users.update({ id: opts.userId, record: { tagMangoEnrollmentStatus: 'Revoked', tagMangoError: '' } });
    return 'Revoked';
  } catch (err: any) {
    await Users.update({ id: opts.userId, record: { tagMangoError: err?.message || 'Revoke failed' } });
    return 'Failed';
  }
}

/**
 * Migrate a user from one course to another when their ashray level changes.
 * Revokes old level, enrolls in new level.
 */
export async function migrateUserCourse(opts: {
  userId: string;
  name: string;
  email: string;
  phone: string;
  oldLevel: string;
  newLevel: string;
  currentAttempts?: number;
}): Promise<{ revokeResult: 'Revoked' | 'Failed' | 'Skipped'; enrollResult: EnrollmentResult }> {
  // Get user's residency for course resolution
  const userRecord = await Users.findOne({ id: opts.userId, fields: ['residency', 'tagMangoEnrollmentStatus'] });
  const residencyIds = userRecord?.residency;

  // Step 1: Revoke old level if enrolled
  let revokeResult: 'Revoked' | 'Failed' | 'Skipped' = 'Skipped';
  if (userRecord?.tagMangoEnrollmentStatus === 'Enrolled') {
    revokeResult = await revokeUserFromTagMango({
      userId: opts.userId,
      email: opts.email,
      residencyIds,
      level: opts.oldLevel,
    });
  }

  // Step 2: Enroll in new level
  const enrollResult = await enrollUserOnTagMango({
    userId: opts.userId,
    name: opts.name,
    email: opts.email,
    phone: opts.phone,
    ashrayLevel: opts.newLevel,
    currentAttempts: opts.currentAttempts || 0,
  });

  return { revokeResult, enrollResult };
}
