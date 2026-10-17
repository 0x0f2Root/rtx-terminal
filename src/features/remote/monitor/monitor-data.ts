import type { MetricsSample, NetworkInterfaceMetric } from '@/shared/remote';

/**
 * Pure derivations for the resource monitor, kept apart from the view so they are unit-tested.
 * Nothing here invents a value: a figure that was not measured stays null all the way to the UI.
 */

/** A chart point is one sample's value(s) at a timestamp; null means not measured. */
export type ChartPoint = { t: number } & Record<string, number | null>;

/**
 * Breaks lines where samples are missing: wherever two points are further apart than `maxGapMs`
 * (a disconnect, a pause, a hidden tab), a point with every series null is inserted between them.
 */
export function withGaps(points: ChartPoint[], maxGapMs: number): ChartPoint[] {
  if (points.length < 2) return points;
  const keys = Object.keys(points[0]).filter((key) => key !== 't');
  const out: ChartPoint[] = [points[0]];
  for (let i = 1; i < points.length; i++) {
    const previous = points[i - 1];
    if (points[i].t - previous.t > maxGapMs) {
      const gap: ChartPoint = { t: previous.t + 1 };
      for (const key of keys) gap[key] = null;
      out.push(gap);
    }
    out.push(points[i]);
  }
  return out;
}

/** Loopback traffic never leaves the host, so it is not counted as network activity. */
export function isLoopback(name: string): boolean {
  return name === 'lo' || name.startsWith('lo:');
}

/** The interface to show first: the first non-loopback one, else whatever exists. */
export function defaultInterface(
  interfaces: NetworkInterfaceMetric[],
): string | null {
  return (
    (interfaces.find((i) => !isLoopback(i.name)) ?? interfaces[0])?.name ?? null
  );
}

/**
 * Receive plus transmit throughput over every non-loopback interface, or null while no interface
 * has a measured rate yet (the first sample).
 */
export function externalThroughput(
  interfaces: NetworkInterfaceMetric[],
): number | null {
  let total: number | null = null;
  for (const i of interfaces) {
    if (isLoopback(i.name)) continue;
    for (const rate of [i.receiveBytesPerSecond, i.transmitBytesPerSecond])
      if (rate !== null) total = (total ?? 0) + rate;
  }
  return total;
}

/** A sample older than this, while sampling, means the host stopped answering in time. */
export function staleAfterMs(intervalMs: number): number {
  return Math.max(intervalMs * 3, 10_000);
}

export function isStale(
  lastSampleAt: number | null,
  now: number,
  intervalMs: number,
): boolean {
  return lastSampleAt !== null && now - lastSampleAt > staleAfterMs(intervalMs);
}

/** The samples inside the history window, measured back from the newest one. */
export function windowSamples(
  history: MetricsSample[],
  windowMs: number,
): MetricsSample[] {
  if (history.length === 0) return history;
  const cutoff = history[history.length - 1].timestamp - windowMs;
  const start = history.findIndex((s) => s.timestamp >= cutoff);
  return start <= 0 ? history : history.slice(start);
}

const round1 = (value: number) => Math.round(value * 10) / 10;

export function cpuPoints(samples: MetricsSample[]): ChartPoint[] {
  return samples.map((s) => ({
    t: s.timestamp,
    cpu:
      s.cpu.state === 'ok' && s.cpu.value.utilization !== null
        ? round1(s.cpu.value.utilization)
        : null,
  }));
}

export function memoryPoints(samples: MetricsSample[]): ChartPoint[] {
  return samples.map((s) => ({
    t: s.timestamp,
    mem: s.memory.state === 'ok' ? round1(s.memory.value.utilization) : null,
  }));
}

export function networkPoints(
  samples: MetricsSample[],
  iface: string | null,
): ChartPoint[] {
  return samples.map((s) => {
    const found =
      s.network.state === 'ok'
        ? s.network.value.find((n) => n.name === iface)
        : undefined;
    return {
      t: s.timestamp,
      rx: found?.receiveBytesPerSecond ?? null,
      tx: found?.transmitBytesPerSecond ?? null,
    };
  });
}

export function externalNetworkPoints(samples: MetricsSample[]): ChartPoint[] {
  return samples.map((s) => ({
    t: s.timestamp,
    net: s.network.state === 'ok' ? externalThroughput(s.network.value) : null,
  }));
}

export function diskIoPoints(
  samples: MetricsSample[],
  device: string | null,
): ChartPoint[] {
  return samples.map((s) => {
    const found =
      s.diskIo.state === 'ok'
        ? s.diskIo.value.find((d) => d.device === device)
        : undefined;
    return {
      t: s.timestamp,
      read: found?.readBytesPerSecond ?? null,
      write: found?.writeBytesPerSecond ?? null,
    };
  });
}
