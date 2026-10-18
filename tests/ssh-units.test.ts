import { createHmac, randomBytes } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createRequest, sshRequest } from '../src/main/ipc-validation';
import {
  fingerprint,
  KnownHosts,
  keyTypeOf,
  knownHostsName,
} from '../src/main/ssh/known-hosts';
import { SecretStore, type Encryptor } from '../src/main/ssh/secrets';
import {
  listSshConfigAliases,
  lookupSshConfig,
} from '../src/main/ssh/ssh-config';
import {
  parseProfilesFile,
  validateSshHost,
  type SshHostDraft,
} from '../src/shared/config';
import { generateHostKey, publicBlob } from './helpers/ssh-server';

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), 'rtx-ssh-unit-'));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('known_hosts', () => {
  const keyA = publicBlob(generateHostKey());
  const keyB = publicBlob(generateHostKey());

  it('names hosts the way OpenSSH does and reads the key type from the blob', () => {
    expect(knownHostsName('Example.COM', 22)).toBe('example.com');
    expect(knownHostsName('10.0.0.5', 2222)).toBe('[10.0.0.5]:2222');
    expect(keyTypeOf(keyA)).toBe('ssh-ed25519');
    expect(fingerprint(keyA)).toMatch(/^SHA256:[A-Za-z0-9+/]{43}$/);
  });

  it('matches hashed entries from the user file without ever writing to it', async () => {
    const salt = randomBytes(20);
    const hash = createHmac('sha1', salt)
      .update('server.example')
      .digest('base64');
    const userFile = path.join(dir, 'user_known_hosts');
    const original = `|1|${salt.toString('base64')}|${hash} ssh-ed25519 ${keyA.toString('base64')}\n`;
    await writeFile(userFile, original);
    const store = new KnownHosts(path.join(dir, 'app_known_hosts'), userFile);

    expect((await store.check('server.example', 22, keyA)).status).toBe(
      'trusted',
    );
    const changed = await store.check('server.example', 22, keyB);
    expect(changed).toMatchObject({
      status: 'changed',
      source: 'user',
      knownFingerprints: [fingerprint(keyA)],
    });
    expect((await store.check('other.example', 22, keyA)).status).toBe(
      'unknown',
    );

    await store.trust('server.example', 22, keyB);
    expect(await readFile(userFile, 'utf8')).toBe(original);
    // The app's explicit decision now takes precedence over the user's file.
    expect((await store.check('server.example', 22, keyB)).status).toBe(
      'trusted',
    );
    expect((await store.check('server.example', 22, keyA)).status).toBe(
      'changed',
    );
  });

  it('does not let wildcard patterns grant trust', async () => {
    const userFile = path.join(dir, 'user_known_hosts');
    await writeFile(
      userFile,
      `* ssh-ed25519 ${keyA.toString('base64')}\n*.example ssh-ed25519 ${keyA.toString('base64')}\n`,
    );
    const store = new KnownHosts(path.join(dir, 'app'), userFile);
    expect((await store.check('a.example', 22, keyA)).status).toBe('unknown');
  });

  it('replaces only the trusted host and keeps other entries', async () => {
    const appFile = path.join(dir, 'app_known_hosts');
    const store = new KnownHosts(appFile, null);
    await store.trust('one.example', 22, keyA);
    await store.trust('two.example', 2200, keyA);
    await store.trust('one.example', 22, keyB);
    const lines = (await readFile(appFile, 'utf8')).trim().split('\n');
    expect(lines).toHaveLength(2);
    expect(lines.some((l) => l.startsWith('[two.example]:2200 '))).toBe(true);
    expect((await store.check('one.example', 22, keyB)).status).toBe('trusted');
  });
});

describe('secret store', () => {
  const xor: Encryptor = {
    isEncryptionAvailable: () => true,
    getSelectedStorageBackend: () => 'gnome_libsecret',
    encryptString: (plain) => Buffer.from(plain).map((b) => b ^ 0x33) as Buffer,
    decryptString: (data) => Buffer.from(data.map((b) => b ^ 0x33)).toString(),
  };

  it('refuses to save when the only backend is plaintext', async () => {
    const store = new SecretStore(path.join(dir, 's.json'), {
      ...xor,
      getSelectedStorageBackend: () => 'basic_text',
    });
    expect(store.status().available).toBe(false);
    expect(await store.save('host-1', 'password', 'pw')).toBe(false);
    await expect(readFile(path.join(dir, 's.json'))).rejects.toThrow();
  });

  it('round-trips secrets without writing them in plain text and forgets them', async () => {
    const file = path.join(dir, 's.json');
    const store = new SecretStore(file, xor);
    expect(await store.save('host-1', 'password', 'hunter2!')).toBe(true);
    expect(await store.save('../evil', 'password', 'x')).toBe(false);
    expect(await store.get('host-1', 'password')).toBe('hunter2!');
    expect(await readFile(file, 'utf8')).not.toContain('hunter2');
    expect(await store.savedFor()).toEqual({ 'host-1': ['password'] });
    await store.forget('host-1');
    expect(await store.get('host-1', 'password')).toBeNull();
  });

  it('treats undecryptable values as not saved', async () => {
    const file = path.join(dir, 's.json');
    await writeFile(
      file,
      JSON.stringify({
        version: 1,
        entries: { 'host-1': { password: 'AAAA' } },
      }),
    );
    const store = new SecretStore(file, {
      ...xor,
      decryptString: () => {
        throw new Error('keyring key changed');
      },
    });
    expect(await store.get('host-1', 'password')).toBeNull();
  });
});

