import { Users, BvGroups, BvGroupMembers as BvMemberships } from '../src/lib/app-backend-sdk';

async function checkDb() {
  console.log('=== CHECKING USERS & GROUPS IN DATABASE ===\n');

  const { records: users } = await Users.findAll({ limit: 500 });
  console.log('Total Users:', users.length);

  const targets = users.filter((u: any) =>
    u.isBvSuperAdmin || u.isBvAdmin || u.isBvSupervisor || u.isBvFacilitator || u.isBvSubFacilitator
  );

  console.log('\nTarget Users found:', targets.map((u: any) => ({
    id: u.id,
    userId: u.userId,
    fullName: u.fullName,
    email: u.email,
    role: u.role,
    isBvSuperAdmin: u.isBvSuperAdmin,
    isBvAdmin: u.isBvAdmin,
    isBvSupervisor: u.isBvSupervisor,
    isBvFacilitator: u.isBvFacilitator,
    isBvSubFacilitator: u.isBvSubFacilitator,
    bvslId: u.bvslId,
  })));

  const { records: groups } = await BvGroups.findAll({ limit: 500 });
  console.log('\nTotal BvGroups:', groups.length);
  groups.forEach((g: any) => {
    console.log('Group:', {
      id: g.id,
      name: g.name,
      bvslLeader: g.bvslLeader,
      bvslId: g.bvslId,
      bvslName: g.bvslName,
      subFacilitatorId: g.subFacilitatorId,
      rgsfId: g.rgsfId,
    });
  });

  const { records: memberships } = await BvMemberships.findAll({ limit: 500 });
  console.log('\nTotal BvMemberships:', memberships.length);
  memberships.forEach((m: any) => {
    console.log('Membership:', {
      id: m.id,
      group: m.group,
      user: m.user,
      status: m.status,
    });
  });
}

checkDb().catch(console.error);
