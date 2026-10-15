import { timingSafeEqual } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { Server, utils, type Connection, type ServerChannel } from 'ssh2';
import { serveSftp, type MemoryFs } from './sftp-fs';

/**
 * A real SSH server (ssh2's Server) on 127.0.0.1 for tests. It speaks the full protocol, with a
 * throwaway host key, and runs a tiny line-based shell instead of a system shell. It can also
 * serve an in-memory SFTP filesystem and respond to fixed exec commands, for the file manager and
 * resource monitor tests.
 */

export type TestUser = {
  username: string;
  password?: string;
  /** OpenSSH public key text, for publickey auth. */
  publicKey?: string;
};

/** Canned response for one exec command; return null to reject the command. */
export type ExecResult = { stdout?: string; stderr?: string; code?: number };
export type ExecHandler = (command: string) => ExecResult | null;

export type TestServer = {
  port: number;
  hostKey: Buffer;
  /** Every pty request and window change, in order. */
  sizes: { cols: number; rows: number }[];
  connections: number;
  shells: number;
  /** Every exec command received, in order. */
  execs: string[];
  /** Closes every client connection from the server side (a network drop). */
  dropAll(): void;
  close(): Promise<void>;
};

export function generateHostKey(): Buffer {
  return Buffer.from(utils.generateKeyPairSync('ed25519').private);
}

function equal(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

function runShell(stream: ServerChannel, username: string): void {
  let line = '';
  stream.write(`Welcome ${username}\r\n$ `);
  stream.on('data', (chunk: Buffer) => {
    for (const ch of chunk.toString('utf8')) {
      if (ch === '\r' || ch === '\n') {
        const command = line.trim();
        line = '';
        if (command === 'exit') {
          stream.write('\r\nbye\r\n');
          stream.exit(0);
          stream.end();
          return;
        }
        let output = '';
        if (command === 'whoami') output = username;
        else if (command.startsWith('echo ')) output = command.slice(5);
        else if (command) output = `sh: ${command}: not found`;
        stream.write(`\r\n${output ? `${output}\r\n` : ''}$ `);
      } else if (ch === '\x03') {
        line = '';
        stream.write('^C\r\n$ ');
      } else {
        line += ch;
        stream.write(ch);
      }
    }
  });
}

export async function startServer(options: {
  users: TestUser[];
  hostKey?: Buffer;
  port?: number;
  /** When set, the server offers an SFTP subsystem backed by this filesystem. */
  fs?: MemoryFs;
  /** When set, the server answers exec requests with these canned results. */
  exec?: ExecHandler;
}): Promise<TestServer> {
  const hostKey = options.hostKey ?? generateHostKey();
  const clients = new Set<Connection>();
  const state = {
    sizes: [] as { cols: number; rows: number }[],
    connections: 0,
    shells: 0,
    execs: [] as string[],
  };

  const server = new Server({ hostKeys: [hostKey] }, (client) => {
    clients.add(client);
    state.connections++;
    let username = '';
    client.on('error', () => undefined);
    client.on('close', () => clients.delete(client));
    client.on('authentication', (ctx) => {
      const user = options.users.find((u) => u.username === ctx.username);
      if (!user) return ctx.reject();
      if (
        ctx.method === 'password' &&
        user.password &&
        equal(ctx.password, user.password)
      ) {
        username = user.username;
        return ctx.accept();
      }
      if (ctx.method === 'publickey' && user.publicKey) {
        const allowed = utils.parseKey(user.publicKey);
        if (allowed instanceof Error || Array.isArray(allowed))
          return ctx.reject();
        if (
          ctx.key.algo !== allowed.type ||
          !ctx.key.data.equals(allowed.getPublicSSH())
        )
          return ctx.reject();
        // Without a signature the client is only asking whether this key would be accepted.
        if (!ctx.signature) return ctx.accept();
        if (allowed.verify(ctx.blob!, ctx.signature, ctx.hashAlgo) === true) {
          username = user.username;
          return ctx.accept();
        }
        return ctx.reject();
      }
      return ctx.reject(['password', 'publickey']);
    });
    client.on('ready', () => {
      client.on('session', (accept) => {
        const session = accept();
        session.on('pty', (acceptPty, _reject, info) => {
          state.sizes.push({ cols: info.cols, rows: info.rows });
          acceptPty?.();
        });
        session.on('window-change', (acceptChange, _reject, info) => {
          state.sizes.push({ cols: info.cols, rows: info.rows });
          acceptChange?.();
        });
        session.on('shell', (acceptShell) => {
          state.shells++;
          runShell(acceptShell(), username);
        });
        session.on('exec', (acceptExec, rejectExec, info) => {
          state.execs.push(info.command);
          const result = options.exec?.(info.command) ?? null;
          if (!result) {
            rejectExec?.();
            return;
          }
          const channel = acceptExec();
          if (result.stdout) channel.write(result.stdout);
          if (result.stderr) channel.stderr.write(result.stderr);
          channel.exit(result.code ?? 0);
          channel.end();
        });
        if (options.fs) {
          session.on('sftp', (acceptSftp) => {
            serveSftp(acceptSftp(), options.fs!);
          });
        }
      });
    });
  });

  await new Promise<void>((resolve) =>
    server.listen(options.port ?? 0, '127.0.0.1', resolve),
  );
  const port = (server.address() as AddressInfo).port;

  return {
    port,
    hostKey,
    get sizes() {
      return state.sizes;
    },
    get connections() {
      return state.connections;
    },
    get shells() {
      return state.shells;
    },
    get execs() {
      return state.execs;
    },
    dropAll() {
      for (const client of clients) client.end();
    },
    close() {
      for (const client of clients) client.end();
      return new Promise((resolve) => server.close(() => resolve()));
    },
  };
}

/** The public key blob a client will be shown for this server's host key. */
export function publicBlob(hostKey: Buffer): Buffer {
  const parsed = utils.parseKey(hostKey);
  if (parsed instanceof Error || Array.isArray(parsed))
    throw new Error('bad host key');
  return parsed.getPublicSSH();
}
