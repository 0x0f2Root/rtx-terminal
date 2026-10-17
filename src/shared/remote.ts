/**
 * Data models for the Remote File Manager and the Live Resource Monitor. Shared by the main
 * process (which produces every value from a real SFTP channel or a fixed remote command) and the
 * renderer (which only ever sees validated values). Nothing here carries credentials.
 *
 * All sizes are bytes and all times are epoch milliseconds. A value that could not be read is
 * `null` rather than 0, so the UI can show "unavailable" instead of a misleading zero.
 */

// --- Remote file manager ----------------------------------------------------------------------

export type RemoteFileType = 'file' | 'directory' | 'symlink' | 'other';

/** One entry in a remote directory, from SFTP attributes. Owner/group are numeric ids: SFTP does
 *  not carry names, and resolving them would need a shell command, which this feature never runs. */
export type RemoteDirEntry = {
  name: string;
  /** The entry's own type. A symbolic link is `symlink` regardless of what it points at. */
  type: RemoteFileType;
  size: number;
  /** Modification time in epoch milliseconds, or null when the server did not report one. */
  mtime: number | null;
  /** Raw permission bits (the low 12 bits of st_mode). */
  mode: number;
  /** Rendered permission string such as "rwxr-xr-x". */
  permissions: string;
  uid: number;
  gid: number;
  /** For a symlink: the link's text target, and the type it resolves to when that can be read. */
  linkTarget: string | null;
  resolvedType: RemoteFileType | null;
};

export type RemoteListing = {
  /** The absolute path that was listed (already resolved; never relative). */
  path: string;
  entries: RemoteDirEntry[];
};

export type RemoteStat = {
  path: string;
  type: RemoteFileType;
  size: number;
  mtime: number | null;
  mode: number;
};

export type TransferDirection = 'upload' | 'download';

export type TransferStatus =
  | 'queued'
  | 'transferring'
  | 'completed'
  /** Not transferred because the destination existed and the user chose to skip it. */
  | 'skipped'
  | 'cancelled'
  | 'failed';

/** Live state of one file transfer, streamed to the renderer as it changes. */
export type TransferProgress = {
  id: string;
  connectionId: string;
  direction: TransferDirection;
  /** The file's base name, for display. */
  name: string;
  /** Absolute source path (local for upload, remote for download). */
  source: string;
  /** Absolute destination path. */
  destination: string;
  /** Total bytes when known; null while unknown. */
  total: number | null;
  transferred: number;
  /** Bytes per second over the most recent window; null until measurable. */
  bytesPerSecond: number | null;
  status: TransferStatus;
  /** A message safe to show when status is 'failed'. */
  error: string | null;
  startedAt: number;
  updatedAt: number;
};

/** How to resolve a name that already exists at the destination. */
export type ConflictResolution = 'overwrite' | 'rename' | 'skip';

export type RemoteFileErrorCode =
  | 'no-sftp'
  | 'permission-denied'
  | 'not-found'
  | 'not-a-directory'
  | 'exists'
  | 'no-space'
  | 'disconnected'
  | 'cancelled'
  | 'conflict'
  | 'unsupported'
  | 'invalid'
  | 'io';

/** Discriminated result used by every file-manager operation that can fail with a known cause. */
export type RemoteResult<T> =
  | ({ ok: true } & T)
  | { ok: false; code: RemoteFileErrorCode; error: string };

// --- Live resource monitor --------------------------------------------------------------------

/** Whether a collector produced a value this tick. Each metric reports its own availability so one
 *  unsupported metric never blanks the others. */
export type MetricState = 'ok' | 'unavailable';

export type MetricBlock<T> =
  | { state: 'ok'; value: T }
  | { state: 'unavailable'; reason: string };

export type CpuMetric = {
  /**
   * Overall busy percentage over the last interval (0-100), from two /proc/stat samples. null on
   * the first sample, when there is no earlier one to compare with: it is never reported as 0.
   */
  utilization: number | null;
  /** Component percentages over the same interval (sum to roughly 100); null with utilization. */
  breakdown: {
    user: number;
    system: number;
    idle: number;
    iowait: number;
  } | null;
  cores: number | null;
  /** 1, 5 and 15 minute load averages; distinct from utilization. */
  loadAverage: [number, number, number] | null;
  /** Per-core busy percentages, when a reliable breakdown was available. */
  perCore: number[] | null;
};

export type MemoryMetric = {
  total: number;
  /** total - available: memory genuinely in use, treating reclaimable cache as free. */
  used: number;
  available: number;
  free: number;
  buffers: number | null;
  cached: number | null;
  swapTotal: number | null;
  swapUsed: number | null;
  /** used / total as a percentage (0-100). */
  utilization: number;
};

export type FilesystemMetric = {
  filesystem: string;
  mountpoint: string;
  type: string | null;
  total: number;
  used: number;
  available: number;
  /** used capacity as a percentage of total (0-100). */
  utilization: number;
  /** True for tmpfs/devtmpfs/overlay and similar non-physical mounts. */
  pseudo: boolean;
};

export type DiskIoMetric = {
  device: string;
  /** Throughput since the previous sample; null when it cannot be measured (first sample, counter reset). */
  readBytesPerSecond: number | null;
  writeBytesPerSecond: number | null;
};

export type NetworkInterfaceMetric = {
  name: string;
  /** Throughput since the previous sample; null when it cannot be measured (first sample, counter reset). */
  receiveBytesPerSecond: number | null;
  transmitBytesPerSecond: number | null;
  receiveBytes: number;
  transmitBytes: number;
  receivePackets: number;
  transmitPackets: number;
  receiveErrors: number;
  transmitErrors: number;
  receiveDrops: number;
  transmitDrops: number;
};

export type ProcessMetric = {
  pid: number;
  ppid: number;
  name: string;
  user: string;
  /** Per-process CPU percentage as reported by ps (may exceed 100 on multicore). */
  cpu: number;
  /** Resident memory as a percentage of total. */
  memoryPercent: number;
  /** Resident set size in bytes. */
  rss: number;
  state: string;
  /** Elapsed run time in seconds, when reported. */
  elapsedSeconds: number | null;
};

export type HostFacts = {
  /** Kernel/OS description from `uname`, when available. */
  os: string | null;
  /** Uptime in seconds from /proc/uptime, when available. */
  uptimeSeconds: number | null;
};

/** One complete poll of a host. Every block is independent; `timestamp` is the local clock at the
 *  moment the sample was received, never the remote clock. */
export type MetricsSample = {
  connectionId: string;
  timestamp: number;
  facts: HostFacts;
  cpu: MetricBlock<CpuMetric>;
  memory: MetricBlock<MemoryMetric>;
  filesystems: MetricBlock<FilesystemMetric[]>;
  diskIo: MetricBlock<DiskIoMetric[]>;
  network: MetricBlock<NetworkInterfaceMetric[]>;
  processes: MetricBlock<ProcessMetric[]>;
};

export type MonitorStatus =
  | 'connecting'
  | 'sampling'
  | 'idle'
  | 'disconnected'
  | 'error';

/** A state change for a monitor, separate from the per-tick samples. */
export type MonitorEvent =
  | {
      connectionId: string;
      kind: 'status';
      status: MonitorStatus;
      detail?: string;
    }
  | { connectionId: string; kind: 'sample'; sample: MetricsSample };

export const MONITOR_INTERVAL = {
  min: 1000,
  default: 2000,
  max: 30000,
} as const;
