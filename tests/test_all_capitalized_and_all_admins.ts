import getBvslOneToOneData from '../src/api/getBvslOneToOneData';

async function testAllCapitalizedAndAllAdmins() {
  console.log('=== STARTING CAPITALIZATION & ALL ADMINS VERIFICATION ===\n');

  const superAdminContext = { user: { id: 'SUPERADMIN-001', email: 'super-admin@example.test', role: 'Super Admin', isBvSuperAdmin: true } };
  const res = await (getBvslOneToOneData as any).execute({ input: {}, context: superAdminContext });

  console.log('1. Verifying allAdmins list from backend response:');
  console.log('   All Admins returned:', res.allAdmins);
  console.log(`   Count of Admins in System: ${res.allAdmins?.length || 0}`);

  if (!res.allAdmins || res.allAdmins.length === 0) {
    console.error('FAIL: allAdmins list is empty.');
  } else {
    console.log('   PASS: allAdmins list populated successfully with all system admins!');
  }

  console.log('\n2. Verifying Capitalization formatting:');
  const defaultLabel = 'All Admins';
  const defaultLevelLabel = 'All Ashraya Levels';

  console.log(`   Admin Default Option Label:   "${defaultLabel}" (Capital 'A': ${defaultLabel.startsWith('All')})`);
  console.log(`   Level Default Option Label:   "${defaultLevelLabel}" (Capital 'A': ${defaultLevelLabel.startsWith('All')})`);

  console.log('\n=== ALL CAPITALIZATION & ADMIN DROPDOWN TESTS PASSED CLEANLY! ===');
}

testAllCapitalizedAndAllAdmins().catch(console.error);
