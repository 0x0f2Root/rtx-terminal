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

/**
 * A long path keeps its root and its last `tail` segments visible; the middle collapses into an
 * overflow menu so the bar never wraps or pushes the toolbar off-screen.
 */
export function collapseCrumbs(
  crumbs: Crumb[],
  tail = 3,
): { head: Crumb[]; hidden: Crumb[]; tail: Crumb[] } {
  if (crumbs.length <= tail + 2) return { head: crumbs, hidden: [], tail: [] };
  return {
    head: crumbs.slice(0, 1),
    hidden: crumbs.slice(1, crumbs.length - tail),
    tail: crumbs.slice(crumbs.length - tail),
  };
}

/**
 * Why `name` cannot be used for a new or renamed entry in the current folder, or null when it can.
 * Taking an existing name is refused here: some servers rename with POSIX semantics, which would
 * silently replace the other entry.
 */
export function entryNameProblem(
  name: string,
  taken: ReadonlySet<string> | ReadonlyMap<string, unknown>,
  current?: string,
): string | null {
  if (name.includes('/')) return 'A name cannot contain “/”.';
  if (name === '.' || name === '..') return 'That name is reserved.';
  if (name !== current && taken.has(name))
    return 'Something with this name already exists here.';
  return null;
}

export type SortKey = 'name' | 'size' | 'mtime' | 'type';
export type SortDir = 'asc' | 'desc';

/** True for a directory, or a link that resolves to one: both open by navigating into them. */
export function isDirectoryLike(entry: RemoteDirEntry): boolean {
  return (
    entry.type === 'directory' ||
    (entry.type === 'symlink' && entry.resolvedType === 'directory')
  );
}

/** Directories always sort before files; within a group the chosen key and direction apply. */
export function sortEntries(
  entries: RemoteDirEntry[],
  key: SortKey,
  dir: SortDir,
): RemoteDirEntry[] {
  const factor = dir === 'asc' ? 1 : -1;
  const rank = (entry: RemoteDirEntry) => (isDirectoryLike(entry) ? 0 : 1);
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

// --- selection -----------------------------------------------------------------------------

export type Selection = { selected: Set<string>; anchor: string | null };

/**
 * Desktop file-manager selection for a pointer press on `name`: a plain press selects only it,
 * Ctrl (or Cmd) toggles it, Shift selects the range from the anchor in display order.
 */
export function pressSelection(
  order: string[],
  current: Selection,
  name: string,
  modifiers: { shift: boolean; toggle: boolean },
): Selection {
  if (modifiers.shift && current.anchor !== null) {
    const from = order.indexOf(current.anchor);
    const to = order.indexOf(name);
    if (from !== -1 && to !== -1) {
      const [lo, hi] = from < to ? [from, to] : [to, from];
      return {
        selected: new Set(order.slice(lo, hi + 1)),
        anchor: current.anchor,
      };
    }
  }
  if (modifiers.toggle) {
    const selected = new Set(current.selected);
    if (selected.has(name)) selected.delete(name);
    else selected.add(name);
    return { selected, anchor: name };
  }
  return { selected: new Set([name]), anchor: name };
}

export type CursorMove = 'up' | 'down' | 'home' | 'end' | 'pageUp' | 'pageDown';

/** The row the keyboard cursor lands on, clamped to the list. */
export function moveCursor(
  order: string[],
  cursor: string | null,
  move: CursorMove,
  page = 10,
): string | null {
  if (order.length === 0) return null;
  const index = cursor === null ? -1 : order.indexOf(cursor);
  const last = order.length - 1;
  const step: Record<CursorMove, number> = {
    up: index === -1 ? last : index - 1,
    down: index + 1,
    home: 0,
    end: last,
    pageUp: (index === -1 ? 0 : index) - page,
    pageDown: (index === -1 ? 0 : index) + page,
  };
  return order[Math.max(0, Math.min(last, step[move]))];
}
