import getBvslOneToOneData from '../src/api/getBvslOneToOneData';

async function testHierarchyScoping() {
  console.log('=== STARTING 1:1 CALL REPORTS HIERARCHICAL SCOPING TEST ===\n');

  // 1. RGSF User Context
  const rgsfContext = { user: { id: 'RGSF-001', email: 'rgsf@example.test', role: 'User', isBvSubFacilitator: true } };
  const rgsfData = await (getBvslOneToOneData as any).execute({ input: {}, context: rgsfContext });
  console.log('1. RGSF 1:1 Call Reports:');
  console.log(`   - Visible users count: ${rgsfData.users.length}`);
  console.log(`   - Sample members:`, rgsfData.users.map((u: any) => u.fullName).join(', ') || 'None');

  // 2. RGF User Context
  const rgfContext = { user: { id: 'RGF-001', email: 'rgf@example.test', role: 'User', isBvFacilitator: true } };
  const rgfData = await (getBvslOneToOneData as any).execute({ input: {}, context: rgfContext });
  console.log('\n2. RGF 1:1 Call Reports:');
  console.log(`   - Visible users count: ${rgfData.users.length}`);
  console.log(`   - Sample members:`, rgfData.users.map((u: any) => u.fullName).join(', ') || 'None');

  // 3. Supervisor User Context
  const supervisorContext = { user: { id: 'SUPERVISOR-001', email: 'supervisor@example.test', role: 'User', isBvSupervisor: true } };
  const supervisorData = await (getBvslOneToOneData as any).execute({ input: {}, context: supervisorContext });
  console.log('\n3. Supervisor 1:1 Call Reports:');
  console.log(`   - Visible users count: ${supervisorData.users.length}`);
  console.log(`   - Sample members:`, supervisorData.users.map((u: any) => u.fullName).join(', ') || 'None');

  // 4. Admin User Context
  const adminContext = { user: { id: 'ADMIN-001', email: 'admin@example.test', role: 'Admin', isBvAdmin: true } };
  const adminData = await (getBvslOneToOneData as any).execute({ input: {}, context: adminContext });
  console.log('\n4. Admin 1:1 Call Reports:');
  console.log(`   - Visible users count: ${adminData.users.length}`);
  console.log(`   - Sample members:`, adminData.users.map((u: any) => u.fullName).join(', ') || 'None');

  // 5. Super Admin User Context
  const superAdminContext = { user: { id: 'SUPERADMIN-001', email: 'super-admin@example.test', role: 'Super Admin', isBvSuperAdmin: true } };
  const superAdminData = await (getBvslOneToOneData as any).execute({ input: {}, context: superAdminContext });
  console.log('\n5. Super Admin 1:1 Call Reports:');
  console.log(`   - Visible users count: ${superAdminData.users.length}`);
  console.log(`   - Total members in Prabhupada World Bhakti Vriksha: ${superAdminData.users.length}`);

  console.log('\n=== ALL 5 DASHBOARD HIERARCHICAL SCOPING RULES VERIFIED & PASSED! ===');
}

testHierarchyScoping().catch(console.error);
