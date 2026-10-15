import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type {
  HostKeyPrompt,
  RemoteEndpoint,
  SshConnectState,
  SshCreateRequest,
} from '../../shared/api';
import type { SshHost } from '../../shared/config';
import type { KnownHosts } from './known-hosts';
import type { SecretStore } from './secrets';
import {
  SshBackend,
  SshConnectError,
  type HostKeyDecision,
  type SshAuth,
} from './ssh-backend';
import type { SshConfigEntry } from './ssh-config';

const MAX_KEY_BYTES = 64 * 1024;
const PROMPT_TIMEOUT_MS = 5 * 60 * 1000;

/** Everything an SSH connection attempt needs from the rest of the main process. */
export type SshEnvironment = {
  getHost(id: string): Promise<SshHost | null>;
  knownHosts: KnownHosts;
  secrets: SecretStore;
  lookupConfig(alias: string): Promise<SshConfigEntry | null>;
  agentSocket: string | undefined;
};

export type SshOpenHooks = {
  askHostKey(prompt: Omit<HostKeyPrompt, 'promptId'>): Promise<boolean>;
  onProgress(state: SshConnectState): void;
  signal: AbortSignal;
};

export type OpenedSsh = {
  backend: SshBackend;
  label: string;
  remote: RemoteEndpoint;
};

function expandHome(file: string): string {
  return file.startsWith('~/') ? path.join(os.homedir(), file.slice(2)) : file;
}

/** Reads a private key, refusing anything that is not a small regular file. */
async function readPrivateKey(file: string): Promise<Buffer> {
  const resolved = expandHome(file);
  if (!path.isAbsolute(resolved) || resolved.includes('\0')) {
    throw new SshConnectError(
      'key-file',
      'The private key path must be absolute or start with ~/.',
    );
  }
  try {
    const stat = await fs.stat(resolved);
    if (!stat.isFile())
      throw new SshConnectError('key-file', `${file} is not a file.`);
    if (stat.size > MAX_KEY_BYTES)
      throw new SshConnectError(
        'key-file',
        `${file} is too large to be a private key.`,
      );
    return await fs.readFile(resolved);
  } catch (error) {
    if (error instanceof SshConnectError) throw error;
    const code = (error as NodeJS.ErrnoException).code;
    throw new SshConnectError(
      'key-file',
      code === 'ENOENT'
        ? `The private key ${file} does not exist.`
        : code === 'EACCES'
          ? `The private key ${file} cannot be read (permission denied).`
          : `The private key ${file} could not be read.`,
    );
  }
}

/**
 * Turns a saved host into a live SSH session: fills blanks from ~/.ssh/config, gathers the
 * credentials, verifies the host key (asking the user when it is unknown or changed) and opens
 * the shell. Secrets the user typed are saved to the keyring only after login succeeded.
 */
