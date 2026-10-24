import type { PwGroupRoleOption } from './pwGroupRoles';

type Person = { id: string; name: string; rawUser?: any };
export function rgsfAssignmentOptions(people: Person[], groups: PwGroupRoleOption[]) {
  return groups.filter(group => group.isActive !== false).flatMap(group => people.flatMap(person => {
    const refs = [person.id, person.name, person.rawUser?.id, person.rawUser?.userId, person.rawUser?.email, person.rawUser?.fullName]
      .filter(Boolean).map(value => String(value).trim().toLowerCase());
    const leads = (group.rgfIds ?? group.facilitatorIds ?? []).some(id => refs.includes(String(id).trim().toLowerCase()));
    return leads ? [{ key: JSON.stringify([group.id, person.id]), groupId: group.id, rgfId: person.id, rgfName: person.name, label: `${person.name} — ${group.groupName}` }] : [];
  }));
}
