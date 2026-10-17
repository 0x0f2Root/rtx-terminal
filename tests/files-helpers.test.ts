import { describe, expect, it } from 'vitest';
import type { RemoteDirEntry } from '../src/shared/remote';
import {
  baseName,
  breadcrumbs,
  collapseCrumbs,
  entryNameProblem,
  isDirectoryLike,
  joinPath,
  moveCursor,
  parentPath,
  pressSelection,
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

describe('collapseCrumbs', () => {
  it('keeps short paths whole', () => {
    const result = collapseCrumbs(breadcrumbs('/var/log'));
    expect(result.hidden).toEqual([]);
    expect(result.head.map((c) => c.name)).toEqual(['/', 'var', 'log']);
  });

  it('keeps the root and the last segments of a deep path, hiding the middle', () => {
    const result = collapseCrumbs(breadcrumbs('/a/b/c/d/e/f'), 3);
    expect(result.head.map((c) => c.path)).toEqual(['/']);
    expect(result.hidden.map((c) => c.path)).toEqual(['/a', '/a/b', '/a/b/c']);
    expect(result.tail.map((c) => c.path)).toEqual([
      '/a/b/c/d',
      '/a/b/c/d/e',
      '/a/b/c/d/e/f',
    ]);
  });
});

describe('entry classification and names', () => {
  it('treats links to folders like folders', () => {
    const link = {
      ...entry('l', 'symlink'),
      resolvedType: 'directory' as const,
    };
    const broken = { ...entry('b', 'symlink'), resolvedType: null };
    expect(isDirectoryLike(entry('d', 'directory'))).toBe(true);
    expect(isDirectoryLike(link)).toBe(true);
    expect(isDirectoryLike(broken)).toBe(false);
    expect(isDirectoryLike(entry('f', 'file'))).toBe(false);
  });

  it('refuses separators, reserved names and names already taken', () => {
    const taken = new Set(['report.txt', 'logs']);
    expect(entryNameProblem('a/b', taken)).toMatch(/cannot contain/);
    expect(entryNameProblem('..', taken)).toMatch(/reserved/);
    expect(entryNameProblem('logs', taken)).toMatch(/already exists/);
    expect(entryNameProblem('new folder', taken)).toBeNull();
    // Renaming an entry to its own name is not a conflict.
    expect(entryNameProblem('logs', taken, 'logs')).toBeNull();
  });
});

describe('pressSelection', () => {
  const order = ['a', 'b', 'c', 'd', 'e'];
  const none = { selected: new Set<string>(), anchor: null };

  it('selects only the pressed row on a plain press', () => {
    const next = pressSelection(
      order,
      { selected: new Set(['a', 'b']), anchor: 'a' },
      'd',
      {
        shift: false,
        toggle: false,
      },
    );
    expect([...next.selected]).toEqual(['d']);
    expect(next.anchor).toBe('d');
  });

  it('toggles a row with Ctrl without touching the others', () => {
    const one = pressSelection(order, none, 'b', {
      shift: false,
      toggle: true,
    });
    const two = pressSelection(order, one, 'd', { shift: false, toggle: true });
    expect([...two.selected].sort()).toEqual(['b', 'd']);
    const off = pressSelection(order, two, 'b', { shift: false, toggle: true });
    expect([...off.selected]).toEqual(['d']);
  });

  it('selects the range from the anchor with Shift, in display order, in either direction', () => {
    const anchored = { selected: new Set(['b']), anchor: 'b' };
    expect([
      ...pressSelection(order, anchored, 'd', { shift: true, toggle: false })
        .selected,
    ]).toEqual(['b', 'c', 'd']);
    const anchoredLow = { selected: new Set(['d']), anchor: 'd' };
    expect([
      ...pressSelection(order, anchoredLow, 'a', { shift: true, toggle: false })
        .selected,
    ]).toEqual(['a', 'b', 'c', 'd']);
  });
});

describe('moveCursor', () => {
  const order = ['a', 'b', 'c', 'd', 'e'];

  it('steps and clamps at the ends', () => {
    expect(moveCursor(order, 'b', 'down')).toBe('c');
    expect(moveCursor(order, 'e', 'down')).toBe('e');
    expect(moveCursor(order, 'a', 'up')).toBe('a');
    expect(moveCursor(order, 'c', 'home')).toBe('a');
    expect(moveCursor(order, 'c', 'end')).toBe('e');
    expect(moveCursor(order, 'a', 'pageDown', 3)).toBe('d');
  });

  it('starts at the first row going down and the last going up', () => {
    expect(moveCursor(order, null, 'down')).toBe('a');
    expect(moveCursor(order, null, 'up')).toBe('e');
    expect(moveCursor([], null, 'down')).toBeNull();
  });
});
