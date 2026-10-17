import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { TransferProgress, TransferStatus } from '../src/shared/remote';
import { SshConnection } from '../src/main/ssh/ssh-connection';
import { SftpService } from '../src/main/ssh/sftp-service';
import { TransferManager } from '../src/main/ssh/transfer-manager';
import { MemoryFs } from './helpers/sftp-fs';
import { startServer, type TestServer } from './helpers/ssh-server';

let server: TestServer;
let fs: MemoryFs;
let connection: SshConnection;
let service: SftpService;
let localDir: string;
let progress: Map<string, TransferProgress>;
let manager: TransferManager;

beforeEach(async () => {
  fs = new MemoryFs('/home/tester');
  server = await startServer({
    users: [{ username: 'tester', password: 'secret' }],
    fs,
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
  connection.acquire('files');
  service = new SftpService(connection);
  progress = new Map();
  manager = new TransferManager('conn-1', service, (p) =>
    progress.set(p.id, p),
  );
  localDir = await mkdtemp(path.join(os.tmpdir(), 'rtx-tm-'));
});

afterEach(async () => {
  manager.dispose();
  service.close();
  connection.release('files');
  await server.close();
  await rm(localDir, { recursive: true, force: true });
});

async function waitForStatus(
  id: string,
  ...statuses: TransferStatus[]
): Promise<TransferProgress> {
  const start = Date.now();
  while (Date.now() - start < 5000) {
    const current = progress.get(id);
    if (current && statuses.includes(current.status)) return current;
    await new Promise((resolve) => setTimeout(resolve, 15));
  }
  throw new Error(`transfer ${id} never reached ${statuses.join('/')}`);
}

describe('TransferManager uploads', () => {
  it('uploads a new file and reports completion', async () => {
    const src = path.join(localDir, 'hello.txt');
    await writeFile(src, 'hello');
    const id = manager.enqueue({
      direction: 'upload',
      localPath: src,
      remotePath: '/home/tester/hello.txt',
      size: 5,
      conflict: 'rename',
    });
    const done = await waitForStatus(id, 'completed');
    expect(done.status).toBe('completed');
    expect(fs.readFileContents('/home/tester/hello.txt').toString()).toBe(
      'hello',
    );
  });

  it('resolves conflicts: overwrite, skip and keep-both', async () => {
    fs.writeFile('/home/tester/clash.txt', 'original');
    const src = path.join(localDir, 'clash.txt');
    await writeFile(src, 'replacement');

    const overwrite = manager.enqueue({
      direction: 'upload',
      localPath: src,
      remotePath: '/home/tester/clash.txt',
      size: 11,
      conflict: 'overwrite',
    });
    await waitForStatus(overwrite, 'completed');
    expect(fs.readFileContents('/home/tester/clash.txt').toString()).toBe(
      'replacement',
    );

    fs.writeFile('/home/tester/clash.txt', 'original');
    const skip = manager.enqueue({
      direction: 'upload',
      localPath: src,
      remotePath: '/home/tester/clash.txt',
      size: 11,
      conflict: 'skip',
    });
    await waitForStatus(skip, 'skipped');
    expect(fs.readFileContents('/home/tester/clash.txt').toString()).toBe(
      'original',
    );

    const keep = manager.enqueue({
      direction: 'upload',
      localPath: src,
      remotePath: '/home/tester/clash.txt',
      size: 11,
      conflict: 'rename',
    });
    await waitForStatus(keep, 'completed');
    // The original is untouched and a "clash (1).txt" now exists.
    expect(fs.readFileContents('/home/tester/clash.txt').toString()).toBe(
      'original',
    );
    expect(fs.readFileContents('/home/tester/clash (1).txt').toString()).toBe(
      'replacement',
    );
  });

  it('expands a local directory into per-file uploads over SFTP', async () => {
    await mkdir(path.join(localDir, 'tree/sub'), { recursive: true });
    await writeFile(path.join(localDir, 'tree/a.txt'), 'a');
    await writeFile(path.join(localDir, 'tree/sub/b.txt'), 'bb');
    const specs = await manager.expand({
      direction: 'upload',
      localPath: path.join(localDir, 'tree'),
      remotePath: '/home/tester/tree',
      size: null,
      conflict: 'rename',
    });
    expect(specs).toHaveLength(2);
    const ids = specs.map((spec) => manager.enqueue(spec));
    for (const id of ids) await waitForStatus(id, 'completed');
    expect(fs.readFileContents('/home/tester/tree/a.txt').toString()).toBe('a');
    expect(fs.readFileContents('/home/tester/tree/sub/b.txt').toString()).toBe(
      'bb',
    );
  });
});

describe('TransferManager downloads', () => {
  it('downloads a remote file to a local path', async () => {
    fs.writeFile('/home/tester/payload.bin', Buffer.alloc(2048, 5));
    const dest = path.join(localDir, 'payload.bin');
    const id = manager.enqueue({
      direction: 'download',
      localPath: dest,
      remotePath: '/home/tester/payload.bin',
      size: 2048,
      conflict: 'rename',
    });
    await waitForStatus(id, 'completed');
    expect((await readFile(dest)).length).toBe(2048);
  });

  it('retries a failed transfer', async () => {
    // A download whose source does not exist fails, then succeeds after the file appears.
    const dest = path.join(localDir, 'late.txt');
    const id = manager.enqueue({
      direction: 'download',
      localPath: dest,
      remotePath: '/home/tester/late.txt',
      size: null,
      conflict: 'overwrite',
    });
    await waitForStatus(id, 'failed');
    fs.writeFile('/home/tester/late.txt', 'now here');
    manager.retry(id);
    await waitForStatus(id, 'completed');
    expect((await readFile(dest)).toString()).toBe('now here');
  });

  it('cancels a queued transfer', async () => {
    fs.writeFile('/home/tester/big.bin', Buffer.alloc(4_000_000, 1));
    // Fill the three concurrency slots, then a fourth that stays queued.
    const running = [0, 1, 2].map((n) =>
      manager.enqueue({
        direction: 'download',
        localPath: path.join(localDir, `r${n}.bin`),
        remotePath: '/home/tester/big.bin',
        size: 4_000_000,
        conflict: 'overwrite',
      }),
    );
    const queued = manager.enqueue({
      direction: 'download',
      localPath: path.join(localDir, 'queued.bin'),
      remotePath: '/home/tester/big.bin',
      size: 4_000_000,
      conflict: 'overwrite',
    });
    manager.cancel(queued);
    const cancelled = await waitForStatus(queued, 'cancelled');
    expect(cancelled.status).toBe('cancelled');
    for (const id of running) await waitForStatus(id, 'completed', 'cancelled');
  });
});
