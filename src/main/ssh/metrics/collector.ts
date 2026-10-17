import type {
  CpuMetric,
  DiskIoMetric,
  FilesystemMetric as FilesystemMetricValue,
  HostFacts,
  MemoryMetric as MemoryMetricValue,
  MetricBlock,
  MetricsSample,
  NetworkInterfaceMetric,
  ProcessMetric as ProcessMetricValue,
} from '../../../shared/remote';
import type { SshConnection } from '../ssh-connection';
import {
  cpuUtilization,
  parseCount,
  parseDf,
  parseDiskstats,
  parseLoadAverage,
  parseMeminfo,
  parseMounts,
  parseNetDev,
  parseProcStat,
  parsePs,
  parseUptime,
  rate,
  type CpuSnapshot,
  type DiskCounters,
  type NetCounters,
} from './parse';

/**
 * Collects one complete sample from a host over a single exec channel. The command is fixed,
 * application-defined, read-only and runs under LC_ALL=C; no host metadata or user input is ever
 * interpolated into it. Rates (CPU %, network and disk throughput) are derived from the difference
 * between this sample's counters and the previous one, using the local clock for elapsed time.
 */

const MARKERS = [
  'CPU',
  'MEM',
  'NET',
  'DISK',
  'MOUNTS',
  'FS',
  'LOAD',
  'UP',
  'NPROC',
  'UNAME',
  'PROC',
] as const;
type Marker = (typeof MARKERS)[number];

/** The one command a tick runs. Each section is preceded by a marker line so the output can be
 *  split without guessing. stderr is discarded per section so one missing file never aborts the
 *  rest. */
export const METRICS_COMMAND = [
  'export LC_ALL=C 2>/dev/null',
  "printf '@@CPU@@\\n'; cat /proc/stat 2>/dev/null",
  "printf '@@MEM@@\\n'; cat /proc/meminfo 2>/dev/null",
  "printf '@@NET@@\\n'; cat /proc/net/dev 2>/dev/null",
  "printf '@@DISK@@\\n'; cat /proc/diskstats 2>/dev/null",
  "printf '@@MOUNTS@@\\n'; cat /proc/mounts 2>/dev/null",
  "printf '@@FS@@\\n'; df -kP 2>/dev/null",
  "printf '@@LOAD@@\\n'; cat /proc/loadavg 2>/dev/null",
  "printf '@@UP@@\\n'; cat /proc/uptime 2>/dev/null",
  "printf '@@NPROC@@\\n'; nproc 2>/dev/null",
  "printf '@@UNAME@@\\n'; uname -sr 2>/dev/null",
  "printf '@@PROC@@\\n'; ps -eo pid=,ppid=,user=,stat=,etimes=,pcpu=,pmem=,rss=,comm= 2>/dev/null",
].join('\n');

const DEFAULT_TIMEOUT_MS = 8000;
const MAX_OUTPUT_BYTES = 4 * 1024 * 1024;

export type ExecOutcome = {
  stdout: string;
  stderr: string;
  code: number | null;
};

/** Runs one command on a fresh exec channel, bounding output size and total time. */
export async function runCommand(
  connection: SshConnection,
  command: string,
  options: { timeoutMs?: number; maxBytes?: number } = {},
): Promise<ExecOutcome> {
  const channel = await connection.exec(command);
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxBytes = options.maxBytes ?? MAX_OUTPUT_BYTES;
  return new Promise<ExecOutcome>((resolve, reject) => {
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    let outLen = 0;
    let code: number | null = null;
    let settled = false;
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn();
    };
    const timer = setTimeout(() => {
      finish(() => {
        try {
          channel.close();
        } catch {
          // Already closed.
        }
        reject(new Error('The command timed out.'));
      });
    }, timeoutMs);
    timer.unref();
    channel.on('data', (chunk: Buffer) => {
      outLen += chunk.length;
      if (outLen <= maxBytes) out.push(chunk);
      else if (!settled) {
        finish(() => {
          try {
            channel.close();
          } catch {
            // Already closed.
          }
          reject(new Error('The command produced too much output.'));
        });
      }
    });
    channel.stderr.on('data', (chunk: Buffer) => err.push(chunk));
    channel.on('exit', (exitCode: number | null) => {
      code = typeof exitCode === 'number' ? exitCode : null;
    });
    channel.on('close', () =>
      finish(() =>
        resolve({
          stdout: Buffer.concat(out).toString('utf8'),
          stderr: Buffer.concat(err).toString('utf8'),
          code,
        }),
      ),
    );
    channel.on('error', (error: Error) => finish(() => reject(error)));
  });
}

