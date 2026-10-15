import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { utils } from 'ssh2';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  HostKeyPrompt,
  SessionExit,
  SshCreateRequest,
} from '../src/shared/api';
import type { SshHost } from '../src/shared/config';
import {
  SessionManager,
  type SessionOwner,
} from '../src/main/sessions/session-manager';
import { fingerprint, KnownHosts } from '../src/main/ssh/known-hosts';
import { SecretStore, type Encryptor } from '../src/main/ssh/secrets';
import { SshBackend } from '../src/main/ssh/ssh-backend';
import {
  HostKeyPrompts,
  openSshSession,
  type SshEnvironment,
} from '../src/main/ssh/ssh-sessions';
import {
  generateHostKey,
  publicBlob,
  startServer,
  type TestServer,
} from './helpers/ssh-server';

/** A reversible stand-in for safeStorage (the real one needs the OS keyring). */
const fakeKeyring: Encryptor = {
  isEncryptionAvailable: () => true,
  getSelectedStorageBackend: () => 'kwallet6',
  encryptString: (plain) =>
    Buffer.from(plain, 'utf8').map((b) => b ^ 0x5a) as Buffer,
  decryptString: (data) =>
    Buffer.from(data.map((b) => b ^ 0x5a)).toString('utf8'),
};

function host(overrides: Partial<SshHost> & { port: number }): SshHost {
  return {
    id: 'host-1',
    name: 'Test box',
    host: '127.0.0.1',
    username: 'tester',
    auth: 'password',
    keyPath: null,
    configAlias: null,
    group: null,
    tags: [],
    notes: '',
    connectTimeout: 5,
    keepAlive: 0,
    ...overrides,
  };
}

async function waitFor(check: () => boolean, ms = 5000): Promise<void> {
  const start = Date.now();
  while (!check()) {
    if (Date.now() - start > ms)
      throw new Error('timed out waiting for condition');
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

let dir: string;
let server: TestServer;
let hosts: Map<string, SshHost>;
let env: SshEnvironment;
let knownHostsFile: string;

function request(extra: Partial<SshCreateRequest> = {}): SshCreateRequest {
  return {
    hostId: 'host-1',
    requestId: `req-${Math.random().toString(36).slice(2, 10)}`,
    ...extra,
  };
}

function hooks(
  trust: boolean | ((p: Omit<HostKeyPrompt, 'promptId'>) => boolean) = true,
) {
  const asked: Omit<HostKeyPrompt, 'promptId'>[] = [];
  const progress: string[] = [];
  return {
    asked,
    progress,
    hooks: {
      askHostKey: async (prompt: Omit<HostKeyPrompt, 'promptId'>) => {
        asked.push(prompt);
        return typeof trust === 'function' ? trust(prompt) : trust;
      },
      onProgress: (state: string) => progress.push(state),
      signal: new AbortController().signal,
    },
  };
}

function collect(backend: SshBackend) {
  const state = { out: '', exit: null as SessionExit | null };
  backend.onData((text) => (state.out += text));
  backend.onExit((exit) => (state.exit = exit));
  return state;
}

beforeEach(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), 'rtx-ssh-test-'));
  server = await startServer({
    users: [{ username: 'tester', password: 'correct horse' }],
  });
  hosts = new Map([['host-1', host({ port: server.port })]]);
  knownHostsFile = path.join(dir, 'known_hosts');
  env = {
    getHost: async (id) => hosts.get(id) ?? null,
    knownHosts: new KnownHosts(knownHostsFile, null),
    secrets: new SecretStore(path.join(dir, 'secrets.json'), fakeKeyring),
    lookupConfig: async () => null,
    agentSocket: undefined,
  };
});

afterEach(async () => {
  await server.close();
  await rm(dir, { recursive: true, force: true });
});

