import { constants, promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { ShellInfo } from '../shared/api';

const FALLBACK_SHELLS = ['/bin/bash', '/usr/bin/bash', '/bin/sh'];

/** True when `file` is an absolute path to a regular, executable file. */
export async function isExecutableFile(file: string): Promise<boolean> {
  if (!path.isAbsolute(file) || file.includes('\0')) return false;
  try {
    const stat = await fs.stat(file);
    if (!stat.isFile()) return false;
    await fs.access(file, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

export async function isDirectory(dir: string): Promise<boolean> {
  if (!path.isAbsolute(dir) || dir.includes('\0')) return false;
  try {
    return (await fs.stat(dir)).isDirectory();
  } catch {
    return false;
  }
}

/** The user's login shell as the system reports it. */
export function systemShell(): string | null {
  const fromEnv = process.env.SHELL;
  if (fromEnv && path.isAbsolute(fromEnv)) return fromEnv;
  try {
    const fromPasswd = os.userInfo().shell;
    return fromPasswd && path.isAbsolute(fromPasswd) ? fromPasswd : null;
  } catch {
    return null;
  }
}

/** Shells listed in /etc/shells that exist on this machine, de-duplicated by their real path. */
export async function listShells(): Promise<ShellInfo[]> {
  let candidates: string[] = [];
  try {
    const content = await fs.readFile('/etc/shells', 'utf8');
    candidates = content
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.startsWith('/'));
  } catch {
    candidates = [...FALLBACK_SHELLS];
  }
  const login = systemShell();
  if (login) candidates.unshift(login);

  const byRealPath = new Map<string, string>();
  for (const candidate of candidates) {
    if (!(await isExecutableFile(candidate))) continue;
    const real = await fs.realpath(candidate).catch(() => candidate);
    // Prefer the /usr/bin spelling, which is what most distributions document.
    const existing = byRealPath.get(real);
    if (
      !existing ||
      (candidate.startsWith('/usr/bin/') && !existing.startsWith('/usr/bin/'))
    ) {
      byRealPath.set(real, candidate);
    }
  }
  const loginReal = login ? await fs.realpath(login).catch(() => login) : null;
  return [...byRealPath.entries()]
    .map(([real, shellPath]) => ({
      path: shellPath,
      name: path.basename(shellPath),
      isDefault: real === loginReal,
    }))
    .sort(
      (a, b) =>
        Number(b.isDefault) - Number(a.isDefault) ||
        a.name.localeCompare(b.name),
    );
}

export type ShellResolution =
  | { ok: true; shell: string }
  | { ok: false; error: string };

/**
 * Picks the shell to start. An explicitly requested or configured shell must exist: starting a
 * different one silently would hide a broken setting. Only the system default falls back.
 */
export async function resolveShell(
  requested: string | null,
  configured: string | null,
): Promise<ShellResolution> {
  for (const [label, candidate] of [
    ['Requested shell', requested],
    ['Configured default shell', configured],
  ] as const) {
    if (!candidate) continue;
    if (await isExecutableFile(candidate))
      return { ok: true, shell: candidate };
    return {
      ok: false,
      error: `${label} "${candidate}" does not exist or is not executable.`,
    };
  }
  const login = systemShell();
  for (const candidate of [login, ...FALLBACK_SHELLS]) {
    if (candidate && (await isExecutableFile(candidate)))
      return { ok: true, shell: candidate };
  }
  return {
    ok: false,
    error:
      'No usable shell was found. Install bash or set a default shell in Settings.',
  };
}