export async function openSshSession(
  request: SshCreateRequest,
  cols: number,
  rows: number,
  env: SshEnvironment,
  hooks: SshOpenHooks,
): Promise<OpenedSsh> {
  const host = await env.getHost(request.hostId);
  if (!host)
    throw new SshConnectError(
      'host-missing',
      'This saved host no longer exists.',
    );

  const config = host.configAlias
    ? await env.lookupConfig(host.configAlias)
    : null;
  if (host.configAlias && !config) {
    throw new SshConnectError(
      'protocol',
      `"${host.configAlias}" was not found in ~/.ssh/config.`,
    );
  }
  const address = host.host || config?.hostName || host.configAlias || '';
  const username = host.username || config?.user || '';
  const port = host.port !== 22 ? host.port : (config?.port ?? 22);
  if (!address || !username) {
    throw new SshConnectError(
      'protocol',
      'The host has no address or user name to connect with.',
    );
  }

  let auth: SshAuth;
  let typedSecret: { kind: 'password' | 'passphrase'; value: string } | null =
    null;
  if (host.auth === 'agent') {
    if (!env.agentSocket) {
      throw new SshConnectError(
        'agent',
        'No SSH agent is running (SSH_AUTH_SOCK is not set).',
      );
    }
    auth = { kind: 'agent', socket: env.agentSocket };
  } else if (host.auth === 'key') {
    const keyPath = host.keyPath ?? config?.identityFile ?? null;
    if (!keyPath)
      throw new SshConnectError(
        'key-file',
        'Choose a private key for this host.',
      );
    const privateKey = await readPrivateKey(keyPath);
    let passphrase = request.passphrase;
    if (passphrase) typedSecret = { kind: 'passphrase', value: passphrase };
    else
      passphrase = (await env.secrets.get(host.id, 'passphrase')) ?? undefined;
    auth = { kind: 'key', privateKey, ...(passphrase ? { passphrase } : {}) };
  } else {
    let password = request.password;
    if (password) typedSecret = { kind: 'password', value: password };
    else password = (await env.secrets.get(host.id, 'password')) ?? undefined;
    if (!password)
      throw new SshConnectError(
        'password-required',
        'Enter the password for this host.',
      );
    auth = { kind: 'password', password };
  }

  const label = host.name;
  const verifyHostKey = async (key: Buffer): Promise<HostKeyDecision> => {
    const check = await env.knownHosts.check(address, port, key);
    if (check.status === 'trusted') return { ok: true };
    if (check.status === 'revoked') {
      return {
        ok: false,
        code: 'host-key-revoked',
        message: `The host key for ${address} is marked as revoked.`,
      };
    }
    const trust = await hooks.askHostKey({
      requestId: request.requestId,
      hostLabel: label,
      host: address,
      port,
      keyType: check.keyType,
      fingerprint: check.fingerprint,
      status: check.status,
      knownFingerprints: check.knownFingerprints,
      source: check.source,
    });
    if (!trust) {
      return check.status === 'changed'
        ? {
            ok: false,
            code: 'host-key-changed',
            message: `The host key for ${address} has changed and the connection was blocked.`,
          }
        : {
            ok: false,
            code: 'host-key-rejected',
            message: `The host key for ${address} was not trusted.`,
          };
    }
    await env.knownHosts.trust(address, port, key);
    return { ok: true };
  };

  const backend = await SshBackend.connect({
    host: address,
    port,
    username,
    auth,
    cols,
    rows,
    readyTimeoutMs: host.connectTimeout * 1000,
    keepAliveMs: host.keepAlive * 1000,
    verifyHostKey,
    onProgress: hooks.onProgress,
    signal: hooks.signal,
  });

  if (request.saveSecret && typedSecret) {
    await env.secrets
      .save(host.id, typedSecret.kind, typedSecret.value)
      .catch(() => false);
  }
  return {
    backend,
    label,
    remote: { hostId: host.id, host: address, port, username },
  };
}

type PendingPrompt = {
  ownerId: number;
  resolve: (trust: boolean) => void;
  timer: NodeJS.Timeout;
};

/**
 * Host-key questions waiting for the user. Each prompt belongs to the window that started the
 * connection; answers from any other window are ignored, and unanswered prompts reject.
 */
export class HostKeyPrompts {
  private readonly pending = new Map<string, PendingPrompt>();

  ask(
    owner: {
      id: number;
      isDestroyed(): boolean;
      send(channel: string, ...args: unknown[]): void;
    },
    channel: string,
    prompt: Omit<HostKeyPrompt, 'promptId'>,
  ): Promise<boolean> {
    if (owner.isDestroyed()) return Promise.resolve(false);
    const promptId = randomUUID();
    return new Promise((resolve) => {
      const timer = setTimeout(
        () => this.settle(promptId, false),
        PROMPT_TIMEOUT_MS,
      );
      timer.unref();
      this.pending.set(promptId, { ownerId: owner.id, resolve, timer });
      owner.send(channel, { ...prompt, promptId });
    });
  }

  answer(ownerId: number, promptId: string, trust: boolean): void {
    const prompt = this.pending.get(promptId);
    if (!prompt || prompt.ownerId !== ownerId) return;
    this.settle(promptId, trust);
  }

  /** Rejects every question a window was asked, when it closes or reloads. */
  rejectAllFor(ownerId: number): void {
    for (const [promptId, prompt] of this.pending) {
      if (prompt.ownerId === ownerId) this.settle(promptId, false);
    }
  }

  private settle(promptId: string, trust: boolean): void {
    const prompt = this.pending.get(promptId);
    if (!prompt) return;
    this.pending.delete(promptId);
    clearTimeout(prompt.timer);
    prompt.resolve(trust);
  }
}
