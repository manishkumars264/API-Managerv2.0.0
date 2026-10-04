import { createContext, useContext, useMemo, type ReactNode } from 'react';
import type { ApiRequest, Workspace } from '../types';
import { buildVariableContext, type VariableContextValue } from '../lib/variable-details';

const VariableContext = createContext<VariableContextValue | null>(null);
export function VariableContextProvider({ workspace, request, children }: { workspace: Workspace; request?: ApiRequest; children: ReactNode }) {
  const value = useMemo(() => buildVariableContext(workspace, request), [workspace, request]);
  return <VariableContext.Provider value={value}>{children}</VariableContext.Provider>;
}
export const useVariableContext = () => useContext(VariableContext);
