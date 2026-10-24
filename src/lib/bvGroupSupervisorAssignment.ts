import { AppError, Users } from '@/lib/backend-sdk';
import { organizationalDepartment } from './directoryDepartment';
import { isHierarchyAdmin, isHierarchySuperAdmin } from './hierarchyUtils';
import { isBvSupervisorUser, resolveBvScopedGroups } from './bvGroupMemberScope';

export async function assertCanAssignGroupSupervisor(caller: any, group: any): Promise<void> {
  if (!isHierarchyAdmin(caller)) {
    throw new AppError({ code: 'FORBIDDEN', message: 'Only an Admin can assign a reading group supervisor.' });
  }
  const department = organizationalDepartment(group);
  const callerDepartment = organizationalDepartment(caller);
  if (department && callerDepartment && department !== callerDepartment) {
    throw new AppError({ code: 'FORBIDDEN', message: 'Choose a reading group in your department.' });
  }
  if (!isHierarchySuperAdmin(caller)) {
    await resolveBvScopedGroups(caller, { groupId: String(group.id || group.groupId), segment: department || undefined, includeInactive: true });
  }
}

export async function resolveGroupSupervisor(rawId: string, group: any) {
  if (!rawId.trim()) return { supervisorId: '', supervisorUserId: '', supervisorName: '' };
  const id = rawId.trim();
  const user = await Users.findOne({ id })
    || await Users.findOne({ filters: { userId: id } })
    || await Users.findOne({ filters: { email: id.toLowerCase() } });
  if (!user || !isBvSupervisorUser(user) || (user.status && String(user.status).toLowerCase() !== 'active')) {
    throw new AppError({ code: 'BAD_REQUEST', message: 'Choose an active supervisor.' });
  }
  if (!organizationalDepartment(group) || organizationalDepartment(user) !== organizationalDepartment(group)) {
    throw new AppError({ code: 'BAD_REQUEST', message: 'Choose a supervisor from the reading group’s department.' });
  }
  return {
    supervisorId: String(user.id),
    supervisorUserId: String(user.userId || user.id),
    supervisorName: String(user.fullName || user.email || ''),
  };
}
