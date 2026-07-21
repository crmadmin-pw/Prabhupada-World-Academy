import { z } from 'zod';
import { createEndpoint, BvMemberRegistrations, Users, ZiteError } from 'zite-integrations-backend-sdk';

export default createEndpoint({
  description: 'Get pending Bhakti Vriksha member registrations filtered by access level (FOLK Guides vs Super Admin / Hiranyavarna Prabhu)',
  authenticated: true,
  inputSchema: z.object({}),
  outputSchema: z.any(),
  execute: async ({ context }: any) => {
    if (!context.user) throw new Error('Unauthorized');
    const role = (context.user.role || '').toUpperCase();
    const userEmail = (context.user.email || '').toLowerCase();
    
    // Check if user is Super Admin / Hiranyavarna Prabhu / Admin
    const isSuperAdminOrPwAdmin = role === 'SUPER_GUIDE' || 
      userEmail === 'srilaprabhupadaworld@gmail.com' || 
      context.user.isBvAdmin || 
      context.user.isBvSuperAdmin;

    // Check if user is Guide or Supervisor or RGF
    const isGuideOrSupervisor = role === 'GUIDE' || 
      context.user.isBvSupervisor || 
      context.user.isBvsl || 
      context.user.isSadhanaMentor;

    if (!isSuperAdminOrPwAdmin && !isGuideOrSupervisor) {
      throw new ZiteError({ code: 'FORBIDDEN', message: 'Admin or Supervisor access required' });
    }

    let records: any[] = [];
    try {
      const result = await BvMemberRegistrations.findAll({
        filters: { status: 'Pending Approval' },
        limit: 500,
      });
      records = result?.records || [];
    } catch (err) {
      records = [];
    }

    // Enhance records with user background (PW user vs FOLK guide user)
    const userIds = records.map(r => r.userId).filter(Boolean);
    const userMap: Record<string, any> = {};

    if (userIds.length > 0) {
      try {
        const { records: usersList } = await Users.findAll({
          filters: { id: userIds },
          fields: ['id', 'guide', 'selectedGuideId', 'guideName', 'residency', 'selectedFolkResidency', 'isPrabhupadaWorldUser'],
          limit: 500,
        });
        (usersList || []).forEach(u => {
          userMap[u.id] = u;
        });
      } catch (e) {}
    }

    // Filter according to user intent:
    // 1. Hiranyavarna Prabhu / PW Admin sees ONLY Prabhupada World registrations
    // 2. Super FOLK Guide / Supervisors / Guides see ONLY FOLK registrations
    const isHiranyavarnaOrPwAdmin = userEmail === 'srilaprabhupadaworld@gmail.com' || context.user.isPwAdmin;

    const filteredRecords = records.filter(r => {
      const u = userMap[r.userId];
      const uGuide = (String(u?.guide || '') + ' ' + String(u?.selectedGuideId || '') + ' ' + String(u?.guideName || '')).toLowerCase();
      const isPwUser = !!(u?.isPrabhupadaWorldUser) || 
        r.guideId === 'MENTOR-PW-HIRANYAVARNA' || 
        r.selectedGuideId === 'MENTOR-PW-HIRANYAVARNA' ||
        uGuide.includes('mentor-pw-hiranyavarna') ||
        uGuide.includes('hiranyavarna');

      if (isHiranyavarnaOrPwAdmin) {
        return isPwUser; // Hiranyavarna Prabhu sees ONLY Prabhupada World registrations
      }
      
      // Super FOLK Guides / Supervisors see ONLY FOLK registrations
      return !isPwUser;
    });

    return filteredRecords.sort((a: any, b: any) => 
      new Date(b.submittedAt || 0).getTime() - new Date(a.submittedAt || 0).getTime()
    );
  },
});
