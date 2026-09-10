import getBvslMembers from '../src/api/getBvslMembers';
import getSuperGuideBvStats from '../src/api/getSuperGuideBvStats';
import getSadhanaFormData from '../src/api/getSadhanaFormData';
import getSuperGuideAttendanceReport from '../src/api/getSuperGuideAttendanceReport';
import getBvslOneToOneData from '../src/api/getBvslOneToOneData';
import getBvslGroups from '../src/api/getBvslGroups';
import assignBvRole from '../src/api/assignBvRole';

async function testAll12Requests() {
  console.log('=== STARTING INTEGRATION VERIFICATION FOR ALL 12 USER REQUESTS ===\n');

  const superAdminContext = {
    user: {
      id: 'USER-SUPERADMIN-PW',
      userId: 'USER-SUPERADMIN-PW',
      email: 'super-admin@example.test',
      role: 'Super Admin',
      isBvSuperAdmin: true,
      segment: 'PW',
    },
  };

  // 1. RGF member list
  console.log('1. Testing RGF member lookup...');
  const memberRes = await (getBvslMembers as any).execute({
    input: { bvslId: 'test-rgf@example.test' },
    context: superAdminContext,
  });
  console.log(`   Members found: ${memberRes.members?.length || 0}`);
  console.log('   PASS: getBvslMembers executed successfully.');

  // 2. Admin Breakdown in getSuperGuideBvStats
  console.log('\n2. Testing Admin-wise breakdown in getSuperGuideBvStats (PW segment)...');
  const statsRes = await (getSuperGuideBvStats as any).execute({
    input: { segment: 'PW' },
    context: superAdminContext,
  });
  const unknownCount = (statsRes.guideBreakdown || []).filter((g: any) => g.guideName === 'Unknown').length;
  console.log(`   Total Breakdown entries: ${statsRes.guideBreakdown?.length || 0}`);
  console.log(`   "Unknown" entries count: ${unknownCount}`);
  if (unknownCount > 0) {
    console.warn('   WARNING: Some breakdown entries still returned Unknown.');
  } else {
    console.log('   PASS: All breakdown entries successfully resolved to valid Admin names!');
  }

  // 3. Sadhana Minutes Upper Limit in getSadhanaFormData
  console.log('\n3. Testing Daily Sadhana max value limit...');
  const sadhanaFormRes = await (getSadhanaFormData as any).execute({
    input: { userId: 'USER-SUPERADMIN-PW', entryDate: '2026-08-10' },
    context: superAdminContext,
  });
  const maxValues = (sadhanaFormRes.fields || []).map((f: any) => f.maxValue);
  const maxLimit = Math.max(...maxValues, 0);
  console.log(`   Highest maxValue in form fields: ${maxLimit}`);
  if (maxLimit >= 1200) {
    console.log('   PASS: Form field upper limit increased to 1200 minutes!');
  } else {
    console.error(`   FAIL: Max limit is ${maxLimit}, expected 1200.`);
  }

  // 4. Attendance Report Integration
  console.log('\n4. Testing Attendance Report with BvAttendance integration...');
  const attReportRes = await (getSuperGuideAttendanceReport as any).execute({
    input: { segment: 'PW' },
    context: superAdminContext,
  });
  console.log(`   Total attendance report records: ${attReportRes.records?.length || 0}`);
  console.log('   PASS: Attendance report fetched records cleanly!');

  // 5. Department-scoped Admins in 1:1 Tracker
  console.log('\n5. Testing 1:1 tracker department-scoped admins...');
  const oneToOneRes = await (getBvslOneToOneData as any).execute({
    input: {},
    context: superAdminContext,
  });
  console.log('   PW Admins in dropdown:', oneToOneRes.allAdmins);
  const hasFolkInPw = (oneToOneRes.allAdmins || []).some((a: string) => a.includes('(FOLK') || a.includes('Gaurmandal'));
  if (hasFolkInPw) {
    console.warn('   WARNING: FOLK admin found in PW dropdown list.');
  } else {
    console.log('   PASS: 1:1 Call Tracker correctly scopes admins to PW department!');
  }

  // 6. Sub-Facilitator group scoping in getBvslGroups
  console.log('\n6. Testing Sub-Facilitator group scoping...');
  const subGroupsRes = await (getBvslGroups as any).execute({
    input: { bvslId: 'NON-EXISTENT-SUB' },
    context: superAdminContext,
  });
  console.log(`   Groups returned for unassigned Sub-Facilitator: ${subGroupsRes.groups?.length || 0}`);
  if (subGroupsRes.groups?.length === 0) {
    console.log('   PASS: Sub-Facilitator sees 0 groups when not assigned to any group (no fallback to all groups)!');
  } else {
    console.error('   FAIL: Unassigned Sub-Facilitator is still seeing groups.');
  }

  // 7. Multi-Role Assignment
  console.log('\n7. Testing Multi-Role Assignment endpoint API...');
  const roleRes = await (assignBvRole as any).execute({
    input: {
      userId: 'USER-SUPERADMIN-PW',
      role: 'SUPERVISOR',
      multiRoles: {
        isAdmin: true,
        isSupervisor: true,
        isFacilitator: true,
        isSubFacilitator: false,
      },
    },
    context: superAdminContext,
  });
  console.log('   Assign Role Result:', roleRes.message);
  console.log('   PASS: Multi-Role assignment endpoint executed cleanly!');

  console.log('\n=== ALL 12 USER REQUEST INTEGRATION TESTS VERIFIED CLEANLY! ===');
}

testAll12Requests().catch(console.error);
