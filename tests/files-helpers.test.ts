import { describe, expect, it } from 'vitest';
import type { RemoteDirEntry } from '../src/shared/remote';
import {
  baseName,
  breadcrumbs,
  joinPath,
  parentPath,
  sortEntries,
} from '../src/features/remote/files/files-helpers';
import {
  formatBytes,
  formatBytesPerSecond,
  formatDuration,
  formatPercent,
} from '../src/features/remote/format';

function entry(
  name: string,
  type: RemoteDirEntry['type'],
  size = 0,
  mtime: number | null = 0,
): RemoteDirEntry {
  return {
    name,
    type,
    size,
    mtime,
    mode: 0,
    permissions: '',
    uid: 0,
    gid: 0,
    linkTarget: null,
    resolvedType: null,
  };
}

describe('path helpers', () => {
  it('derives parents, joins and base names (POSIX)', () => {
    expect(parentPath('/var/log/syslog')).toBe('/var/log');
    expect(parentPath('/var')).toBe('/');
    expect(parentPath('/')).toBe('/');
    expect(joinPath('/var/log', 'app.log')).toBe('/var/log/app.log');
    expect(joinPath('/', 'etc')).toBe('/etc');
    expect(baseName('/a/b/c.txt')).toBe('c.txt');
    expect(baseName('/a/b/')).toBe('b');
  });

  it('builds breadcrumbs from the root', () => {
    expect(breadcrumbs('/var/log')).toEqual([
      { name: '/', path: '/' },
      { name: 'var', path: '/var' },
      { name: 'log', path: '/var/log' },
    ]);
  });
});

describe('sortEntries', () => {
  const items = [
    entry('zed.txt', 'file', 10, 100),
    entry('alpha', 'directory'),
    entry('beta.txt', 'file', 50, 200),
    entry('mid', 'directory'),
  ];

  it('keeps directories before files regardless of key', () => {
    const sorted = sortEntries(items, 'size', 'desc');
    expect(sorted.slice(0, 2).every((e) => e.type === 'directory')).toBe(true);
  });

  it('sorts files by size ascending and descending', () => {
    const asc = sortEntries(items, 'size', 'asc').filter(
      (e) => e.type === 'file',
    );
    expect(asc.map((e) => e.name)).toEqual(['zed.txt', 'beta.txt']);
    const desc = sortEntries(items, 'size', 'desc').filter(
      (e) => e.type === 'file',
    );
    expect(desc.map((e) => e.name)).toEqual(['beta.txt', 'zed.txt']);
  });

  it('sorts by name within the directory group', () => {
    const dirs = sortEntries(items, 'name', 'asc').filter(
      (e) => e.type === 'directory',
    );
    expect(dirs.map((e) => e.name)).toEqual(['alpha', 'mid']);
  });
});

describe('formatters', () => {
  it('formats bytes in IEC units and marks unknowns', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(1536)).toBe('1.5 KiB');
    expect(formatBytes(null)).toBe('—');
    expect(formatBytesPerSecond(1048576)).toBe('1.0 MiB/s');
  });

  it('formats percentages and durations', () => {
    expect(formatPercent(42.6)).toBe('43%');
    expect(formatPercent(null)).toBe('—');
    expect(formatDuration(3725)).toBe('1h 2m');
    expect(formatDuration(45)).toBe('45s');
  });
});