describe('~/.ssh/config reader', () => {
  it('reads only HostName, User, Port and IdentityFile and ignores commands', async () => {
    const file = path.join(dir, 'config');
    await writeFile(
      file,
      [
        'Host bastion prod-*',
        '  HostName 10.1.2.3',
        '  User ops',
        '  Port 2201',
        '  IdentityFile ~/.ssh/id_ops',
        '  ProxyCommand nc -X connect evil %h %p',
        '  LocalCommand rm -rf /',
        'Host *',
        '  User fallback',
        '  Port 22',
      ].join('\n'),
    );
    const entry = await lookupSshConfig('bastion', file);
    expect(entry).toEqual({
      hostName: '10.1.2.3',
      user: 'ops',
      port: 2201,
      identityFile: path.join(os.homedir(), '.ssh/id_ops'),
    });
    expect(await lookupSshConfig('missing', file)).toBeNull();
    expect(await listSshConfigAliases(file)).toEqual(['bastion']);
  });
});

describe('SSH host validation', () => {
  const valid: SshHostDraft = {
    name: 'Web',
    host: 'web.example.com',
    port: 22,
    username: 'deploy',
    auth: 'agent',
    keyPath: null,
    configAlias: null,
    group: 'Production',
    tags: ['web'],
    notes: '',
    connectTimeout: 20,
    keepAlive: 15,
  };

  it('accepts a complete host and reports each invalid field', () => {
    expect(validateSshHost(valid)).toEqual({});
    expect(
      validateSshHost({ ...valid, host: '-oProxyCommand=evil' }),
    ).toHaveProperty('host');
    expect(validateSshHost({ ...valid, host: 'two words' })).toHaveProperty(
      'host',
    );
    expect(validateSshHost({ ...valid, username: '-l root' })).toHaveProperty(
      'username',
    );
    expect(validateSshHost({ ...valid, port: 70000 })).toHaveProperty('port');
    expect(
      validateSshHost({ ...valid, auth: 'key', keyPath: null }),
    ).toHaveProperty('keyPath');
    expect(
      validateSshHost({ ...valid, auth: 'key', keyPath: 'relative/key' }),
    ).toHaveProperty('keyPath');
    expect(
      validateSshHost({
        ...valid,
        host: '',
        configAlias: 'bastion',
        username: '',
      }),
    ).toEqual({});
  });

  it('drops invalid hosts when loading the saved file and never keeps secrets', () => {
    const file = parseProfilesFile({
      version: 1,
      hosts: [
        { id: 'h1', ...valid, password: 'leak' },
        { id: 'h2', ...valid, host: '-oProxyCommand=x' },
        { id: '../h3', ...valid },
      ],
    });
    expect(file.hosts.map((h) => h.id)).toEqual(['h1']);
    expect(file.hosts[0]).not.toHaveProperty('password');
    expect(parseProfilesFile({ version: 1 }).hosts).toEqual([]);
  });
});

describe('IPC validation', () => {
  it('accepts a well-formed SSH request and rejects malformed ones', () => {
    expect(
      sshRequest({
        hostId: 'host-1',
        requestId: 'abcdef12',
        password: 'pw',
        saveSecret: true,
      }),
    ).toEqual({
      hostId: 'host-1',
      requestId: 'abcdef12',
      password: 'pw',
      saveSecret: true,
    });
    expect(() =>
      sshRequest({ hostId: '../x', requestId: 'abcdef12' }),
    ).toThrow();
    expect(() =>
      sshRequest({ hostId: 'host-1', requestId: 'short' }),
    ).toThrow();
    expect(() =>
      sshRequest({ hostId: 'host-1', requestId: 'abcdef12', password: 'a\0b' }),
    ).toThrow();
    expect(() =>
      sshRequest({
        hostId: 'host-1',
        requestId: 'abcdef12',
        password: 'x'.repeat(2000),
      }),
    ).toThrow();
    expect(() =>
      sshRequest({
        hostId: 'host-1',
        requestId: 'abcdef12',
        saveSecret: 'yes',
      }),
    ).toThrow();
  });

  it('ignores local shell fields on SSH requests and bounds the terminal size', () => {
    const request = createRequest({
      cols: 80,
      rows: 24,
      shell: '/bin/evil',
      ssh: { hostId: 'h', requestId: 'abcdef12' },
    });
    expect(request).toEqual({
      cols: 80,
      rows: 24,
      ssh: { hostId: 'h', requestId: 'abcdef12' },
    });
    expect(() => createRequest({ cols: 0, rows: 24 })).toThrow();
    expect(() =>
      createRequest({ cols: 80, rows: 24, cwd: 'relative' }),
    ).toThrow();
  });
});
