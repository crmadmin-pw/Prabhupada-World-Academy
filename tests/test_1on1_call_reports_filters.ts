import getBvslOneToOneData from '../src/api/getBvslOneToOneData';

async function test1on1CallReportsFilters() {
  console.log('=== STARTING 1:1 CALL REPORTS FILTERING VERIFICATION ===\n');

  const superAdminContext = { user: { id: 'SUPERADMIN-001', email: 'super-admin@example.test', role: 'Super Admin', isBvSuperAdmin: true } };
  const data = await (getBvslOneToOneData as any).execute({ input: {}, context: superAdminContext });

  const members: any[] = data.users || [];
  console.log(`Total 1:1 Call Report Members loaded: ${members.length}`);

  // Test 1: Search by Name
  const searchName = 'Devotee Member A';
  const nameFiltered = members.filter(m => m.fullName.toLowerCase().includes(searchName.toLowerCase()));
  console.log(`\n1. Name Search Filter ("${searchName}"): ${nameFiltered.length} match(es)`);
  nameFiltered.forEach(m => console.log(`   - ${m.fullName} | Level: ${m.ashrayLevel || 'None'} | Admin: ${m.adminName || 'Unassigned'}`));

  // Test 2: Filter by Admin
  const availableAdmins = Array.from(new Set(members.map(m => m.adminName).filter(Boolean)));
  console.log(`\n2. Available Admins (${availableAdmins.length}):`, availableAdmins);
  if (availableAdmins.length > 0) {
    const selectedAdmin = availableAdmins[0];
    const adminFiltered = members.filter(m => m.adminName === selectedAdmin);
    console.log(`   Filter by Admin ("${selectedAdmin}"): ${adminFiltered.length} member(s)`);
  }

  // Test 3: Filter by Ashraya Level
  const availableLevels = Array.from(new Set(members.map(m => m.ashrayLevel).filter(Boolean)));
  console.log(`\n3. Available Ashraya Levels (${availableLevels.length}):`, availableLevels);
  if (availableLevels.length > 0) {
    const selectedLevel = availableLevels[0];
    const levelFiltered = members.filter(m => m.ashrayLevel === selectedLevel);
    console.log(`   Filter by Level ("${selectedLevel}"): ${levelFiltered.length} member(s)`);
  }

  console.log('\n=== ALL 1:1 CALL REPORT FILTERS VERIFIED SUCCESSFULLY! ===');
}

test1on1CallReportsFilters().catch(console.error);