/** Splits the combined output into its marked sections. Missing sections come back as ''. */
export function splitSections(text: string): Record<Marker, string> {
  const result = Object.fromEntries(MARKERS.map((m) => [m, ''])) as Record<
    Marker,
    string
  >;
  const regex = /@@(\w+)@@\n/g;
  const positions: { marker: string; start: number; contentStart: number }[] =
    [];
  let match: RegExpExecArray | null;
  while ((match = regex.exec(text)) !== null) {
    positions.push({
      marker: match[1],
      start: match.index,
      contentStart: match.index + match[0].length,
    });
  }
  for (let i = 0; i < positions.length; i++) {
    const { marker, contentStart } = positions[i];
    const end = i + 1 < positions.length ? positions[i + 1].start : text.length;
    if ((MARKERS as readonly string[]).includes(marker))
      result[marker as Marker] = text.slice(contentStart, end);
  }
  return result;
}

const ok = <T>(value: T): MetricBlock<T> => ({ state: 'ok', value });
const missing = (reason: string): MetricBlock<never> => ({
  state: 'unavailable',
  reason,
});

export class MetricsCollector {
  private previousCpu: CpuSnapshot | null = null;
  private previousNet: NetCounters | null = null;
  private previousDisk: DiskCounters | null = null;
  private previousAt: number | null = null;

  constructor(
    private readonly connection: SshConnection,
    private readonly connectionId: string,
  ) {}

  /** Runs one tick and builds a sample. Rates are 0 on the very first tick (no previous counters).
   *  `now` is injectable for tests; production passes the local clock. */
  async collect(
    options: { timeoutMs?: number; now?: number } = {},
  ): Promise<MetricsSample> {
    const timestamp = options.now ?? Date.now();
    const outcome = await runCommand(this.connection, METRICS_COMMAND, {
      timeoutMs: options.timeoutMs,
    });
    const sections = splitSections(outcome.stdout);
    const elapsedSeconds =
      this.previousAt !== null ? (timestamp - this.previousAt) / 1000 : 0;

    const sample: MetricsSample = {
      connectionId: this.connectionId,
      timestamp,
      facts: this.facts(sections),
      cpu: this.cpu(sections),
      memory: this.memory(sections),
      filesystems: this.filesystems(sections),
      diskIo: this.diskIo(sections, elapsedSeconds),
      network: this.network(sections, elapsedSeconds),
      processes: this.processes(sections),
    };
    this.previousAt = timestamp;
    return sample;
  }

  private facts(sections: Record<Marker, string>): HostFacts {
    const os = sections.UNAME.trim() || null;
    return { os, uptimeSeconds: parseUptime(sections.UP) };
  }