describe('host key verification', () => {
  it('asks before trusting an unknown host and remembers the decision', async () => {
    const first = hooks(true);
    const opened = await openSshSession(
      request({ password: 'correct horse' }),
      80,
      24,
      env,
      first.hooks,
    );
    expect(first.asked).toHaveLength(1);
    expect(first.asked[0]).toMatchObject({
      status: 'unknown',
      host: '127.0.0.1',
      port: server.port,
      keyType: 'ssh-ed25519',
      fingerprint: fingerprint(publicBlob(server.hostKey)),
    });
    expect(first.progress).toEqual([
      'connecting',
      'authenticating',
      'connected',
    ]);
    expect(await readFile(knownHostsFile, 'utf8')).toContain(
      `[127.0.0.1]:${server.port} ssh-ed25519 `,
    );
    opened.backend.kill();

    const second = hooks(true);
    const again = await openSshSession(
      request({ password: 'correct horse' }),
      80,
      24,
      env,
      second.hooks,
    );
    expect(second.asked).toHaveLength(0);
    again.backend.kill();
  });

  it('never connects when the user does not trust an unknown key', async () => {
    const decision = hooks(false);
    await expect(
      openSshSession(
        request({ password: 'correct horse' }),
        80,
        24,
        env,
        decision.hooks,
      ),
    ).rejects.toMatchObject({
      code: 'host-key-rejected',
    });
    expect(server.shells).toBe(0);
  });

  it('blocks a changed host key unless the user explicitly replaces it', async () => {
    await env.knownHosts.trust(
      '127.0.0.1',
      server.port,
      publicBlob(generateHostKey()),
    );
    const blocked = hooks(false);
    await expect(
      openSshSession(
        request({ password: 'correct horse' }),
        80,
        24,
        env,
        blocked.hooks,
      ),
    ).rejects.toMatchObject({
      code: 'host-key-changed',
    });
    expect(blocked.asked[0]).toMatchObject({
      status: 'changed',
      source: 'app',
    });
    expect(blocked.asked[0].knownFingerprints).toHaveLength(1);
    expect(server.shells).toBe(0);

    const replaced = hooks(true);
    const opened = await openSshSession(
      request({ password: 'correct horse' }),
      80,
      24,
      env,
      replaced.hooks,
    );
    const check = await env.knownHosts.check(
      '127.0.0.1',
      server.port,
      publicBlob(server.hostKey),
    );
    expect(check.status).toBe('trusted');
    opened.backend.kill();
  });

  it('refuses a key marked @revoked without asking', async () => {
    const blob = publicBlob(server.hostKey);
    await writeFile(
      knownHostsFile,
      `@revoked * ssh-ed25519 ${blob.toString('base64')}\n`,
    );
    const decision = hooks(true);
    await expect(
      openSshSession(
        request({ password: 'correct horse' }),
        80,
        24,
        env,
        decision.hooks,
      ),
    ).rejects.toMatchObject({
      code: 'host-key-revoked',
    });
    expect(decision.asked).toHaveLength(0);
  });
});

describe('authentication', () => {
  it('reports a rejected password as an authentication failure', async () => {
    await expect(
      openSshSession(
        request({ password: 'wrong' }),
        80,
        24,
        env,
        hooks().hooks,
      ),
    ).rejects.toMatchObject({ code: 'auth' });
  });

  it('asks for a password when none was typed or saved', async () => {
    await expect(
      openSshSession(request(), 80, 24, env, hooks().hooks),
    ).rejects.toMatchObject({ code: 'password-required' });
  });

  it('saves a typed password only after a successful login, then reuses it', async () => {
    await expect(
      openSshSession(
        request({ password: 'wrong', saveSecret: true }),
        80,
        24,
        env,
        hooks().hooks,
      ),
    ).rejects.toMatchObject({ code: 'auth' });
    expect(await env.secrets.get('host-1', 'password')).toBeNull();

    const opened = await openSshSession(
      request({ password: 'correct horse', saveSecret: true }),
      80,
      24,
      env,
      hooks().hooks,
    );
    opened.backend.kill();
    expect(await env.secrets.get('host-1', 'password')).toBe('correct horse');
    expect(
      await readFile(path.join(dir, 'secrets.json'), 'utf8'),
    ).not.toContain('correct horse');

    const reused = await openSshSession(request(), 80, 24, env, hooks().hooks);
    reused.backend.kill();
  });

  it('logs in with an encrypted private key and classifies passphrase problems', async () => {
    const keys = utils.generateKeyPairSync('ed25519', {
      passphrase: 'open sesame',
      cipher: 'aes256-ctr',
      rounds: 4,
    });
    await server.close();
    server = await startServer({
      users: [{ username: 'tester', publicKey: keys.public }],
    });
    const keyFile = path.join(dir, 'id_ed25519');
    await writeFile(keyFile, keys.private, { mode: 0o600 });
    hosts.set(
      'host-1',
      host({ port: server.port, auth: 'key', keyPath: keyFile }),
    );

    await expect(
      openSshSession(request(), 80, 24, env, hooks().hooks),
    ).rejects.toMatchObject({ code: 'passphrase-required' });
    await expect(
      openSshSession(
        request({ passphrase: 'nope' }),
        80,
        24,
        env,
        hooks().hooks,
      ),
    ).rejects.toMatchObject({
      code: 'passphrase-wrong',
    });
    const opened = await openSshSession(
      request({ passphrase: 'open sesame' }),
      80,
      24,
      env,
      hooks().hooks,
    );
    const io = collect(opened.backend);
    opened.backend.write('whoami\r');
    await waitFor(() => io.out.includes('tester'));
    opened.backend.kill();
  });

  it('reports a missing key file without reading anything else', async () => {
    hosts.set(
      'host-1',
      host({
        port: server.port,
        auth: 'key',
        keyPath: path.join(dir, 'missing'),
      }),
    );
    await expect(
      openSshSession(request(), 80, 24, env, hooks().hooks),
    ).rejects.toMatchObject({ code: 'key-file' });
  });
});

