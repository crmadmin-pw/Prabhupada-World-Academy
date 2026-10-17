import { AppError } from '@/lib/backend-sdk';
import type { ApiUserContext } from './apiAuthorization';

type ServiceManager = Pick<ApiUserContext, 'role' | 'isServiceAllocator'>;

/** The rule the service allocation endpoints already apply (see
 * publishAllocation): guides and tagged service allocators manage services.
 * The FOLK Management tab that edits the catalog is shown to the same people. */
export function canManageServices(user: ServiceManager | null | undefined): boolean {
  if (!user) return false;
  const role = String(user.role ?? '');
  return ['Guide', 'Super Guide', 'BVSL'].includes(role) || user.isServiceAllocator === true;
}

export function assertCanManageServices(user: ServiceManager | null | undefined): void {
  if (!user) throw new Error('Unauthorized');
  if (!canManageServices(user)) {
    throw new AppError({ code: 'FORBIDDEN', message: 'Only guides or service allocators can manage services' });
  }
}
