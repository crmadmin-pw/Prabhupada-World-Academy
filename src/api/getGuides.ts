import { z } from 'zod';
import { createEndpoint, Guides, Users } from '@/lib/backend-sdk';
import { serverCacheGetOrFetch } from '../lib/serverCache';
import { getScopedHierarchyUserIds, hierarchyRefs, isHierarchyAdmin } from '../lib/hierarchyUtils';

function formatGuideName(fullName: string | null | undefined, email: string | null | undefined): string {
  let name = (fullName || '').trim();

  // Handle any GUIDE-* or MENTOR-* system ID stored as fullName
  if (/^(GUIDE|MENTOR)[-_]/i.test(name)) {
    // Try to make system IDs human-readable: GUIDE-EXAMPLE-GUIDE -> Example Guide
    const parts = name.split(/[-_]/).filter(p => p && !['GUIDE', 'MENTOR', 'PW', 'FOLK'].includes(p.toUpperCase()));
    if (parts.length > 0) {
      const readable = parts.map(p => p.charAt(0).toUpperCase() + p.slice(1).toLowerCase()).join(' ');
      // Fall through to email if it looks like a number-only string
      if (!/^\d+$/.test(readable)) {
        name = readable;
      } else {
        name = ''; // force fallback to email
      }
    } else {
      name = ''; // force fallback to email
    }
  }

  if (name && !name.includes('@') && name.toLowerCase() !== 'null' && name.toLowerCase() !== 'undefined') {
    return name;
  }
  if (email && email.trim() !== '') {
    const localPart = email.split('@')[0];
    const cleaned = localPart
      .replace(/[\._\-+0-9]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (cleaned) {
      return cleaned
        .split(' ')
        .map(w => {
          const lower = w.toLowerCase();
          if (lower === 'folkadmin') return 'FOLK Admin';
          if (lower === 'guide') return 'Spiritual Guide';
          if (['folk', 'pw', 'bv', 'bvsl'].includes(lower)) return w.toUpperCase();
          return w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();
        })
        .join(' ');
    }
    return email;
  }
  return 'Unknown Guide';
}

const CACHE_KEY = 'ref:guides_v4';
const TTL = 10 * 1000; // 10 seconds — updates quickly when role changes

export default createEndpoint({
  description: 'Get all active guides for registration / forms (server-cached 10s)',
  public: true,
  inputSchema: z.object({
    segment: z.enum(['PW', 'FOLK', 'ALL']).optional(),
  }),
  outputSchema: z.object({
    guides: z.array(z.object({
      guideId: z.string(),
      name: z.string(),
      abbr: z.string(),
      email: z.string().optional(),
      isPrabhupadaWorldMentor: z.boolean().optional(),
    })),
  }),
  execute: async ({ input, context }: { input: any; context: any }) => {
    const allGuides = await serverCacheGetOrFetch(CACHE_KEY, async () => {
      const [{ records: guideRecords }, { records: userRecords }] = await Promise.all([
        Guides.findAll({ filters: { isActive: true }, fields: ['id', 'guideId', 'fullName', 'name', 'email', 'abbreviation', 'abbr', 'segment'], limit: 500 }).catch(() => ({ records: [] })),
        Users.findAll({ fields: ['id', 'userId', 'fullName', 'email', 'role', 'status', 'segment', 'isPrabhupadaWorldUser', 'isBvAdmin', 'isBvSuperAdmin'], limit: 1000 }).catch(() => ({ records: [] })),
      ]);

      const folkGuidesFromDb = guideRecords
        .filter(g => {
          // A FOLK guide list must never include records explicitly marked as
          // Prabhupada World. Older Guide rows without a segment remain
          // eligible and are validated against their linked user below.
          if (String(g.segment || '').trim().toUpperCase() === 'PW') return false;
          // Cross-reference with Users table to check if they were deleted/modified
          if (g.email) {
            const emailLower = g.email.toLowerCase().trim();
            const correspondingUser = userRecords.find(u => (u.email || '').toLowerCase().trim() === emailLower);
            if (correspondingUser) {
              // If user exists, status must be Active and role must be a guide/admin role
              const roleUpper = (correspondingUser.role || '').toUpperCase().replace(/\s+/g, '_').trim();
              const isGuideOrAdmin =
                roleUpper === 'GUIDE' ||
                roleUpper === 'SUPER_GUIDE' ||
                roleUpper === 'ADMIN' ||
                roleUpper === 'SUPER_ADMIN' ||
                correspondingUser.isBvAdmin === true ||
                correspondingUser.isBvSuperAdmin === true;

              if (correspondingUser.status !== 'Active' || !isGuideOrAdmin) {
                return false;
              }
            }
          }
          return true;
        })
        .map(g => ({
          guideId: g.id || g.guideId,
          name: formatGuideName(g.fullName || g.name, g.email),
          abbr: g.abbreviation || g.abbr || (g.fullName || '').slice(0, 3).toUpperCase(),
          email: g.email || '',
          isPrabhupadaWorldMentor: false,
        }));

      // Dynamically fetch FOLK Guides / Supervisors / Admins from Users table
      const dbFolkGuides = userRecords
        .filter(u => {
          const roleUpper = (u.role || '').toUpperCase().replace(/\s+/g, '_').trim();
          const isPwUser = u.segment === 'PW' || u.isPrabhupadaWorldUser === true;

          if (isPwUser) return false;

          const isFolkRole =
            roleUpper === 'GUIDE' ||
            roleUpper === 'SUPER_GUIDE' ||
            roleUpper === 'ADMIN' ||
            roleUpper === 'SUPER_ADMIN' ||
            u.isBvAdmin === true ||
            u.isBvSuperAdmin === true;

          return isFolkRole && u.status === 'Active';
        })
        .map(u => ({
          guideId: u.id || u.userId,
          name: formatGuideName(u.fullName, u.email),
          abbr: (u.fullName || '').slice(0, 3).toUpperCase(),
          email: u.email || '',
          isPrabhupadaWorldMentor: false,
        }));

      const combinedFolk = [...folkGuidesFromDb, ...dbFolkGuides];

      // Dynamically fetch PW Admins from Users table
      const dbPwAdmins = userRecords
        .filter(u => {
          const roleUpper = (u.role || '').toUpperCase().replace(/\s+/g, '_').trim();
          const segmentUpper = (u.segment || '').toUpperCase();
          return (roleUpper === 'ADMIN' || roleUpper === 'PW_ADMIN' || u.isBvAdmin === true || roleUpper === 'SUPER_ADMIN' || u.isBvSuperAdmin === true) &&
                 (segmentUpper === 'PW' || u.isPrabhupadaWorldUser === true) &&
                 u.status === 'Active';
        })
        .map(u => ({
          // Use userId (canonical app user id) not u.id (Firebase UID)
          // so that registerUser.ts can correctly identify them as PW mentors
          guideId: u.userId || u.id,
          name: formatGuideName(u.fullName, u.email),
          abbr: (u.fullName || '').slice(0, 3).toUpperCase(),
          email: u.email || '',
          isPrabhupadaWorldMentor: true,
        }));

      const pwList = dedupeGuides(dbPwAdmins);
      const folkList = dedupeGuides(combinedFolk);
      const allList = dedupeGuides([...pwList, ...folkList]);

      return {
        pw: pwList,
        folk: folkList,
        all: allList,
      };
    }, TTL);

    const effectiveSegment = input.segment;

    const sortGuides = (list: any[]) => {
      return [...list].sort((a, b) => {
        const isAPw = !!a.isPrabhupadaWorldMentor;
        const isBPw = !!b.isPrabhupadaWorldMentor;
        if (isAPw && !isBPw) return -1;
        if (!isAPw && isBPw) return 1;
        return (a.name || '').localeCompare(b.name || '');
      });
    };

    const canReadGuideEmails = !!(
      context?.user?.capabilities?.includes('*') ||
      context?.user?.capabilities?.includes('users.assigned.read')
    );
    // Cache the public directory, never a caller's authorized result. Scope
    // after cache retrieval so one admin cannot reuse another admin's options.
    const scope = isHierarchyAdmin(context?.user) ? await getScopedHierarchyUserIds(context.user) : null;
    const prepareGuides = (list: any[]) => sortGuides(list).filter(guide => scope === null ||
      hierarchyRefs([guide.guideId, guide.email]).some(ref => scope.has(ref))).map(guide => {
      if (canReadGuideEmails) return guide;
      const publicGuide = { ...guide };
      delete publicGuide.email;
      return publicGuide;
    });

    if (effectiveSegment === 'PW') {
      return { guides: prepareGuides(allGuides.pw) };
    } else if (effectiveSegment === 'FOLK') {
      return { guides: prepareGuides(allGuides.folk) };
    }

    return { guides: prepareGuides(allGuides.all) };
  },
});

function dedupeGuides(list: any[]) {
  const seenEmails = new Set();
  const seenNames = new Set();
  return list.filter(g => {
    const emailKey = (g.email || '').toLowerCase().trim();
    const nameKey = (g.name || '').toLowerCase().trim();
    if (emailKey && seenEmails.has(emailKey)) return false;
    if (nameKey && seenNames.has(nameKey)) return false;
    if (emailKey) seenEmails.add(emailKey);
    if (nameKey) seenNames.add(nameKey);
    return true;
  });
}
