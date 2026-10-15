import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { MetricsSample, MonitorStatus } from '../src/shared/remote';
import { SshConnection } from '../src/main/ssh/ssh-connection';
import { MetricsPoller } from '../src/main/ssh/metrics/poller';
import { startServer, type TestServer } from './helpers/ssh-server';

/** A minimal but valid combined-metrics fixture so each tick yields a real sample. */
function fixture(): string {
  return [
    '@@CPU@@',
    'cpu 100 0 100 800 0 0 0 0 0 0',
    '@@MEM@@',
    'MemTotal: 1000 kB',
    'MemFree: 400 kB',
    'MemAvailable: 500 kB',
    '@@NET@@',
    '@@DISK@@',
    '@@MOUNTS@@',
    '@@FS@@',
    '@@LOAD@@',
    '0.1 0.2 0.3 1/1 1',
    '@@UP@@',
    '100.0 200.0',
    '@@NPROC@@',
    '1',
    '@@UNAME@@',
    'Linux 6.1.0',
    '@@PROC@@',
    '1 0 root S 10 0.0 1.0 1024 init',
    '@@END@@',
    '',
  ].join('\n');
}

let server: TestServer;
let connection: SshConnection;
let samples: MetricsSample[];
let statuses: MonitorStatus[];
let poller: MetricsPoller;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

beforeEach(async () => {
  server = await startServer({
    users: [{ username: 'tester', password: 'secret' }],
    exec: () => ({ stdout: fixture() }),
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
  samples = [];
  statuses = [];
  poller = new MetricsPoller(
    connection,
    'conn-1',
    {
      onSample: (sample) => samples.push(sample),
      onStatus: (status) => statuses.push(status),
    },
    1000,
  );
});

afterEach(async () => {
  poller.stop();
  connection.release('monitor');
  await server.close();
});

async function waitForSamples(count: number): Promise<void> {
  const start = Date.now();
  while (samples.length < count) {
    if (Date.now() - start > 8000)
      throw new Error('timed out waiting for samples');
    await sleep(20);
  }
}

describe('MetricsPoller', () => {
  it('produces samples while running and stops cleanly', async () => {
    poller.start();
    await waitForSamples(1);
    expect(samples[0].connectionId).toBe('conn-1');
    expect(statuses).toContain('sampling');
    poller.stop();
    const after = samples.length;
    await sleep(1300);
    // No further samples arrive once stopped.
    expect(samples.length).toBe(after);
  });

  it('pauses and resumes without losing the collector', async () => {
    poller.start();
    await waitForSamples(1);
    poller.pause();
    expect(statuses).toContain('idle');
    const paused = samples.length;
    await sleep(1300);
    expect(samples.length).toBe(paused);
    poller.resume();
    await waitForSamples(paused + 1);
    expect(samples.length).toBeGreaterThan(paused);
  });

  it('never overlaps ticks for one collector', async () => {
    poller.start();
    await waitForSamples(2);
    // Each tick runs one command; with no overlap the server sees one exec per sample (plus the
    // in-flight one), never a burst.
    expect(server.execs.length).toBeLessThanOrEqual(samples.length + 1);
  });
});
