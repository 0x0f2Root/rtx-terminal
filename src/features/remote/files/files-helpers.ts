import type { RemoteDirEntry } from '@/shared/remote';

/** Remote paths are always POSIX. These helpers never touch the local path module. */

export function parentPath(path: string): string {
  if (path === '/' || path === '') return '/';
  const trimmed = path.endsWith('/') ? path.slice(0, -1) : path;
  const index = trimmed.lastIndexOf('/');
  return index <= 0 ? '/' : trimmed.slice(0, index);
}

export function joinPath(dir: string, name: string): string {
  return dir.endsWith('/') ? `${dir}${name}` : `${dir}/${name}`;
}

export function baseName(path: string): string {
  const trimmed = path.endsWith('/') ? path.slice(0, -1) : path;
  const index = trimmed.lastIndexOf('/');
  return index < 0 ? trimmed : trimmed.slice(index + 1);
}

export type Crumb = { name: string; path: string };

/** The path broken into clickable segments, starting at the root. */
export function breadcrumbs(path: string): Crumb[] {
  const crumbs: Crumb[] = [{ name: '/', path: '/' }];
  const parts = path.split('/').filter(Boolean);
  let acc = '';
  for (const part of parts) {
    acc = `${acc}/${part}`;
    crumbs.push({ name: part, path: acc });
  }
  return crumbs;
}

export type SortKey = 'name' | 'size' | 'mtime' | 'type';
export type SortDir = 'asc' | 'desc';

/** Directories always sort before files; within a group the chosen key and direction apply. */
export function sortEntries(
  entries: RemoteDirEntry[],
  key: SortKey,
  dir: SortDir,
): RemoteDirEntry[] {
  const factor = dir === 'asc' ? 1 : -1;
  const rank = (entry: RemoteDirEntry) =>
    entry.type === 'directory' ||
    (entry.type === 'symlink' && entry.resolvedType === 'directory')
      ? 0
      : 1;
  return [...entries].sort((a, b) => {
    const dirDelta = rank(a) - rank(b);
    if (dirDelta !== 0) return dirDelta;
    let delta = 0;
    if (key === 'name') delta = a.name.localeCompare(b.name);
    else if (key === 'size') delta = a.size - b.size;
    else if (key === 'mtime') delta = (a.mtime ?? 0) - (b.mtime ?? 0);
    else delta = a.type.localeCompare(b.type) || a.name.localeCompare(b.name);
    return delta * factor || a.name.localeCompare(b.name);
  });
}

/** A human label for a filesystem error code, for inline error states. */
export function describeErrorCode(code: string | undefined): string {
  switch (code) {
    case 'permission-denied':
      return 'Permission denied';
    case 'not-found':
      return 'Not found';
    case 'not-a-directory':
      return 'Not a directory';
    case 'disconnected':
      return 'Disconnected';
    case 'no-sftp':
      return 'SFTP is unavailable on this server';
    default:
      return 'Error';
  }
}
