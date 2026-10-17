import { afterEach, describe, expect, it } from 'vitest';
import { SshConnection } from '../src/main/ssh/ssh-connection';
import {
  MetricsCollector,
  METRICS_COMMAND,
  splitSections,
} from '../src/main/ssh/metrics/collector';
import {
  cpuUtilization,
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
} from '../src/main/ssh/metrics/parse';
import {
  startServer,
  type ExecHandler,
  type TestServer,
} from './helpers/ssh-server';

// --- pure parsers -----------------------------------------------------------------------------

describe('CPU parsing', () => {
  it('computes utilization from two /proc/stat samples, not one', () => {
    const a = parseProcStat(
      'cpu  100 0 100 800 0 0 0 0 0 0\ncpu0 100 0 100 800 0 0 0 0',
    )!;
    const b = parseProcStat(
      'cpu  150 0 150 900 0 0 0 0 0 0\ncpu0 150 0 150 900 0 0 0 0',
    )!;
    // Between samples: busy delta = (50+50)=100, total delta = 200, so 50%.
    const util = cpuUtilization(a.all, b.all);
    expect(util.utilization).toBeCloseTo(50, 5);
    expect(util.breakdown?.idle).toBeCloseTo(50, 5);
  });

  it('separates per-core lines from the aggregate', () => {
    const snap = parseProcStat('cpu 1 1 1 1\ncpu0 1 1 1 1\ncpu1 1 1 1 1')!;
    expect(snap.perCore).toHaveLength(2);
  });

  it('reports no utilization, not 0%, when the counters do not advance', () => {
    const times = parseProcStat('cpu 1 1 1 1')!.all;
    expect(cpuUtilization(times, times)).toEqual({
      utilization: null,
      breakdown: null,
    });
  });
});

describe('memory parsing', () => {
  it('uses available memory for utilization and keeps cache separate', () => {
    const mem = parseMeminfo(
      [
        'MemTotal:       1000 kB',
        'MemFree:         100 kB',
        'MemAvailable:    400 kB',
        'Buffers:          50 kB',
        'Cached:          250 kB',
        'SwapTotal:       200 kB',
        'SwapFree:         50 kB',
      ].join('\n'),
    )!;
    expect(mem.total).toBe(1000 * 1024);
    expect(mem.available).toBe(400 * 1024);
    expect(mem.used).toBe(600 * 1024); // total - available
    expect(mem.utilization).toBeCloseTo(60, 5);
    expect(mem.cached).toBe(250 * 1024);
    expect(mem.swapUsed).toBe(150 * 1024);
  });

  it('handles a missing swap gracefully and does not invent values', () => {
    const mem = parseMeminfo('MemTotal: 1000 kB\nMemFree: 500 kB')!;
    expect(mem.swapTotal).toBeNull();
    expect(mem.swapUsed).toBeNull();
    // Without MemAvailable it falls back to free + buffers + cache (here just free).
    expect(mem.available).toBe(500 * 1024);
  });
});

describe('network parsing', () => {
  const sample = [
    'Inter-|   Receive                                                |  Transmit',
    ' face |bytes    packets errs drop fifo frame compressed multicast|bytes    packets errs drop',
    '  eth0: 1000      10    0    0    0     0          0         0     2000      20    0    0',
    '    lo:  500       5    0    0    0     0          0         0      500       5    0    0',
  ].join('\n');

  it('reads cumulative counters per interface', () => {
    const net = parseNetDev(sample);
    expect(net.get('eth0')!.receiveBytes).toBe(1000);
    expect(net.get('eth0')!.transmitBytes).toBe(2000);
    expect(net.get('lo')!.receivePackets).toBe(5);
  });

  it('derives throughput from a counter delta over elapsed time', () => {
    expect(rate(1000, 3000, 2)).toBe(1000); // (3000-1000)/2
  });

  it('reports an unknown rate, not 0 or a negative one, on a counter reset', () => {
    expect(rate(5000, 10, 2)).toBeNull();
    expect(rate(10, 20, 0)).toBeNull();
  });
});

