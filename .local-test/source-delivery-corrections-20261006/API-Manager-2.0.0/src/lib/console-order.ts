/** Newest activity appears first, while equal or invalid timestamps keep their input order. */
export function newestConsoleEntries<T extends { timestamp: string }>(entries: readonly T[]): T[] {
  const time = (value: string) => {
    const milliseconds = typeof value === 'string' ? Date.parse(value) : NaN;
    return Number.isFinite(milliseconds) ? milliseconds : -Infinity;
  };
  return entries.map((entry, index) => ({ entry, index, time: time(entry.timestamp) }))
    .sort((left, right) => left.time === right.time ? left.index - right.index : left.time > right.time ? -1 : 1)
    .map(item => item.entry);
}

/** Script output has an execution sequence rather than timestamps; display the latest message first. */
export function newestScriptLogs<T>(logs: readonly T[]): T[] {
  return [...logs].reverse();
}
