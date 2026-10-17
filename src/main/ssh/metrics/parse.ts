import type {
  CpuMetric,
  DiskIoMetric,
  FilesystemMetric,
  MemoryMetric,
  NetworkInterfaceMetric,
  ProcessMetric,
} from '../../../shared/remote';

/**
 * Pure parsers for the Linux counters the monitor reads. Each takes the raw text of one /proc file
 * or command and returns typed values; none performs I/O, so they are unit-tested directly. Rates
 * that need two samples (CPU %, network and disk throughput) are computed by the collector from the
 * raw counters these return, never from a single instantaneous reading.
 */

const SECTOR_BYTES = 512;

// --- CPU --------------------------------------------------------------------------------------

/** Cumulative jiffies for one CPU line in /proc/stat. */
export type CpuTimes = {
  total: number;
  idle: number;
  user: number;
  system: number;
  iowait: number;
};

export type CpuSnapshot = {
  all: CpuTimes;
  perCore: CpuTimes[];
};

function cpuTimes(fields: number[]): CpuTimes {
  const [
    user = 0,
    nice = 0,
    system = 0,
    idle = 0,
    iowait = 0,
    irq = 0,
    softirq = 0,
    steal = 0,
  ] = fields;
  const total = user + nice + system + idle + iowait + irq + softirq + steal;
  return {
    total,
    idle: idle + iowait,
    user: user + nice,
    system: system + irq + softirq + steal,
    iowait,
  };
}

/** Parses /proc/stat into the aggregate and per-core cumulative counters. */
export function parseProcStat(text: string): CpuSnapshot | null {
  let all: CpuTimes | null = null;
  const perCore: CpuTimes[] = [];
  for (const line of text.split('\n')) {
    if (!line.startsWith('cpu')) continue;
    const label = line.slice(
      0,
      line.indexOf(' ') === -1 ? line.length : line.indexOf(' '),
    );
    const fields = line
      .slice(label.length)
      .trim()
      .split(/\s+/)
      .map((n) => Number(n))
      .filter((n) => Number.isFinite(n));
    if (fields.length < 4) continue;
    if (label === 'cpu') all = cpuTimes(fields);
    else if (/^cpu\d+$/.test(label)) perCore.push(cpuTimes(fields));
  }
  return all ? { all, perCore } : null;
}

/** Busy percentage and component breakdown between two cumulative CPU counters. */
export function cpuUtilization(
  previous: CpuTimes,
  current: CpuTimes,
): {
  utilization: number | null;
  breakdown: CpuMetric['breakdown'];
} {
  const totalDelta = current.total - previous.total;
  // No jiffies elapsed (or the counters went backwards after a reboot): nothing was measured.
  if (totalDelta <= 0) return { utilization: null, breakdown: null };
  const idleDelta = Math.max(0, current.idle - previous.idle);
  const pct = (value: number) =>
    Math.min(100, Math.max(0, (value / totalDelta) * 100));
  return {
    utilization: pct(totalDelta - idleDelta),
    breakdown: {
      user: pct(current.user - previous.user),
      system: pct(current.system - previous.system),
      idle: pct(idleDelta),
      iowait: pct(current.iowait - previous.iowait),
    },
  };
}

export function parseLoadAverage(
  text: string,
): [number, number, number] | null {
  const parts = text.trim().split(/\s+/).map(Number);
  return parts.length >= 3 && parts.slice(0, 3).every(Number.isFinite)
    ? [parts[0], parts[1], parts[2]]
    : null;
}

export function parseCount(text: string): number | null {
  const value = Number(text.trim());
  return Number.isInteger(value) && value > 0 ? value : null;
}

export function parseUptime(text: string): number | null {
  const value = Number(text.trim().split(/\s+/)[0]);
  return Number.isFinite(value) ? value : null;
}

// --- memory -----------------------------------------------------------------------------------

/** Parses /proc/meminfo (values are kB) into bytes. Utilization uses available memory, so
 *  reclaimable page cache is not counted as used. */