describe('network failures', () => {
  it('reports a refused connection', async () => {
    const port = server.port;
    await server.close();
    server = await startServer({ users: [] });
    hosts.set('host-1', host({ port }));
    await expect(
      openSshSession(request({ password: 'x' }), 80, 24, env, hooks().hooks),
    ).rejects.toMatchObject({ code: 'refused' });
  });

  it('reports a name that does not resolve', async () => {
    hosts.set('host-1', host({ port: 22, host: 'no-such-host.invalid' }));
    await expect(
      openSshSession(request({ password: 'x' }), 80, 24, env, hooks().hooks),
    ).rejects.toMatchObject({ code: 'dns' });
  });

  it('can be cancelled while waiting for the host key decision', async () => {
    const controller = new AbortController();
    const attempt = openSshSession(
      request({ password: 'correct horse' }),
      80,
      24,
      env,
      {
        askHostKey: () => new Promise<boolean>(() => controller.abort()),
        onProgress: () => undefined,
        signal: controller.signal,
      },
    );
    await expect(attempt).rejects.toMatchObject({ code: 'cancelled' });
    expect(server.shells).toBe(0);
  });
});

describe('interactive sessions', () => {
  it('streams input and output both ways and propagates resizes', async () => {
    const opened = await openSshSession(
      request({ password: 'correct horse' }),
      120,
      40,
      env,
      hooks().hooks,
    );
    const io = collect(opened.backend);
    await waitFor(() => io.out.includes('Welcome tester'));
    opened.backend.write('echo héllo wörld ✓\r');
    await waitFor(() => io.out.includes('héllo wörld ✓\r\n'));
    expect(server.sizes[0]).toEqual({ cols: 120, rows: 40 });
    opened.backend.resize(90, 30);
    await waitFor(() => server.sizes.length === 2);
    expect(server.sizes[1]).toEqual({ cols: 90, rows: 30 });
    opened.backend.write('\x03');
    await waitFor(() => io.out.includes('^C'));
    opened.backend.kill();
  });

  it('keeps concurrent sessions independent', async () => {
    const a = await openSshSession(
      request({ password: 'correct horse' }),
      80,
      24,
      env,
      hooks().hooks,
    );
    const b = await openSshSession(
      request({ password: 'correct horse' }),
      100,
      30,
      env,
      hooks().hooks,
    );
    const ioA = collect(a.backend);
    const ioB = collect(b.backend);
    a.backend.write('echo only-in-a\r');
    b.backend.write('echo only-in-b\r');
    await waitFor(
      () =>
        ioA.out.includes('only-in-a\r\n') && ioB.out.includes('only-in-b\r\n'),
    );
    expect(ioA.out).not.toContain('only-in-b');
    expect(ioB.out).not.toContain('only-in-a');
    expect(server.connections).toBe(2);
    a.backend.kill();
    await waitFor(() => ioA.exit !== null);
    b.backend.write('echo still-here\r');
    await waitFor(() => ioB.out.includes('still-here\r\n'));
    b.backend.kill();
  });

  it('reports the remote exit status when the shell exits', async () => {
    const opened = await openSshSession(
      request({ password: 'correct horse' }),
      80,
      24,
      env,
      hooks().hooks,
    );
    const io = collect(opened.backend);
    opened.backend.write('exit\r');
    await waitFor(() => io.exit !== null);
    expect(io.exit).toMatchObject({ exitCode: 0 });
    expect(io.exit?.reason).toContain('exited with status 0');
    expect(io.out).toContain('bye');
  });

  it('reports a dropped connection and allows a fresh reconnect', async () => {
    const opened = await openSshSession(
      request({ password: 'correct horse' }),
      80,
      24,
      env,
      hooks().hooks,
    );
    const io = collect(opened.backend);
    server.dropAll();
    await waitFor(() => io.exit !== null);
    expect(io.exit?.exitCode).toBe(-1);
    expect(io.exit?.reason).toMatch(/closed/i);

    const reconnected = await openSshSession(
      request({ password: 'correct horse' }),
      80,
      24,
      env,
      hooks().hooks,
    );
    const io2 = collect(reconnected.backend);
    reconnected.backend.write('whoami\r');
    await waitFor(() => io2.out.includes('tester'));
    expect(server.shells).toBe(2);
    reconnected.backend.kill();
  });

  it('closes cleanly on disconnect', async () => {
    const opened = await openSshSession(
      request({ password: 'correct horse' }),
      80,
      24,
      env,
      hooks().hooks,
    );
    const io = collect(opened.backend);
    opened.backend.kill();
    await waitFor(() => io.exit !== null);
    expect(io.exit?.reason).toBe('Disconnected.');
    opened.backend.write('ignored after close\r');
  });
});