describe('disk parsing', () => {
  it('reads whole-disk sectors and converts to bytes, skipping partitions', () => {
    const disk = parseDiskstats(
      [
        '   8       0 sda 100 0 200 0 50 0 400 0 0 0 0',
        '   8       1 sda1 10 0 20 0 5 0 40 0 0 0 0',
      ].join('\n'),
    );
    expect(disk.has('sda')).toBe(true);
    expect(disk.has('sda1')).toBe(false);
    expect(disk.get('sda')!.readBytes).toBe(200 * 512);
    expect(disk.get('sda')!.writeBytes).toBe(400 * 512);
  });

  it('joins df capacity with filesystem type and flags pseudo filesystems', () => {
    const mounts = parseMounts(
      'rootfs / ext4 rw 0 0\ntmpfs /run tmpfs rw 0 0\n/dev/sda1 /mnt/with\\040space ext4 rw 0 0',
    );
    const fs = parseDf(
      [
        'Filesystem     1024-blocks    Used Available Capacity Mounted on',
        '/dev/root          1000000  400000    600000      40% /',
        'tmpfs                10000       0     10000       0% /run',
        '/dev/sda1           500000  100000    400000      20% /mnt/with space',
      ].join('\n'),
      mounts,
    );
    const root = fs.find((f) => f.mountpoint === '/')!;
    expect(root.type).toBe('ext4');
    expect(root.total).toBe(1000000 * 1024);
    expect(root.utilization).toBeCloseTo(40, 5);
    expect(root.pseudo).toBe(false);
    expect(fs.find((f) => f.mountpoint === '/run')!.pseudo).toBe(true);
    // Mount points with spaces survive the octal-unescaped /proc/mounts join.
    expect(fs.find((f) => f.mountpoint === '/mnt/with space')!.type).toBe(
      'ext4',
    );
  });
});

describe('process parsing', () => {
  it('parses fixed-order ps columns independent of locale', () => {
    const procs = parsePs(
      '  1     0 root     Ss     1200  0.5  1.2  2048 systemd\n 42     1 tester   R      10    9.9  3.4  8192 node server.js',
    );
    expect(procs).toHaveLength(2);
    expect(procs[1]).toMatchObject({
      pid: 42,
      ppid: 1,
      user: 'tester',
      state: 'R',
      cpu: 9.9,
      rss: 8192 * 1024,
      name: 'node server.js',
      elapsedSeconds: 10,
    });
  });
});

describe('misc parsers', () => {
  it('reads load average and uptime', () => {
    expect(parseLoadAverage('0.52 0.58 0.59 1/234 5678')).toEqual([
      0.52, 0.58, 0.59,
    ]);
    expect(parseUptime('12345.67 54321.00')).toBeCloseTo(12345.67, 2);
  });
});

// --- section splitting + collector over a real exec channel -----------------------------------

describe('splitSections', () => {
  it('splits the marked combined output', () => {
    const sections = splitSections(
      '@@CPU@@\ncpu 1 2 3 4\n@@MEM@@\nMemTotal: 1 kB\n@@END@@\n',
    );
    expect(sections.CPU.trim()).toBe('cpu 1 2 3 4');
    expect(sections.MEM.trim()).toBe('MemTotal: 1 kB');
  });
});

function fixture(cpuBusy: number, rxBytes: number): string {
  return [
    `@@CPU@@`,
    `cpu  ${cpuBusy} 0 0 1000 0 0 0 0 0 0`,
    `cpu0 ${cpuBusy} 0 0 1000 0 0 0 0`,
    `@@MEM@@`,
    `MemTotal: 2000 kB`,
    `MemFree: 500 kB`,
    `MemAvailable: 800 kB`,
    `@@NET@@`,
    `Inter-|   Receive  |  Transmit`,
    ` face |bytes ...`,
    `  eth0: ${rxBytes} 1 0 0 0 0 0 0 100 1 0 0`,
    `@@DISK@@`,
    `   8 0 sda 1 0 10 0 1 0 20 0 0 0 0`,
    `@@MOUNTS@@`,
    `/dev/sda1 / ext4 rw 0 0`,
    `@@FS@@`,
    `Filesystem 1024-blocks Used Available Capacity Mounted on`,
    `/dev/sda1 1000 400 600 40% /`,
    `@@LOAD@@`,
    `0.10 0.20 0.30 1/100 200`,
    `@@UP@@`,
    `3600.00 7000.00`,
    `@@NPROC@@`,
    `1`,
    `@@UNAME@@`,
    `Linux 6.1.0`,
    `@@PROC@@`,
    `1 0 root S 100 0.0 1.0 1024 init`,
    `@@END@@`,
    ``,
  ].join('\n');
}