  private cpu(sections: Record<Marker, string>): MetricBlock<CpuMetric> {
    const snapshot = parseProcStat(sections.CPU);
    if (!snapshot) return missing('/proc/stat was not readable.');
    const cores =
      parseCount(sections.NPROC) ?? (snapshot.perCore.length || null);
    const loadAverage = parseLoadAverage(sections.LOAD);
    const previous = this.previousCpu;
    this.previousCpu = snapshot;
    if (!previous) {
      // Utilization compares two samples; the first has nothing to compare with, so it is
      // reported as not yet measured. Cores and load averages are real on every sample.
      return ok({
        utilization: null,
        breakdown: null,
        cores,
        loadAverage,
        perCore: null,
      });
    }
    const overall = cpuUtilization(previous.all, snapshot.all);
    let perCore: number[] | null = null;
    if (
      previous.perCore.length > 0 &&
      previous.perCore.length === snapshot.perCore.length
    ) {
      const cores = snapshot.perCore.map(
        (core, i) => cpuUtilization(previous.perCore[i], core).utilization,
      );
      // A per-core breakdown is shown only when every core could be measured.
      perCore = cores.every((value) => value !== null)
        ? (cores as number[])
        : null;
    }
    return ok({ ...overall, cores, loadAverage, perCore });
  }

  private memory(
    sections: Record<Marker, string>,
  ): MetricBlock<MemoryMetricValue> {
    const memory = parseMeminfo(sections.MEM);
    return memory ? ok(memory) : missing('/proc/meminfo was not readable.');
  }

  private filesystems(
    sections: Record<Marker, string>,
  ): MetricBlock<FilesystemMetricValue[]> {
    if (!sections.FS.trim()) return missing('df produced no output.');
    const types = parseMounts(sections.MOUNTS);
    const filesystems = parseDf(sections.FS, types);
    return filesystems.length > 0
      ? ok(filesystems)
      : missing('No filesystems were reported.');
  }

  private diskIo(
    sections: Record<Marker, string>,
    elapsedSeconds: number,
  ): MetricBlock<DiskIoMetric[]> {
    const current = parseDiskstats(sections.DISK);
    const previous = this.previousDisk;
    this.previousDisk = current;
    if (current.size === 0) return missing('/proc/diskstats was not readable.');
    const io: DiskIoMetric[] = [];
    for (const [device, counters] of current) {
      // A device with no earlier sample (the first tick, or one just attached) has no rate yet.
      const prev = previous?.get(device);
      io.push({
        device,
        readBytesPerSecond: prev
          ? rate(prev.readBytes, counters.readBytes, elapsedSeconds)
          : null,
        writeBytesPerSecond: prev
          ? rate(prev.writeBytes, counters.writeBytes, elapsedSeconds)
          : null,
      });
    }
    return ok(io);
  }

  private network(
    sections: Record<Marker, string>,
    elapsedSeconds: number,
  ): MetricBlock<NetworkInterfaceMetric[]> {
    const current = parseNetDev(sections.NET);
    const previous = this.previousNet;
    this.previousNet = current;
    if (current.size === 0) return missing('/proc/net/dev was not readable.');
    const interfaces: NetworkInterfaceMetric[] = [];
    for (const [name, counters] of current) {
      // An interface with no earlier sample (the first tick, or one just brought up) has no rate yet.
      const prev = previous?.get(name);
      interfaces.push({
        name,
        receiveBytesPerSecond: prev
          ? rate(prev.receiveBytes, counters.receiveBytes, elapsedSeconds)
          : null,
        transmitBytesPerSecond: prev
          ? rate(prev.transmitBytes, counters.transmitBytes, elapsedSeconds)
          : null,
        receiveBytes: counters.receiveBytes,
        transmitBytes: counters.transmitBytes,
        receivePackets: counters.receivePackets,
        transmitPackets: counters.transmitPackets,
        receiveErrors: counters.receiveErrors,
        transmitErrors: counters.transmitErrors,
        receiveDrops: counters.receiveDrops,
        transmitDrops: counters.transmitDrops,
      });
    }
    return ok(interfaces);
  }

  private processes(
    sections: Record<Marker, string>,
  ): MetricBlock<ProcessMetricValue[]> {
    if (!sections.PROC.trim()) return missing('ps produced no output.');
    const processes = parsePs(sections.PROC);
    return processes.length > 0
      ? ok(processes)
      : missing('No processes were reported.');
  }
}
