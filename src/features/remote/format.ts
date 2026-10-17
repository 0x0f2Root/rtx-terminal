/** Formatting helpers shared by the file manager and the resource monitor. Units are IEC (1024)
 *  so sizes match what servers report; rates are shown per second. */

const BYTE_UNITS = ['B', 'KiB', 'MiB', 'GiB', 'TiB', 'PiB'] as const;

export function formatBytes(bytes: number | null, fractionDigits = 1): string {
  if (bytes === null || !Number.isFinite(bytes)) return '—';
  if (bytes < 1024) return `${bytes} B`;
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < BYTE_UNITS.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(fractionDigits)} ${BYTE_UNITS[unit]}`;
}

/** A short IEC size for chart axes, where the unit is stated once in the chart's description. */
export function formatBytesCompact(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 1024) return `${Math.round(bytes)}`;
  const units = ['K', 'M', 'G', 'T'] as const;
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value >= 10 ? Math.round(value) : value.toFixed(1)}${units[unit]}`;
}

export function formatBytesPerSecond(bytesPerSecond: number | null): string {
  if (bytesPerSecond === null || !Number.isFinite(bytesPerSecond)) return '—';
  return `${formatBytes(bytesPerSecond, 1)}/s`;
}

export function formatPercent(
  value: number | null,
  fractionDigits = 0,
): string {
  if (value === null || !Number.isFinite(value)) return '—';
  return `${value.toFixed(fractionDigits)}%`;
}

/** A short clock time for chart axes and the last-sample line (local time, never the remote clock). */
export function formatClock(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

export function formatDateTime(epochMs: number | null): string {
  if (epochMs === null || !Number.isFinite(epochMs)) return '—';
  return new Date(epochMs).toLocaleString([], {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** Humanises an elapsed-seconds count, e.g. 3725 -> "1h 2m". */
export function formatDuration(seconds: number | null): string {
  if (seconds === null || !Number.isFinite(seconds) || seconds < 0) return '—';
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

/** Elapsed time since an epoch-ms instant, short form (for transfer rows). */
export function formatElapsedSince(
  startedAt: number,
  now = Date.now(),
): string {
  return formatDuration(Math.max(0, Math.round((now - startedAt) / 1000)));
}
