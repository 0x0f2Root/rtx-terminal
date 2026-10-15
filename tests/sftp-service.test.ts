import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SshConnection } from '../src/main/ssh/ssh-connection';
import { RemoteFileError, SftpService } from '../src/main/ssh/sftp-service';
import { MemoryFs } from './helpers/sftp-fs';
import { startServer, type TestServer } from './helpers/ssh-server';

async function connect(server: TestServer): Promise<SshConnection> {
  return SshConnection.connect({
    host: '127.0.0.1',
    port: server.port,
    username: 'tester',
    auth: { kind: 'password', password: 'secret' },
    readyTimeoutMs: 5000,
    keepAliveMs: 0,
    verifyHostKey: async () => ({ ok: true }),
  });
}

let server: TestServer;
let fs: MemoryFs;
let connection: SshConnection;
let service: SftpService;
let localDir: string;

beforeEach(async () => {
  fs = new MemoryFs('/home/tester');
  fs.writeFile('/home/tester/notes.txt', 'hello world', 0o644);
  fs.writeFile('/home/tester/data.bin', Buffer.alloc(5000, 7), 0o600);
  fs.mkdirp('/home/tester/projects');
  fs.writeFile('/home/tester/projects/readme.md', '# project', 0o644);
  fs.writeFile('/home/tester/with space.txt', 'spaced', 0o644);
  fs.writeFile('/home/tester/café ☕.txt', 'unicode', 0o644);
  fs.symlink('/home/tester/link-to-notes', '/home/tester/notes.txt');
  fs.symlink('/home/tester/broken', '/home/tester/missing');
  server = await startServer({
    users: [{ username: 'tester', password: 'secret' }],
    fs,
  });
  connection = await connect(server);
  connection.acquire('files');
  service = new SftpService(connection);
  localDir = await mkdtemp(path.join(os.tmpdir(), 'rtx-sftp-'));
});

afterEach(async () => {
  service.close();
  connection.release('files');
  await server.close();
  await rm(localDir, { recursive: true, force: true });
});

describe('SftpService navigation', () => {
  it('resolves the home directory through SFTP, not an assumption', async () => {
    expect(await service.home()).toBe('/home/tester');
  });

  it('lists a directory with real metadata and excludes . and ..', async () => {
    const listing = await service.list('/home/tester');
    expect(listing.path).toBe('/home/tester');
    const names = listing.entries.map((e) => e.name).sort();
    expect(names).not.toContain('.');
    expect(names).not.toContain('..');
    expect(names).toContain('notes.txt');
    expect(names).toContain('projects');

    const notes = listing.entries.find((e) => e.name === 'notes.txt')!;
    expect(notes.type).toBe('file');
    expect(notes.size).toBe('hello world'.length);
    expect(notes.permissions).toBe('rw-r--r--');

    const projects = listing.entries.find((e) => e.name === 'projects')!;
    expect(projects.type).toBe('directory');
  });

  it('handles names with spaces and unicode', async () => {
    const listing = await service.list('/home/tester');
    expect(listing.entries.map((e) => e.name)).toEqual(
      expect.arrayContaining(['with space.txt', 'café ☕.txt']),
    );
  });

  it('reports symlinks with target and resolved type, tolerating broken links', async () => {
    const listing = await service.list('/home/tester');
    const link = listing.entries.find((e) => e.name === 'link-to-notes')!;
    expect(link.type).toBe('symlink');
    expect(link.linkTarget).toBe('/home/tester/notes.txt');
    expect(link.resolvedType).toBe('file');

    const broken = listing.entries.find((e) => e.name === 'broken')!;
    expect(broken.type).toBe('symlink');
    expect(broken.resolvedType).toBeNull();
  });

  it('maps a missing directory to a not-found error', async () => {
    await expect(service.list('/home/tester/nope')).rejects.toMatchObject({
      code: 'not-found',
    });
  });
});

describe('SftpService operations', () => {
  it('creates, renames and deletes', async () => {
    await service.mkdir('/home/tester/new-folder');
    expect((await service.stat('/home/tester/new-folder')).type).toBe(
      'directory',
    );
    await service.rename('/home/tester/new-folder', '/home/tester/renamed');
    expect(await service.exists('/home/tester/renamed')).toBe(true);
    expect(await service.exists('/home/tester/new-folder')).toBe(false);
    await service.removeEmptyDir('/home/tester/renamed');
    expect(await service.exists('/home/tester/renamed')).toBe(false);

    await service.removeFile('/home/tester/notes.txt');
    expect(await service.exists('/home/tester/notes.txt')).toBe(false);
  });

  it('deletes a tree with explicit traversal', async () => {
    fs.mkdirp('/home/tester/tree/sub');
    fs.writeFile('/home/tester/tree/a.txt', 'a');
    fs.writeFile('/home/tester/tree/sub/b.txt', 'b');
    await service.removeTree('/home/tester/tree');
    expect(await service.exists('/home/tester/tree')).toBe(false);
  });
});

describe('SftpService transfers', () => {
  it('downloads a remote file with progress', async () => {
    const dest = path.join(localDir, 'notes.txt');
    const seen: number[] = [];
    const handle = service.downloadFile('/home/tester/data.bin', dest, 5000, {
      onProgress: (transferred) => seen.push(transferred),
    });
    await handle.done;
    const bytes = await readFile(dest);
    expect(bytes.length).toBe(5000);
    expect(seen.at(-1)).toBe(5000);
  });

  it('refuses to overwrite a remote file unless told to', async () => {
    const src = path.join(localDir, 'up.txt');
    await writeFile(src, 'new content');
    await expect(
      service.uploadFile(src, '/home/tester/notes.txt', 11, {}).done,
    ).rejects.toBeInstanceOf(RemoteFileError);
    // With overwrite it succeeds and replaces the content.
    await service.uploadFile(src, '/home/tester/notes.txt', 11, {
      overwrite: true,
    }).done;
    expect(fs.readFileContents('/home/tester/notes.txt').toString()).toBe(
      'new content',
    );
  });

  it('uploads a new file and streams its bytes', async () => {
    const src = path.join(localDir, 'payload.bin');
    await writeFile(src, Buffer.alloc(4096, 9));
    await service.uploadFile(src, '/home/tester/payload.bin', 4096, {}).done;
    expect(fs.readFileContents('/home/tester/payload.bin').length).toBe(4096);
  });

  it('cancels a transfer and cleans up the partial local file', async () => {
    fs.writeFile('/home/tester/big.bin', Buffer.alloc(2_000_000, 3));
    const dest = path.join(localDir, 'big.bin');
    const handle = service.downloadFile(
      '/home/tester/big.bin',
      dest,
      2_000_000,
      {},
    );
    handle.cancel();
    await expect(handle.done).rejects.toMatchObject({ code: 'cancelled' });
    await expect(readFile(dest)).rejects.toBeTruthy();
  });
});
