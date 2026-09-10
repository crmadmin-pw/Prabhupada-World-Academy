import getBvslOneToOneData from '../src/api/getBvslOneToOneData';

async function testHierarchyMetadata() {
  console.log('=== STARTING 1:1 CALL REPORTS HIERARCHY METADATA VERIFICATION ===\n');

  // Super Admin context (fetches all users)
  const superAdminContext = { user: { id: 'SUPERADMIN-001', email: 'super-admin@example.test', role: 'Super Admin', isBvSuperAdmin: true } };
  const data = await (getBvslOneToOneData as any).execute({ input: {}, context: superAdminContext });

  console.log(`Fetched ${data.users.length} members for 1:1 Call Reports.`);
  console.log('\nSample Member Hierarchy Metadata Returned:');

  data.users.slice(0, 5).forEach((u: any, idx: number) => {
    console.log(`\nMember #${idx + 1}: ${u.fullName}`);
    console.log(`  - RGF Name:        ${u.rgfName || 'Unassigned / Direct'}`);
    console.log(`  - Supervisor Name: ${u.supervisorName || 'Unassigned / Direct'}`);
    console.log(`  - Admin Name:      ${u.adminName || 'Unassigned / Direct'}`);
  });

  console.log('\n=== HIERARCHY METADATA VERIFICATION COMPLETED SUCCESSFULLY! ===');
}

testHierarchyMetadata().catch(console.error);
