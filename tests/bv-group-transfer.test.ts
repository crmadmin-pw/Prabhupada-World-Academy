import assert from 'node:assert/strict';
import test from 'node:test';

import transferBvGroupMember from '../src/api/transferBvGroupMember';
import getUserProfile from '../src/api/getUserProfile';
import getUserBvStatus from '../src/api/getUserBvStatus';
import acknowledgeBvRoleNotice from '../src/api/acknowledgeBvRoleNotice';
import { BvGroupMembers, BvGroups, Users } from '../src/lib/app-backend-sdk';

test('moving a BV member replaces old memberships and synchronizes their profile', async () => {
  const facilitator = {
    id: 'BV-TRANSFER-RGF-DOC',
    userId: 'BV-TRANSFER-RGF',
    fullName: 'Transfer RGF',
    status: 'Active',
    segment: 'PW',
    isBvFacilitator: true,
    bvReportingSupervisorId: 'BV-TRANSFER-SUPERVISOR',
  };
  const member = {
    id: 'BV-TRANSFER-MEMBER-DOC',
    userId: 'BV-TRANSFER-MEMBER',
    email: 'bv-transfer-member@example.invalid',
    fullName: 'Transfer Member',
    status: 'Active',
    segment: 'PW',
    isBvMember: true,
    bvGroupId: 'BV-TRANSFER-OLD-GROUP-DOC',
  };
  const oldGroup = { id: 'BV-TRANSFER-OLD-GROUP-DOC', groupId: 'BV-TRANSFER-OLD-GROUP', groupName: 'Old Group', segment: 'PW', isActive: true };
  const newGroup = { id: 'BV-TRANSFER-NEW-GROUP-DOC', groupId: 'BV-TRANSFER-NEW-GROUP', groupName: 'New Group', segment: 'PW', isActive: true, bvslLeader: facilitator.id };
  const oldMembershipId = 'BV-TRANSFER-OLD-MEMBERSHIP';
  const newMembershipId = `BVMEM-${member.id}-${newGroup.id}`;

  try {
    await Users.create({ record: facilitator });
    await Users.create({ record: member });
    await BvGroups.create({ record: oldGroup });
    await BvGroups.create({ record: newGroup });
    await BvGroupMembers.create({
      record: { id: oldMembershipId, group: oldGroup.groupId, memberId: member.email, role: 'Member' },
    });

    const result = await transferBvGroupMember.execute({
      input: { userId: member.userId, groupId: newGroup.groupId },
      context: { user: { id: 'BV-TRANSFER-ADMIN' } },
    } as never);

    assert.equal(result.success, true);
    assert.equal(result.groupName, newGroup.groupName);
    assert.equal(await BvGroupMembers.findOne({ id: oldMembershipId }), undefined);
    assert.ok(await BvGroupMembers.findOne({ id: newMembershipId }));

    const updatedMember = await Users.findOne({ id: member.id });
    assert.equal(updatedMember?.bvGroupId, newGroup.id);
    assert.equal(updatedMember?.bvGroupName, newGroup.groupName);
    assert.equal(updatedMember?.bvReportingFacilitatorId, facilitator.userId);
    assert.equal(updatedMember?.pendingBvGroupAssignmentNotice, true);
    assert.equal(updatedMember?.roleNoticeAcknowledged, false);

    const assignedContext = { user: { id: member.id, userId: member.userId, email: member.email } };
    const assignedProfile = await getUserProfile.execute({ input: {}, context: assignedContext } as never);
    assert.equal(assignedProfile.user?.pendingBvGroupAssignmentNotice, true);
    assert.equal(assignedProfile.user?.bvGroupName, newGroup.groupName);
    assert.equal(assignedProfile.user?.isBvMember, true);

    // The membership row can be briefly invisible to the profile read that
    // opens the member's notice. That read must not erase the assignment.
    await BvGroupMembers.delete({ id: newMembershipId });
    const preservedProfile = await getUserProfile.execute({ input: {}, context: assignedContext } as never);
    assert.equal(preservedProfile.user?.pendingBvGroupAssignmentNotice, true);
    assert.equal(preservedProfile.user?.bvGroupName, newGroup.groupName);
    assert.equal(preservedProfile.user?.bvGroupId, newGroup.id);
    assert.equal(preservedProfile.user?.isBvMember, true);

    // Legacy array references must also disappear, including duplicates in
    // a different group. Profile refresh must not restore attendance access.
    await BvGroupMembers.create({ record: {
      id: oldMembershipId, group: oldGroup.id, user: [member.userId], role: 'Member',
    } });
    await transferBvGroupMember.execute({
      input: { userId: member.userId, groupId: null },
      context: { user: { id: 'BV-TRANSFER-ADMIN' } },
    } as never);
    assert.equal(await BvGroupMembers.findOne({ id: oldMembershipId }), undefined);
    assert.equal(await BvGroupMembers.findOne({ id: newMembershipId }), undefined);
    const context = { user: { id: member.id, userId: member.userId, email: member.email } };
    const profile = await getUserProfile.execute({ input: {}, context } as never);
    assert.equal(profile.user?.isBvMember, false);
    assert.ok(!profile.user?.bvGroupId);
    assert.ok(!profile.user?.bvGroupName);
    assert.equal(profile.user?.pendingBvGroupRemovalNotice, true);
    assert.equal(profile.user?.roleNoticeAcknowledged, false);
    const status = await getUserBvStatus.execute({ input: {}, context } as never);
    assert.equal(status.myGroup, null);
    await acknowledgeBvRoleNotice.execute({ input: {}, context } as never);
    const acknowledgedProfile = await getUserProfile.execute({ input: {}, context } as never);
    assert.equal(acknowledgedProfile.user?.pendingBvGroupRemovalNotice, false);
    assert.equal(acknowledgedProfile.user?.roleNoticeAcknowledged, true);
  } finally {
    await BvGroupMembers.delete({ id: oldMembershipId }).catch(() => undefined);
    await BvGroupMembers.delete({ id: newMembershipId }).catch(() => undefined);
    await BvGroups.delete({ id: oldGroup.id }).catch(() => undefined);
    await BvGroups.delete({ id: newGroup.id }).catch(() => undefined);
    await Users.delete({ id: member.id }).catch(() => undefined);
    await Users.delete({ id: facilitator.id }).catch(() => undefined);
  }
});