export function parseMeminfo(text: string): MemoryMetric | null {
  const values = new Map<string, number>();
  for (const line of text.split('\n')) {
    const match = /^(\w+):\s+(\d+)\s*kB/.exec(line.trim());
    if (match) values.set(match[1], Number(match[2]) * 1024);
  }
  const total = values.get('MemTotal');
  const free = values.get('MemFree');
  if (total === undefined || free === undefined || total === 0) return null;
  const buffers = values.get('Buffers') ?? null;
  const cached = values.get('Cached') ?? null;
  // MemAvailable is the kernel's own estimate; fall back to free + buffers + cache on old kernels.
  const available =
    values.get('MemAvailable') ?? free + (buffers ?? 0) + (cached ?? 0);
  const used = Math.max(0, total - available);
  const swapTotal = values.get('SwapTotal') ?? null;
  const swapFree = values.get('SwapFree');
  const swapUsed =
    swapTotal !== null && swapFree !== undefined
      ? Math.max(0, swapTotal - swapFree)
      : null;
  return {
    total,
    used,
    available,
    free,
    buffers,
    cached,
    swapTotal,
    swapUsed,
    utilization: (used / total) * 100,
  };
}

// --- filesystems ------------------------------------------------------------------------------

const PSEUDO_FS = new Set([
  'tmpfs',
  'devtmpfs',
  'devfs',
  'sysfs',
  'proc',
  'cgroup',
  'cgroup2',
  'overlay',
  'squashfs',
  'ramfs',
  'mqueue',
  'debugfs',
  'tracefs',
  'securityfs',
  'pstore',
  'autofs',
]);

/** mount point -> filesystem type, from /proc/mounts. */
export function parseMounts(text: string): Map<string, string> {
  const map = new Map<string, string>();
  for (const line of text.split('\n')) {
    const fields = line.split(/\s+/);
    if (fields.length >= 3) map.set(unescapeMount(fields[1]), fields[2]);
  }
  return map;
}

/** /proc/mounts escapes spaces and a few other characters as octal (e.g. "\040"). */
function unescapeMount(value: string): string {
  return value.replace(/\\(\d{3})/g, (_m, oct: string) =>
    String.fromCharCode(parseInt(oct, 8)),
  );
}

/** Parses `df -kP` output (1024-byte blocks) joined with filesystem types from /proc/mounts. */
export function parseDf(
  text: string,
  types: Map<string, string>,
): FilesystemMetric[] {
  const lines = text.trim().split('\n');
  const out: FilesystemMetric[] = [];
  for (const line of lines) {
    if (/^Filesystem\s/.test(line)) continue;
    // POSIX -P guarantees: fs, 1024-blocks, used, available, capacity%, mount (mount is last).
    const fields = line.trim().split(/\s+/);
    if (fields.length < 6) continue;
    const mountpoint = fields.slice(5).join(' ');
    const total = Number(fields[1]) * 1024;
    const used = Number(fields[2]) * 1024;
    const available = Number(fields[3]) * 1024;
    if (!Number.isFinite(total) || total <= 0) continue;
    const type = types.get(mountpoint) ?? null;
    out.push({
      filesystem: fields[0],
      mountpoint,
      type,
      total,
      used,
      available,
      utilization: (used / total) * 100,
      pseudo: type
        ? PSEUDO_FS.has(type)
        : /^(tmpfs|devtmpfs|overlay)$/.test(fields[0]),
    });
  }
  return out;
}

// --- disk I/O ---------------------------------------------------------------------------------

/** device -> cumulative sectors read/written, from /proc/diskstats. */
export type DiskCounters = Map<
  string,
  { readBytes: number; writeBytes: number }
>;

