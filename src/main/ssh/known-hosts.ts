import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';

/**
 * Host key trust store in OpenSSH known_hosts format. The app writes only its own file; the
 * user's ~/.ssh/known_hosts is read so hosts already trusted with OpenSSH are recognised, but it
 * is never modified. When both files know a host, the app's file decides: that is where an
 * explicit "trust new key" decision made in rtx-terminal is recorded.
 */

export type HostKeyStatus = 'trusted' | 'unknown' | 'changed' | 'revoked';

export type HostKeyCheck = {
  status: HostKeyStatus;
  keyType: string;
  fingerprint: string;
  /** Fingerprints already on record for this host (changed keys show what was expected). */
  knownFingerprints: string[];
  /** Which file the matching or conflicting entries came from. */
  source: 'app' | 'user' | null;
};

type Entry = {
  marker: '@revoked' | null;
  hosts: string[];
  keyType: string;
  key: Buffer;
};

/** The name OpenSSH uses for a host in known_hosts: bare for port 22, else [host]:port. */
export function knownHostsName(host: string, port: number): string {
  const lower = host.toLowerCase();
  return port === 22 ? lower : `[${lower}]:${port}`;
}

/** SHA256 fingerprint in the format `ssh-keygen -lf` prints. */
export function fingerprint(key: Buffer): string {
  return `SHA256:${createHash('sha256').update(key).digest('base64').replace(/=+$/, '')}`;
}

/** The key type is the first string inside an SSH public key blob. */
export function keyTypeOf(key: Buffer): string {
  if (key.length < 4) return 'unknown';
  const length = key.readUInt32BE(0);
  if (length <= 0 || length > 64 || 4 + length > key.length) return 'unknown';
  return key.toString('ascii', 4, 4 + length);
}

function hostMatches(pattern: string, name: string): boolean {
  // Hashed entries: |1|base64(salt)|base64(HMAC-SHA1(salt, name)).
  if (pattern.startsWith('|1|')) {
    const [, , salt, hash] = pattern.split('|');
    if (!salt || !hash) return false;
    const expected = Buffer.from(hash, 'base64');
    const actual = createHmac('sha1', Buffer.from(salt, 'base64'))
      .update(name)
      .digest();
    return (
      expected.length === actual.length && timingSafeEqual(expected, actual)
    );
  }
  // Wildcards and negations are deliberately not honoured: they can only widen trust.
  if (/[*?!]/.test(pattern)) return false;
  return pattern.toLowerCase() === name;
}

export function parseKnownHosts(text: string): Entry[] {
  const entries: Entry[] = [];
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const fields = line.split(/\s+/);
    let marker: Entry['marker'] = null;
    if (fields[0].startsWith('@')) {
      // @cert-authority entries trust certificates, which this client does not use.
      if (fields[0] !== '@revoked') continue;
      marker = '@revoked';
      fields.shift();
    }
    const [hostField, keyType, keyData] = fields;
    if (!hostField || !keyType || !keyData) continue;
    const key = Buffer.from(keyData, 'base64');
    if (key.length === 0) continue;
    entries.push({ marker, hosts: hostField.split(','), keyType, key });
  }
  return entries;
}

function evaluate(entries: Entry[], name: string, key: Buffer) {
  const forHost = entries.filter((entry) =>
    entry.hosts.some((pattern) => hostMatches(pattern, name)),
  );
  const revoked = entries.some(
    (entry) => entry.marker === '@revoked' && entry.key.equals(key),
  );
  const valid = forHost.filter((entry) => entry.marker === null);
  return {
    revoked,
    known: valid.length > 0,
    matches: valid.some((entry) => entry.key.equals(key)),
    fingerprints: valid.map((entry) => fingerprint(entry.key)),
  };
}

export class KnownHosts {
  private queue: Promise<void> = Promise.resolve();

  constructor(
    private readonly appFile: string,
    private readonly userFile: string | null,
  ) {}

  private async readFile(file: string | null): Promise<Entry[]> {
    if (!file) return [];
    try {
      return parseKnownHosts(await fs.readFile(file, 'utf8'));
    } catch {
      return [];
    }
  }

  async check(host: string, port: number, key: Buffer): Promise<HostKeyCheck> {
    const name = knownHostsName(host, port);
    const base = { keyType: keyTypeOf(key), fingerprint: fingerprint(key) };
    const app = evaluate(await this.readFile(this.appFile), name, key);
    const user = evaluate(await this.readFile(this.userFile), name, key);
    if (app.revoked || user.revoked) {
      return {
        ...base,
        status: 'revoked',
        knownFingerprints: [],
        source: app.revoked ? 'app' : 'user',
      };
    }
    if (app.known) {
      return {
        ...base,
        status: app.matches ? 'trusted' : 'changed',
        knownFingerprints: app.fingerprints,
        source: 'app',
      };
    }
    if (user.known) {
      return {
        ...base,
        status: user.matches ? 'trusted' : 'changed',
        knownFingerprints: user.fingerprints,
        source: 'user',
      };
    }
    return { ...base, status: 'unknown', knownFingerprints: [], source: null };
  }

  /**
   * Records `key` as the key for host:port in the app's file, replacing earlier app entries for
   * that host. Only called after the user explicitly approved this exact key.
   */
  trust(host: string, port: number, key: Buffer): Promise<void> {
    const name = knownHostsName(host, port);
    const line = `${name} ${keyTypeOf(key)} ${key.toString('base64')}`;
    const next = this.queue.then(async () => {
      let text = '';
      try {
        text = await fs.readFile(this.appFile, 'utf8');
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }
      const kept = text.split('\n').filter((raw) => {
        const line = raw.trim();
        if (!line) return false;
        if (line.startsWith('#') || line.startsWith('@')) return true;
        const hostField = line.split(/\s+/)[0] ?? '';
        return !hostField
          .split(',')
          .some((pattern) => hostMatches(pattern, name));
      });
      await fs.mkdir(path.dirname(this.appFile), {
        recursive: true,
        mode: 0o700,
      });
      const tmp = `${this.appFile}.${process.pid}.tmp`;
      await fs.writeFile(tmp, `${[...kept, line].join('\n')}\n`, {
        mode: 0o600,
      });
      await fs.rename(tmp, this.appFile);
    });
    this.queue = next.catch(() => undefined);
    return next;
  }
}
