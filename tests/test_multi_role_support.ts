import assignBvRole from '../src/api/assignBvRole';
import getUserProfile from '../src/api/getUserProfile';

async function testMultiRoleSupport() {
  console.log('=== STARTING MULTI-ROLE ASSIGNMENT & DASHBOARD VISIBILITY TEST ===\n');

  const superAdminContext = { user: { id: 'SUPERADMIN-001', email: 'super-admin@example.test', role: 'Super Admin', isBvSuperAdmin: true } };
  const targetUserId = 'USER-RGF-TEST-001';

  // Step 1: Assign Facilitator (RGF) role
  console.log('1. Assigning Facilitator (RGF) role...');
  const res1 = await (assignBvRole as any).execute({
    input: { userId: targetUserId, role: 'FACILITATOR', parentId: 'SUPERVISOR-001' },
    context: superAdminContext
  });
  console.log('   Result:', res1.message);

  // Step 2: Assign Supervisor role (should preserve Facilitator role!)
  console.log('\n2. Promoting user to Supervisor role (should preserve Facilitator role)...');
  const res2 = await (assignBvRole as any).execute({
    input: { userId: targetUserId, role: 'SUPERVISOR', parentId: 'SUPERADMIN-001' },
    context: superAdminContext
  });
  console.log('   Result:', res2.message);

  // Step 3: Fetch updated profile and verify both flags are TRUE
  const profileData = await (getUserProfile as any).execute({
    input: { userId: targetUserId },
    context: superAdminContext
  });

  const profile = profileData.profile || profileData;
  console.log('\n3. Verified User Profile Role Flags:');
  console.log('   - isBvSupervisor:   ', !!profile.isBvSupervisor);
  console.log('   - isBvFacilitator:  ', !!profile.isBvFacilitator || !!profile.isBvsl);
  console.log('   - Multi-Role Active:', profile.isBvSupervisor && (profile.isBvFacilitator || profile.isBvsl));

  if (profile.isBvSupervisor && (profile.isBvFacilitator || profile.isBvsl)) {
    console.log('\n=== MULTI-ROLE SUPPORT VERIFIED 100% SUCCESSFULLY! ===');
  } else {
    console.error('\nFAIL: Multi-role flags not set properly.');
  }
}

testMultiRoleSupport().catch(console.error);
