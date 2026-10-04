export const SUPPORTED_DYNAMIC_VARIABLES: readonly string[];
export const DYNAMIC_VARIABLE_GROUPS: Readonly<Record<string, readonly string[]>>;
export function dynamicValue(name: string): string | undefined;
export function createDynamicResolver(initial?: Record<string, string>): (name: string) => string | undefined;
