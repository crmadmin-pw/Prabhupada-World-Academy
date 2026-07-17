import { z } from 'zod';
import { createEndpoint, UserSkills, SkillCatalog, Users, Guides } from 'zite-integrations-backend-sdk';

const DEFAULT_SKILLS = ['cleaning', 'pujari', 'prasadam', 'tech', 'misc'];

export default createEndpoint({
  description: 'Get skills for all guide users (guide view) or current user (user view)',
  authenticated: true,
  inputSchema: z.object({ userId: z.string().optional() }),
  outputSchema: z.any(),
  execute: async ({ context }) => {
    if (!context.user) throw new Error('Unauthorized');
    const userRole = (context.user.role || '').toLowerCase();
    const isGuide = ['guide', 'super guide'].some(r => userRole.includes(r));

    // Ensure catalog has default skills
    await ensureDefaultSkills();

    let targetUserIds: string[] = [];
    let userInfoMap: Record<string, { userId: string; fullName: string }> = {};

    if (isGuide) {
      // Guide view: get all active users under this guide
      try {
        const guide = await Guides.findOne({ filters: { email: context.user.email, isActive: true }, fields: ['id'] });
        const filter: any = { status: 'Active' };
        if (guide) filter.guide = (guide as any).id;
        const { records: users } = await Users.findAll({ filters: filter, fields: ['id', 'userId', 'fullName'], limit: 1000 });
        users.forEach(u => {
          targetUserIds.push(u.id);
          userInfoMap[u.id] = { userId: u.id, fullName: u.fullName || '' };
        });
      } catch {
        targetUserIds = [context.user.id];
        userInfoMap[context.user.id] = { userId: context.user.id, fullName: context.user.fullName || '' };
      }
    } else {
      targetUserIds = [context.user.id];
      userInfoMap[context.user.id] = { userId: context.user.id, fullName: context.user.fullName || '' };
    }

    if (targetUserIds.length === 0) {
      return { users: [], skills: [] };
    }

    // Fetch skills for all target users
    const skillsRes = await UserSkills.findAll({
      filters: { user: { in: targetUserIds } as any },
      limit: 2000,
      fields: ['id', 'user', 'skill', 'level', 'taggedBy'],
    });

    // Resolve skill names from catalog
    const skillIds = skillsRes.records.map(s => Array.isArray(s.skill) ? s.skill[0] : s.skill).filter(Boolean) as string[];
    const skillNameMap: Record<string, string> = {};
    if (skillIds.length > 0) {
      const cat = await SkillCatalog.findAll({ filters: { id: { in: skillIds } as any }, fields: ['id', 'skillName'] });
      cat.records.forEach(c => { skillNameMap[c.id] = c.skillName || ''; });
    }

    // Build flat skills list
    const skills = skillsRes.records.map(s => {
      const skillId = Array.isArray(s.skill) ? s.skill[0] : s.skill;
      const userId = Array.isArray(s.user) ? s.user[0] : s.user;
      return {
        id: s.id,
        userId: userId || '',
        skillName: skillNameMap[skillId || ''] || skillId || '',
        level: s.level || 'Beginner',
        taggedBy: (s as any).taggedBy || 'guide',
      };
    });

    // Group skills by user
    const skillsByUser: Record<string, string[]> = {};
    skills.forEach(s => {
      if (!skillsByUser[s.userId]) skillsByUser[s.userId] = [];
      if (!skillsByUser[s.userId].includes(s.skillName)) {
        skillsByUser[s.userId].push(s.skillName);
      }
    });

    const users = targetUserIds.map(uid => ({
      userId: uid,
      fullName: userInfoMap[uid]?.fullName || '',
      skills: skillsByUser[uid] || [],
    })).filter(u => u.fullName);

    return { users, skills };
  },
});

async function ensureDefaultSkills() {
  try {
    const existing = await SkillCatalog.findAll({ filters: { isActive: true }, limit: 10, fields: ['id', 'skillName'] });
    if (existing.records.length > 0) return; // already has skills
    // Seed default skills
    await Promise.all(DEFAULT_SKILLS.map(name =>
      SkillCatalog.create({ 'Skill Name': name, 'Is Active': true } as any).catch(() => {})
    ));
  } catch { /* non-critical */ }
}