describe('session manager', () => {
  function owner(id: number) {
    const sent: unknown[][] = [];
    const handlers: Record<string, () => void> = {};
    const fake: SessionOwner & { sent: unknown[][]; destroy(): void } = {
      id,
      sent,
      send: ((channel: string, ...args: unknown[]) =>
        sent.push([channel, ...args])) as unknown as SessionOwner['send'],
      isDestroyed: () => false,
      once: ((event: string, handler: () => void) => {
        handlers[event] = handler;
        return fake;
      }) as unknown as SessionOwner['once'],
      on: (() => fake) as unknown as SessionOwner['on'],
      destroy: () => handlers.destroyed?.(),
    };
    return fake;
  }

  function manager() {
    const prompts = new HostKeyPrompts();
    const sessions = new SessionManager('test', { env, prompts });
    return { sessions, prompts };
  }

  it('routes the host key question to the window that asked, and only it may answer', async () => {
    const { sessions, prompts } = manager();
    const win = owner(1);
    const attempt = sessions.create(
      win,
      { cols: 80, rows: 24, ssh: request({ password: 'correct horse' }) },
      null,
    );
    await waitFor(() =>
      win.sent.some(([channel]) => channel === 'ssh:host-key-prompt'),
    );
    const prompt = win.sent.find(
      ([channel]) => channel === 'ssh:host-key-prompt',
    )![1] as HostKeyPrompt;
    prompts.answer(2, prompt.promptId, true);
    prompts.answer(1, prompt.promptId, true);
    const result = await attempt;
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.session).toMatchObject({
      kind: 'ssh',
      pid: 0,
      remote: { host: '127.0.0.1', username: 'tester' },
    });

    const other = owner(2);
    sessions.write(other, result.session.id, 'echo from-other-window\r');
    sessions.write(win, result.session.id, 'echo from-owner\r');
    await waitFor(() =>
      win.sent.some(
        ([channel, , data]) =>
          channel === 'terminal:data' && String(data).includes('from-owner'),
      ),
    );
    const output = win.sent
      .filter(([channel]) => channel === 'terminal:data')
      .map(([, , d]) => d)
      .join('');
    expect(output).not.toContain('from-other-window');
    expect(other.sent).toHaveLength(0);
    await sessions.close(other, result.session.id);
    expect(sessions.size).toBe(1);
    await sessions.close(win, result.session.id);
    expect(sessions.size).toBe(0);
  });

  it('refuses a second attempt with the same request id', async () => {
    const { sessions, prompts } = manager();
    const win = owner(1);
    const req = request({ password: 'correct horse' });
    const first = sessions.create(win, { cols: 80, rows: 24, ssh: req }, null);
    const second = await sessions.create(
      win,
      { cols: 80, rows: 24, ssh: req },
      null,
    );
    expect(second).toMatchObject({ ok: false, code: 'cancelled' });
    await waitFor(() =>
      win.sent.some(([channel]) => channel === 'ssh:host-key-prompt'),
    );
    const prompt = win.sent.find(
      ([channel]) => channel === 'ssh:host-key-prompt',
    )![1] as HostKeyPrompt;
    prompts.answer(1, prompt.promptId, true);
    const result = await first;
    if (result.ok) await sessions.close(win, result.session.id);
  });

  it('ends SSH sessions on shutdown without signalling a process group', async () => {
    await env.knownHosts.trust(
      '127.0.0.1',
      server.port,
      publicBlob(server.hostKey),
    );
    const { sessions } = manager();
    const win = owner(1);
    const a = await sessions.create(
      win,
      { cols: 80, rows: 24, ssh: request({ password: 'correct horse' }) },
      null,
    );
    const b = await sessions.create(
      win,
      { cols: 80, rows: 24, ssh: request({ password: 'correct horse' }) },
      null,
    );
    expect(a.ok && b.ok).toBe(true);
    const kill = vi.spyOn(process, 'kill');
    await sessions.closeAll(3000);
    expect(kill).not.toHaveBeenCalled();
    kill.mockRestore();
    expect(sessions.size).toBe(0);
    expect(
      win.sent.filter(([channel]) => channel === 'terminal:exit'),
    ).toHaveLength(2);
  });

  it('ends a window’s sessions and pending questions when the window is destroyed', async () => {
    const { sessions } = manager();
    const win = owner(1);
    const pending = sessions.create(
      win,
      { cols: 80, rows: 24, ssh: request({ password: 'correct horse' }) },
      null,
    );
    await waitFor(() =>
      win.sent.some(([channel]) => channel === 'ssh:host-key-prompt'),
    );
    win.destroy();
    expect(await pending).toMatchObject({ ok: false });
    expect(server.shells).toBe(0);
  });
});
