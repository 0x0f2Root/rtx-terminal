import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/**
 * A deliberately small reader for ~/.ssh/config. It looks up one `Host` alias and returns only
 * HostName, User, Port and IdentityFile. Everything else (ProxyCommand, LocalCommand, Match,
 * Include, …) is ignored: the file is untrusted input and nothing in it is ever executed.
 */

export type SshConfigEntry = {
  hostName?: string;
  user?: string;
  port?: number;
  identityFile?: string;
};

const MAX_BYTES = 256 * 1024;

export function defaultSshConfigPath(): string {
  return path.join(os.homedir(), '.ssh', 'config');
}

function expandHome(value: string): string {
  return value === '~' || value.startsWith('~/')
    ? path.join(os.homedir(), value.slice(1))
    : value;
}

function tokens(line: string): [string, string] | null {
  const match = /^\s*([A-Za-z]+)\s*(?:=\s*|\s+)(.+?)\s*$/.exec(line);
  if (!match) return null;
  return [match[1].toLowerCase(), match[2].replace(/^"(.*)"$/, '$1')];
}

async function readConfig(file: string): Promise<string | null> {
  try {
    const stat = await fs.stat(file);
    if (!stat.isFile() || stat.size > MAX_BYTES) return null;
    return await fs.readFile(file, 'utf8');
  } catch {
    return null;
  }
}

/** Plain aliases from `Host` lines (patterns with wildcards or negation are skipped). */
export async function listSshConfigAliases(
  file = defaultSshConfigPath(),
): Promise<string[]> {
  const text = await readConfig(file);
  if (!text) return [];
  const aliases = new Set<string>();
  for (const line of text.split('\n')) {
    const kv = tokens(line);
    if (!kv || kv[0] !== 'host') continue;
    for (const alias of kv[1].split(/\s+/)) {
      if (
        alias &&
        !/[*?!]/.test(alias) &&
        /^[A-Za-z0-9._@+-]{1,128}$/.test(alias)
      )
        aliases.add(alias);
    }
  }
  return [...aliases].sort().slice(0, 500);
}

/** The first value of each supported key for `alias`, as OpenSSH applies them (first match wins). */
export async function lookupSshConfig(
  alias: string,
  file = defaultSshConfigPath(),
): Promise<SshConfigEntry | null> {
  const text = await readConfig(file);
  if (!text) return null;
  const entry: SshConfigEntry = {};
  let inMatchingBlock = false;
  let found = false;
  for (const line of text.split('\n')) {
    const kv = tokens(line);
    if (!kv) continue;
    const [key, value] = kv;
    if (key === 'host') {
      const patterns = value.split(/\s+/);
      // Exact aliases and the catch-all `*` apply; other patterns are not evaluated.
      inMatchingBlock = patterns.includes(alias) || patterns.includes('*');
      if (patterns.includes(alias)) found = true;
      continue;
    }
    if (key === 'match') {
      inMatchingBlock = false;
      continue;
    }
    if (!inMatchingBlock) continue;
    if (key === 'hostname' && entry.hostName === undefined)
      entry.hostName = value;
    else if (key === 'user' && entry.user === undefined) entry.user = value;
    else if (key === 'port' && entry.port === undefined) {
      const port = Number(value);
      if (Number.isInteger(port) && port >= 1 && port <= 65535)
        entry.port = port;
    } else if (key === 'identityfile' && entry.identityFile === undefined)
      entry.identityFile = expandHome(value);
  }
  return found ? entry : null;
}