describe('MetricsCollector over a real exec channel', () => {
  let server: TestServer;
  let connection: SshConnection;

  afterEach(async () => {
    connection?.release('monitor');
    await server?.close();
  });

  async function setup(exec: ExecHandler): Promise<MetricsCollector> {
    server = await startServer({
      users: [{ username: 'tester', password: 'secret' }],
      exec,
    });
    connection = await SshConnection.connect({
      host: '127.0.0.1',
      port: server.port,
      username: 'tester',
      auth: { kind: 'password', password: 'secret' },
      readyTimeoutMs: 5000,
      keepAliveMs: 0,
      verifyHostKey: async () => ({ ok: true }),
    });
    connection.acquire('monitor');
    return new MetricsCollector(connection, 'conn-1');
  }

  it('collects real sections and computes rates from two samples', async () => {
    let call = 0;
    const collector = await setup((command) => {
      expect(command).toBe(METRICS_COMMAND);
      call += 1;
      // Busy jiffies and rx bytes advance between the two ticks.
      return call === 1
        ? { stdout: fixture(0, 1000) }
        : { stdout: fixture(500, 5000) };
    });

    const first = await collector.collect({ now: 1000 });
    expect(first.cpu.state).toBe('ok');
    // The first tick has nothing to compare with: rates are unmeasured (null), never a fake 0.
    if (first.cpu.state === 'ok') {
      expect(first.cpu.value.utilization).toBeNull();
      expect(first.cpu.value.breakdown).toBeNull();
      // Core count and load averages are real on the very first sample.
      expect(first.cpu.value.cores).toBe(1);
      expect(first.cpu.value.loadAverage).toEqual([0.1, 0.2, 0.3]);
    }
    if (first.network.state === 'ok') {
      const eth0 = first.network.value.find((n) => n.name === 'eth0')!;
      expect(eth0.receiveBytesPerSecond).toBeNull();
      expect(eth0.receiveBytes).toBe(1000);
    }
    if (first.diskIo.state === 'ok')
      expect(first.diskIo.value[0].readBytesPerSecond).toBeNull();
    expect(first.memory.state).toBe('ok');
    if (first.memory.state === 'ok')
      expect(first.memory.value.used).toBe((2000 - 800) * 1024);

    const second = await collector.collect({ now: 3000 });
    // cpu line advanced busy by 500 and idle by 0 over a total delta of 500 -> 100% busy.
    if (second.cpu.state === 'ok')
      expect(second.cpu.value.utilization).toBeCloseTo(100, 5);
    // rx advanced 1000 -> 5000 over 2 s -> 2000 B/s.
    if (second.network.state === 'ok') {
      const eth0 = second.network.value.find((n) => n.name === 'eth0')!;
      expect(eth0.receiveBytesPerSecond).toBe(2000);
    }
    if (second.filesystems.state === 'ok')
      expect(second.filesystems.value[0].utilization).toBeCloseTo(40, 5);
    if (second.processes.state === 'ok')
      expect(second.processes.value[0].name).toBe('init');
  });

  it('marks a metric unavailable when its source is empty, without failing the rest', async () => {
    const collector = await setup(() => ({
      stdout: '@@CPU@@\n@@MEM@@\nMemTotal: 1000 kB\nMemFree: 500 kB\n@@END@@\n',
    }));
    const sample = await collector.collect({ now: 1000 });
    expect(sample.cpu.state).toBe('unavailable');
    expect(sample.memory.state).toBe('ok');
  });
});
