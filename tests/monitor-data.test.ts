import { describe, expect, it } from 'vitest';
import type {
  MetricsSample,
  NetworkInterfaceMetric,
} from '../src/shared/remote';
import {
  cpuPoints,
  defaultInterface,
  externalThroughput,
  isLoopback,
  isStale,
  staleAfterMs,
  windowSamples,
  withGaps,
} from '../src/features/remote/monitor/monitor-data';

function iface(
  name: string,
  rx: number | null,
  tx: number | null,
): NetworkInterfaceMetric {
  return {
    name,
    receiveBytesPerSecond: rx,
    transmitBytesPerSecond: tx,
    receiveBytes: 0,
    transmitBytes: 0,
    receivePackets: 0,
    transmitPackets: 0,
    receiveErrors: 0,
    transmitErrors: 0,
    receiveDrops: 0,
    transmitDrops: 0,
  };
}

function sample(timestamp: number, utilization: number | null): MetricsSample {
  const unavailable = { state: 'unavailable' as const, reason: 'n/a' };
  return {
    connectionId: 'c',
    timestamp,
    facts: { os: null, uptimeSeconds: null },
    cpu: {
      state: 'ok',
      value: {
        utilization,
        breakdown: null,
        cores: 1,
        loadAverage: null,
        perCore: null,
      },
    },
    memory: unavailable,
    filesystems: unavailable,
    diskIo: unavailable,
    network: unavailable,
    processes: unavailable,
  };
}

describe('network totals', () => {
  it('leaves loopback out of external throughput', () => {
    expect(isLoopback('lo')).toBe(true);
    expect(isLoopback('eth0')).toBe(false);
    expect(
      externalThroughput([
        iface('lo', 1_000_000, 1_000_000),
        iface('eth0', 300, 200),
      ]),
    ).toBe(500);
  });

  it('is unknown, not zero, until some interface has a measured rate', () => {
    expect(externalThroughput([iface('eth0', null, null)])).toBeNull();
    expect(externalThroughput([iface('eth0', null, 50)])).toBe(50);
  });

  it('defaults to the busiest non-loopback interface', () => {
    expect(defaultInterface([iface('lo', 0, 0), iface('ens3', 0, 0)])).toBe(
      'ens3',
    );
    expect(defaultInterface([iface('lo', 0, 0)])).toBe('lo');
    const busy = { ...iface('eth0', 0, 0), receiveBytes: 5_000 };
    expect(
      defaultInterface([iface('lo', 0, 0), iface('ifb0', 0, 0), busy]),
    ).toBe('eth0');
    expect(defaultInterface([])).toBeNull();
  });
});

describe('staleness', () => {
  it('flags a sample older than three intervals, with a 10 s floor', () => {
    expect(staleAfterMs(2000)).toBe(10_000);
    expect(staleAfterMs(10_000)).toBe(30_000);
    expect(isStale(1_000, 11_500, 2000)).toBe(true);
    expect(isStale(1_000, 9_000, 2000)).toBe(false);
    expect(isStale(null, 99_999, 2000)).toBe(false);
  });
});

describe('history windows and gaps', () => {
  it('keeps only samples inside the window, measured from the newest', () => {
    const history = [0, 10_000, 50_000, 60_000].map((t) => sample(t, 1));
    expect(windowSamples(history, 15_000).map((s) => s.timestamp)).toEqual([
      50_000, 60_000,
    ]);
    expect(windowSamples(history, 1e9)).toHaveLength(4);
  });

  it('breaks the line across missing time instead of drawing through it', () => {
    const points = cpuPoints([
      sample(0, 10),
      sample(2000, 20),
      sample(60_000, 30),
    ]);
    const gapped = withGaps(points, 10_000);
    expect(gapped).toHaveLength(4);
    expect(gapped[2]).toEqual({ t: 2001, cpu: null });
    // Close samples are left untouched.
    expect(withGaps(points.slice(0, 2), 10_000)).toHaveLength(2);
  });

  it('plots an unmeasured CPU sample as a gap, never as 0%', () => {
    expect(cpuPoints([sample(0, null)])[0].cpu).toBeNull();
  });
});
