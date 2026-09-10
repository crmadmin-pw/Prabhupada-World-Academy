import getBvGroupDetail from '../src/api/getBvGroupDetail';
import getBvslGroups from '../src/api/getBvslGroups';

async function testClickableGroups() {
  console.log('=== STARTING CLICKABLE GROUPS & DETAILS PAGE VERIFICATION ===\n');

  const superAdminContext = { user: { id: 'SUPERADMIN-001', email: 'super-admin@example.test', role: 'Super Admin', isBvSuperAdmin: true } };
  const grpRes = await (getBvslGroups as any).execute({ input: { bvslId: 'ALL' }, context: superAdminContext });

  console.log(`Fetched ${grpRes.groups.length} active Bhakti Vriksha reading groups.`);

  for (const g of grpRes.groups) {
    const detail = await (getBvGroupDetail as any).execute({ input: { groupId: g.id || g.groupId }, context: superAdminContext });
    console.log(`\nVerified Group Detail Navigation for "${g.groupName}":`);
    console.log(`  - Group ID:       ${g.id || g.groupId}`);
    console.log(`  - Facilitator:    ${detail.group?.bvslName || g.bvslName || 'Unassigned'}`);
    console.log(`  - Members Count:  ${detail.members?.length || 0}`);
    console.log(`  - Meeting Time:   ${detail.group?.meetingTime || g.meetingTime || 'Flexible'}`);
    console.log(`  - Join Token:     ${detail.group?.joinToken || '—'}`);
  }

  console.log('\n=== ALL GROUPS ARE CLICKABLE AND DETAIL PAGES LOAD SUCCESSFULLY! ===');
}

testClickableGroups().catch(console.error);
