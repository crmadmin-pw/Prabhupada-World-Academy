import { createContext, useContext, type ReactNode } from 'react';

const SupervisionScopeContext = createContext(false);

/** Supervisor dashboard reports stay on the groups an admin assigned. */
export function SupervisionScopeProvider({ children }: { children: ReactNode }) {
  return <SupervisionScopeContext.Provider value={true}>{children}</SupervisionScopeContext.Provider>;
}

export function useSupervisionOnly(): boolean {
  return useContext(SupervisionScopeContext);
}