export function parseDiskstats(text: string): DiskCounters {
  const map: DiskCounters = new Map();
  for (const line of text.split('\n')) {
    const fields = line.trim().split(/\s+/);
    if (fields.length < 10) continue;
    const name = fields[2];
    // Skip partitions and non-physical devices; keep whole disks (sdX, vdX, nvmeXnY, mmcblkX).
    if (
      !/^(sd[a-z]+|vd[a-z]+|nvme\d+n\d+|mmcblk\d+|xvd[a-z]+|hd[a-z]+)$/.test(
        name,
      )
    )
      continue;
    const sectorsRead = Number(fields[5]);
    const sectorsWritten = Number(fields[9]);
    if (!Number.isFinite(sectorsRead) || !Number.isFinite(sectorsWritten))
      continue;
    map.set(name, {
      readBytes: sectorsRead * SECTOR_BYTES,
      writeBytes: sectorsWritten * SECTOR_BYTES,
    });
  }
  return map;
}

// --- network ----------------------------------------------------------------------------------

export type NetCounters = Map<
  string,
  {
    receiveBytes: number;
    transmitBytes: number;
    receivePackets: number;
    transmitPackets: number;
    receiveErrors: number;
    transmitErrors: number;
    receiveDrops: number;
    transmitDrops: number;
  }
>;

/** Parses /proc/net/dev cumulative counters per interface. */
export function parseNetDev(text: string): NetCounters {
  const map: NetCounters = new Map();
  for (const line of text.split('\n')) {
    const colon = line.indexOf(':');
    if (colon === -1) continue;
    const name = line.slice(0, colon).trim();
    if (!name || name === 'Inter-|') continue;
    const fields = line
      .slice(colon + 1)
      .trim()
      .split(/\s+/)
      .map(Number);
    if (fields.length < 12 || fields.some((n) => !Number.isFinite(n))) continue;
    // Columns: rxbytes rxpkts rxerrs rxdrop ... (8 rx) then txbytes txpkts txerrs txdrop ...
    map.set(name, {
      receiveBytes: fields[0],
      receivePackets: fields[1],
      receiveErrors: fields[2],
      receiveDrops: fields[3],
      transmitBytes: fields[8],
      transmitPackets: fields[9],
      transmitErrors: fields[10],
      transmitDrops: fields[11],
    });
  }
  return map;
}

/**
 * Per-second rate between two cumulative counters. Returns null when no rate can be measured: no
 * time has passed, or the counter went backwards (it wrapped, or the device or interface reset).
 * An unknown rate is reported as unknown, never as zero.
 */
export function rate(
  previous: number,
  current: number,
  seconds: number,
): number | null {
  if (seconds <= 0) return null;
  if (current < previous) return null;
  return (current - previous) / seconds;
}

// --- processes --------------------------------------------------------------------------------

/** Parses `ps -eo pid=,ppid=,user=,stat=,etimes=,pcpu=,pmem=,rss=,comm=` output. RSS is in kB. */
export function parsePs(text: string): ProcessMetric[] {
  const out: ProcessMetric[] = [];
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const fields = trimmed.split(/\s+/);
    if (fields.length < 9) continue;
    const pid = Number(fields[0]);
    const ppid = Number(fields[1]);
    if (!Number.isInteger(pid)) continue;
    const user = fields[2];
    const state = fields[3];
    const elapsed = Number(fields[4]);
    const cpu = Number(fields[5]);
    const memoryPercent = Number(fields[6]);
    const rssKb = Number(fields[7]);
    const name = fields.slice(8).join(' ');
    out.push({
      pid,
      ppid: Number.isInteger(ppid) ? ppid : 0,
      name,
      user,
      cpu: Number.isFinite(cpu) ? cpu : 0,
      memoryPercent: Number.isFinite(memoryPercent) ? memoryPercent : 0,
      rss: Number.isFinite(rssKb) ? rssKb * 1024 : 0,
      state,
      elapsedSeconds: Number.isFinite(elapsed) ? elapsed : null,
    });
  }
  return out;
}

export type {
  CpuMetric,
  DiskIoMetric,
  FilesystemMetric,
  MemoryMetric,
  NetworkInterfaceMetric,
  ProcessMetric,
};
