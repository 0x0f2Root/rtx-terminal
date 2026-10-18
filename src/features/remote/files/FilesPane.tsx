import { IconTile } from '@/components/reui/icon-tile';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent,
} from 'react';
import type { SortingState } from '@tanstack/react-table';
import {
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  ClipboardCopy,
  CornerUpRight,
  Download,
  FolderOpen,
  FolderPlus,
  Pencil,
  RotateCw,
  Search,
  SquareTerminal,
  Trash2,
  Unplug,
  Upload,
  X,
} from 'lucide-react';
import { toast } from 'sonner';
import { IconButton } from '@/components/icon-button';
import { NameDialog } from '@/components/name-dialog';
import { Badge } from '@/components/reui/badge';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  Breadcrumb,
  BreadcrumbEllipsis,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from '@/components/ui/breadcrumb';
import { Button } from '@/components/ui/button';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuShortcut,
  ContextMenuTrigger,
} from '@/components/ui/context-menu';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty';
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from '@/components/ui/input-group';
import { Separator } from '@/components/ui/separator';
import { Spinner } from '@/components/ui/spinner';
import type {
  ConflictResolution,
  RemoteDirEntry,
  TransferProgress,
} from '@/shared/remote';
import type { RemoteEndpoint, SshConnectState } from '@/shared/api';
import { appData } from '@/state/app-data';
import { closePane } from '@/features/actions';
import { openTab, useWorkspace } from '@/state/workspace';
import { openRemote, useRemotePaneStatus } from '../remote-open';
import { FileTable } from './FileTable';
import { TransferPanel } from './TransferPanel';
import { ConflictDialog } from './file-dialogs';
import {
  breadcrumbs,
  collapseCrumbs,
  entryNameProblem,
  isDirectoryLike,
  joinPath,
  moveCursor,
  parentPath,
  pressSelection,
  sortEntries,
  type CursorMove,
  type Selection,
  type SortKey,
} from './files-helpers';

type ConnState =
  | { status: 'connecting'; progress: SshConnectState | null }
  | {
      status: 'ready';
      connectionId: string;
      remote: RemoteEndpoint;
      label: string;
    }
  | { status: 'error'; error: string }
  | { status: 'disconnected'; reason: string | null };

type TransferSpec = {
  direction: 'upload' | 'download';
  sources: string[];
  destinationDir: string;
};

/** A transfer waiting on the conflict question; `conflicts` are the names already taken. */
type PendingTransfer = TransferSpec & { conflicts: string[] };

const baseName = (p: string) => p.slice(p.lastIndexOf('/') + 1);

const EMPTY_SELECTION: Selection = { selected: new Set(), anchor: null };
const DEFAULT_SORTING: SortingState = [{ id: 'name', desc: false }];
const SORT_KEYS: readonly SortKey[] = ['name', 'size', 'mtime', 'type'];

const CURSOR_KEYS: Record<string, CursorMove> = {
  ArrowUp: 'up',
  ArrowDown: 'down',
  Home: 'home',
  End: 'end',
  PageUp: 'pageUp',
  PageDown: 'pageDown',
};

export function FilesPane({ paneId }: { paneId: string; tabActive: boolean }) {
  const hostId = useWorkspace((s) => s.panes[paneId]?.launch.ssh?.hostId);
  const label = useWorkspace((s) => s.panes[paneId]?.launch.label);

  const [conn, setConn] = useState<ConnState>({
    status: 'connecting',
    progress: null,
  });
  /** Bumped by Reconnect to open a fresh connection for the same host. */
  const [attempt, setAttempt] = useState(0);
  const connectionIdRef = useRef<string | null>(null);
  const [path, setPath] = useState('/');
  const pathRef = useRef(path);
  pathRef.current = path;
  const [entries, setEntries] = useState<RemoteDirEntry[]>([]);
  const [listLoading, setListLoading] = useState(false);
  const [listError, setListError] = useState<string | null>(null);
  const [selection, setSelection] = useState<Selection>(EMPTY_SELECTION);
  const [sorting, setSorting] = useState<SortingState>(DEFAULT_SORTING);
  const [history, setHistory] = useState<{ back: string[]; forward: string[] }>(
    { back: [], forward: [] },
  );
  const [filter, setFilter] = useState('');
  const [transfers, setTransfers] = useState<TransferProgress[]>([]);
  /** The row the context menu was opened on; null for the empty area. */
  const [menuTarget, setMenuTarget] = useState<string | null>(null);

  const [mkdirOpen, setMkdirOpen] = useState(false);
  const [gotoOpen, setGotoOpen] = useState(false);
  const [renameTarget, setRenameTarget] = useState<RemoteDirEntry | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<RemoteDirEntry | null>(null);
  const [pending, setPending] = useState<PendingTransfer | null>(null);

  useRemotePaneStatus(
    paneId,
    conn.status === 'ready'
      ? 'running'
      : conn.status === 'connecting'
        ? 'starting'
        : conn.status === 'error'
          ? 'error'
          : 'exited',
    conn.status === 'error' ? conn.error : null,
  );

  // --- connection lifecycle --------------------------------------------------

  useEffect(() => {
    if (!hostId) {
      setConn({ status: 'error', error: 'This view has no host.' });
      return;
    }
    let disposed = false;
    setConn({ status: 'connecting', progress: null });
    void (async () => {
      const result = await openRemote('files', hostId, {
        onProgress: (progress) =>
          !disposed && setConn({ status: 'connecting', progress }),
        isCancelled: () => disposed,
      });
      if (disposed) {
        if (result.ok) void window.rtx.files.close(result.connectionId);
        return;
      }
      if (!result.ok) {
        setConn({ status: 'error', error: result.error });
        return;
      }
      connectionIdRef.current = result.connectionId;
      setConn({
        status: 'ready',
        connectionId: result.connectionId,
        remote: result.remote,
        label: result.label,
      });
    })();
    return () => {
      disposed = true;
      const id = connectionIdRef.current;
      if (id) void window.rtx.files.close(id);
      connectionIdRef.current = null;
    };
  }, [hostId, attempt]);

  // --- directory loading -----------------------------------------------------

  /** Lists `target`. `select` names an entry to select afterwards (a new folder, a renamed item). */
  const load = useCallback(
    async (target: string, select?: string): Promise<boolean> => {
      const id = connectionIdRef.current;
      if (!id) return false;
      setListLoading(true);
      setListError(null);
      const result = await window.rtx.files.list(id, target);
      if (connectionIdRef.current !== id) return false;
      setListLoading(false);
      if (!result.ok) {
        setListError(result.error);
        return false;
      }
      setEntries(result.listing.entries);
      setPath(result.listing.path);
      setSelection(
        select
          ? { selected: new Set([select]), anchor: select }
          : EMPTY_SELECTION,
      );
      return true;
    },
    [],
  );

  // Route transfer progress and transport-close for this connection only.
  useEffect(() => {
    const offTransfer = window.rtx.files.onTransfer((progress) => {
      if (progress.connectionId !== connectionIdRef.current) return;
      setTransfers((prev) => {
        const index = prev.findIndex((t) => t.id === progress.id);
        if (index === -1) return [progress, ...prev];
        const next = [...prev];
        next[index] = progress;
        return next;
      });
      // An upload that lands in the folder on screen shows up without a manual refresh.
      if (
        progress.direction === 'upload' &&
        progress.status === 'completed' &&
        parentPath(progress.destination) === pathRef.current
      )
        void load(pathRef.current);
    });
    const offClosed = window.rtx.files.onClosed((id, reason) => {
      if (id !== connectionIdRef.current) return;
      connectionIdRef.current = null;
      setConn({ status: 'disconnected', reason });
    });
    return () => {
      offTransfer();
      offClosed();
    };
  }, [load]);

  // The first listing starts at the home directory the server resolves, never an assumed path.
  const readyId = conn.status === 'ready' ? conn.connectionId : null;
  useEffect(() => {
    if (!readyId) return;
    void (async () => {
      const home = await window.rtx.files.home(readyId);
      await load(home.ok ? home.path : '/');
    })();
  }, [readyId, load]);

  const navigate = useCallback(
    async (target: string) => {
      const from = pathRef.current;
      if (await load(target))
        setHistory((h) => ({ back: [...h.back, from], forward: [] }));
    },
    [load],
  );

  const goBack = useCallback(async () => {
    const target = history.back.at(-1);
    if (target === undefined) return;
    const from = pathRef.current;
    if (await load(target))
      setHistory((h) => ({
        back: h.back.slice(0, -1),
        forward: [from, ...h.forward],
      }));
  }, [history.back, load]);

  const goForward = useCallback(async () => {
    const target = history.forward[0];
    if (target === undefined) return;
    const from = pathRef.current;
    if (await load(target))
      setHistory((h) => ({
        back: [...h.back, from],
        forward: h.forward.slice(1),
      }));
  }, [history.forward, load]);

  // --- view ------------------------------------------------------------------

  const visible = useMemo(() => {
    const term = filter.trim().toLowerCase();
    const filtered = term
      ? entries.filter((e) => e.name.toLowerCase().includes(term))
      : entries;
    const active = sorting[0];
    const key: SortKey = SORT_KEYS.includes(active?.id as SortKey)
      ? (active.id as SortKey)
      : 'name';
    return sortEntries(filtered, key, active?.desc ? 'desc' : 'asc');
  }, [entries, filter, sorting]);

  const order = useMemo(() => visible.map((e) => e.name), [visible]);
  const byName = useMemo(
    () => new Map(entries.map((e) => [e.name, e])),
    [entries],
  );
  const cursorIndex =
    selection.anchor !== null ? order.indexOf(selection.anchor) : -1;

  // --- operations ------------------------------------------------------------

  const connectionId = conn.status === 'ready' ? conn.connectionId : null;

  const openEntry = useCallback(
    (name: string) => {
      const entry = byName.get(name);
      if (entry && isDirectoryLike(entry))
        void navigate(joinPath(pathRef.current, entry.name));
    },
    [byName, navigate],
  );

  const doMkdir = useCallback(
    async (name: string) => {
      if (!connectionId) return;
      const result = await window.rtx.files.mkdir(
        connectionId,
        pathRef.current,
        name,
      );
      if (result.ok) void load(pathRef.current, name);
      else
        toast.error('Could not create the folder.', {
          description: result.error,
        });
    },
    [connectionId, load],
  );

  const doRename = useCallback(
    async (name: string) => {
      if (!connectionId || !renameTarget || name === renameTarget.name) return;
      const result = await window.rtx.files.rename(
        connectionId,
        joinPath(pathRef.current, renameTarget.name),
        joinPath(pathRef.current, name),
      );
      if (result.ok) void load(pathRef.current, name);
      else toast.error('Could not rename.', { description: result.error });
    },
    [connectionId, renameTarget, load],
  );

  const doDelete = useCallback(async () => {
    if (!connectionId || !deleteTarget) return;
    // A symbolic link is removed as a file and never followed into its target.
    const kind = deleteTarget.type === 'directory' ? 'directory' : 'file';
    const result = await window.rtx.files.remove(
      connectionId,
      joinPath(pathRef.current, deleteTarget.name),
      kind,
      kind === 'directory',
    );
    setDeleteTarget(null);
    if (result.ok) void load(pathRef.current);
    else toast.error('Could not delete.', { description: result.error });
  }, [connectionId, deleteTarget, load]);

  const runTransfer = useCallback(
    async (spec: TransferSpec, conflict: ConflictResolution) => {
      if (!connectionId) return;
      const result = await window.rtx.files.transfer({
        connectionId,
        conflict,
        ...spec,
      });
      if (!result.ok)
        toast.error('The transfer could not start.', {
          description: result.error,
        });
    },
    [connectionId],
  );

  /**
   * Starts at once when no name is taken, and asks only about real clashes otherwise. "Keep both"
   * is the no-clash choice too: if a name appears in the meantime, nothing is overwritten.
   */
  const queueTransfer = useCallback(
    (spec: TransferSpec, conflicts: string[]) => {
      if (conflicts.length === 0) void runTransfer(spec, 'rename');
      else setPending({ ...spec, conflicts });
    },
    [runTransfer],
  );

  const startUpload = useCallback(async () => {
    const files = await window.rtx.system.pickFiles();
    if (files.length === 0) return;
    // The open folder's listing is the destination, so it already says what is taken.
    queueTransfer(
      { direction: 'upload', sources: files, destinationDir: pathRef.current },
      files.map(baseName).filter((name) => byName.has(name)),
    );
  }, [byName, queueTransfer]);

  /** Downloads exactly `names`, never a stale selection captured earlier. */
  const startDownload = useCallback(
    async (names: string[]) => {
      if (names.length === 0) return;
      const dir = await window.rtx.system.pickDirectory();
      if (!dir) return;
      // If the check fails, claim no clashes rather than invent them: the transfer then keeps
      // both copies of anything that does exist, so nothing is overwritten.
      const taken = await window.rtx.system
        .existingNames(dir, names)
        .catch((): string[] => []);
      queueTransfer(
        {
          direction: 'download',
          sources: names.map((name) => joinPath(pathRef.current, name)),
          destinationDir: dir,
        },
        taken,
      );
    },
    [queueTransfer],
  );

  const copyPath = useCallback((name: string) => {
    void window.rtx.system
      .writeClipboard(joinPath(pathRef.current, name))
      .then(() => toast.success('Path copied.'));
  }, []);

  const openTerminalHere = useCallback(() => {
    if (!hostId) return;
    const host = appData.get().profiles.hosts.find((h) => h.id === hostId);
    openTab({ ssh: { hostId }, label: host?.name ?? label ?? 'SSH' });
  }, [hostId, label]);

  // --- interaction -----------------------------------------------------------

  const onRowMouseDown = useCallback(
    (name: string, event: MouseEvent) => {
      setSelection((current) =>
        pressSelection(order, current, name, {
          shift: event.shiftKey,
          toggle: event.ctrlKey || event.metaKey,
        }),
      );
    },
    [order],
  );

  const onContextMenuTarget = useCallback((name: string | null) => {
    setMenuTarget(name);
    // Right-clicking outside the selection acts on that row alone, as in desktop file managers.
    if (name)
      setSelection((current) =>
        current.selected.has(name)
          ? current
          : { selected: new Set([name]), anchor: name },
      );
  }, []);

  const onGridKeyDown = useCallback(
    (event: KeyboardEvent) => {
      const move = CURSOR_KEYS[event.key];
      if (move && !event.altKey) {
        event.preventDefault();
        const next = moveCursor(order, selection.anchor, move);
        if (next === null) return;
        setSelection((current) =>
          event.shiftKey && current.anchor !== null
            ? {
                ...pressSelection(order, current, next, {
                  shift: true,
                  toggle: false,
                }),
                anchor: next,
              }
            : { selected: new Set([next]), anchor: next },
        );
        return;
      }
      const cursor = selection.anchor ? byName.get(selection.anchor) : null;
      const handled = () => event.preventDefault();
      if (event.key === 'Enter' && cursor) {
        handled();
        openEntry(cursor.name);
      } else if (
        event.key === 'Backspace' ||
        (event.altKey && event.key === 'ArrowUp')
      ) {
        handled();
        if (pathRef.current !== '/') void navigate(parentPath(pathRef.current));
      } else if (event.altKey && event.key === 'ArrowLeft') {
        handled();
        void goBack();
      } else if (event.altKey && event.key === 'ArrowRight') {
        handled();
        void goForward();
      } else if (event.key === 'Delete' && cursor) {
        handled();
        setDeleteTarget(cursor);
      } else if (event.key === 'F2' && cursor) {
        handled();
        setRenameTarget(cursor);
      } else if (event.key === 'F5') {
        handled();
        void load(pathRef.current);
      } else if ((event.ctrlKey || event.metaKey) && event.key === 'a') {
        handled();
        setSelection({ selected: new Set(order), anchor: order[0] ?? null });
      } else if (event.key === 'Escape') {
        handled();
        setSelection(EMPTY_SELECTION);
      }
    },
    [
      order,
      selection.anchor,
      byName,
      openEntry,
      navigate,
      goBack,
      goForward,
      load,
    ],
  );

  // --- render ----------------------------------------------------------------

  const displayName =
    conn.status === 'ready' ? conn.label : (label ?? 'Remote files');

  if (conn.status === 'connecting')
    return (
      <PaneShell>
        <div className="flex flex-1 items-center justify-center gap-2 text-sm text-muted-foreground">
          <Spinner />
          {conn.progress === 'authenticating'
            ? 'Authenticating…'
            : conn.progress === 'connected'
              ? 'Opening SFTP…'
              : `Connecting to ${displayName}…`}
        </div>
      </PaneShell>
    );

  if (conn.status === 'error' || conn.status === 'disconnected')
    return (
      <PaneShell>
        <Empty className="flex-1">
          <EmptyHeader>
            <EmptyMedia>
              <IconTile variant="elevated" size="lg" aria-hidden="true">
                <Unplug />
              </IconTile>
            </EmptyMedia>
            <EmptyTitle>
              {conn.status === 'error'
                ? 'Could not open remote files'
                : 'Disconnected'}
            </EmptyTitle>
            <EmptyDescription>
              {conn.status === 'error'
                ? conn.error
                : (conn.reason ?? 'The connection was closed.')}
            </EmptyDescription>
          </EmptyHeader>
          <EmptyContent className="flex-row justify-center">
            <Button onClick={() => setAttempt((n) => n + 1)}>
              <RotateCw data-icon="inline-start" />
              Reconnect
            </Button>
            <Button variant="outline" onClick={() => closePane(paneId)}>
              Close
            </Button>
          </EmptyContent>
        </Empty>
      </PaneShell>
    );

  const selectedNames = order.filter((name) => selection.selected.has(name));
  const target = menuTarget ? byName.get(menuTarget) : null;
  const crumbs = collapseCrumbs(breadcrumbs(path));

  const emptyMessage = filter.trim() ? (
    <div className="flex flex-col items-center gap-2 py-6 text-sm text-muted-foreground">
      No items match “{filter.trim()}”.
      <Button size="sm" variant="outline" onClick={() => setFilter('')}>
        Clear filter
      </Button>
    </div>
  ) : (
    <div className="flex flex-col items-center gap-2 py-6 text-sm text-muted-foreground">
      This folder is empty.
      <div className="flex gap-2">
        <Button size="sm" variant="outline" onClick={() => void startUpload()}>
          <Upload data-icon="inline-start" />
          Upload files
        </Button>
        <Button size="sm" variant="outline" onClick={() => setMkdirOpen(true)}>
          <FolderPlus data-icon="inline-start" />
          New folder
        </Button>
      </div>
    </div>
  );

  return (
    <PaneShell>
      {/* Toolbar */}
      <div className="flex shrink-0 items-center gap-1 border-b bg-chrome px-2 py-1">
        <IconButton
          label="Back"
          onClick={() => void goBack()}
          disabled={history.back.length === 0}
          accelerator="Alt+ArrowLeft"
        >
          <ArrowLeft />
        </IconButton>
        <IconButton
          label="Forward"
          onClick={() => void goForward()}
          disabled={history.forward.length === 0}
          accelerator="Alt+ArrowRight"
        >
          <ArrowRight />
        </IconButton>
        <IconButton
          label="Parent folder"
          onClick={() => void navigate(parentPath(path))}
          disabled={path === '/'}
          accelerator="Alt+ArrowUp"
        >
          <ArrowUp />
        </IconButton>
        <IconButton
          label="Refresh"
          onClick={() => void load(path)}
          accelerator="F5"
        >
          <RotateCw />
        </IconButton>
        <Separator orientation="vertical" />
        <IconButton label="New folder" onClick={() => setMkdirOpen(true)}>
          <FolderPlus />
        </IconButton>
        <IconButton label="Upload files" onClick={() => void startUpload()}>
          <Upload />
        </IconButton>
        <IconButton
          label="Download selected"
          onClick={() => void startDownload(selectedNames)}
          disabled={selectedNames.length === 0}
        >
          <Download />
        </IconButton>
        <Separator orientation="vertical" />
        <InputGroup className="w-48">
          <InputGroupAddon>
            <Search />
          </InputGroupAddon>
          <InputGroupInput
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Escape') setFilter('');
            }}
            placeholder="Filter this folder"
            aria-label="Filter this folder"
          />
          {filter && (
            <InputGroupAddon align="inline-end">
              <InputGroupButton
                size="icon-xs"
                aria-label="Clear filter"
                onClick={() => setFilter('')}
              >
                <X />
              </InputGroupButton>
            </InputGroupAddon>
          )}
        </InputGroup>
        <div className="ml-auto flex min-w-0 items-center gap-2">
          <span
            className="truncate text-xs text-muted-foreground"
            title={`${conn.remote.username}@${conn.remote.host}:${conn.remote.port}`}
          >
            {conn.remote.username}@{conn.remote.host}
          </span>
          <Badge variant="success-light">Connected</Badge>
          <IconButton
            label="Open a terminal on this host"
            onClick={openTerminalHere}
          >
            <SquareTerminal />
          </IconButton>
        </div>
      </div>

      {/* Location */}
      <div className="flex shrink-0 items-center gap-1 border-b bg-chrome px-2 py-1">
        <Breadcrumb className="min-w-0 flex-1">
          <BreadcrumbList className="flex-nowrap gap-1 text-xs">
            {[
              ...crumbs.head,
              ...(crumbs.hidden.length ? [null] : []),
              ...crumbs.tail,
            ].map((crumb, index, all) => {
              const last = index === all.length - 1;
              return (
                <BreadcrumbItemGroup
                  key={crumb?.path ?? 'overflow'}
                  last={last}
                >
                  {crumb === null ? (
                    <DropdownMenu>
                      <DropdownMenuTrigger
                        render={
                          <Button
                            variant="ghost"
                            size="icon-xs"
                            aria-label="Show hidden path segments"
                          />
                        }
                      >
                        <BreadcrumbEllipsis />
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="start">
                        {crumbs.hidden.map((hidden) => (
                          <DropdownMenuItem
                            key={hidden.path}
                            onClick={() => void navigate(hidden.path)}
                          >
                            {hidden.name}
                          </DropdownMenuItem>
                        ))}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  ) : last ? (
                    <BreadcrumbPage className="truncate" title={crumb.path}>
                      {crumb.name}
                    </BreadcrumbPage>
                  ) : (
                    <BreadcrumbLink
                      className="truncate"
                      title={crumb.path}
                      render={
                        <button
                          type="button"
                          onClick={() => void navigate(crumb.path)}
                        />
                      }
                    >
                      {crumb.name}
                    </BreadcrumbLink>
                  )}
                </BreadcrumbItemGroup>
              );
            })}
          </BreadcrumbList>
        </Breadcrumb>
        <IconButton label="Go to path" onClick={() => setGotoOpen(true)}>
          <CornerUpRight />
        </IconButton>
        {selectedNames.length > 0 && (
          <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
            {selectedNames.length} selected
          </span>
        )}
      </div>

      {listError ? (
        <Empty className="flex-1">
          <EmptyHeader>
            <EmptyMedia>
              <IconTile variant="elevated" size="lg" aria-hidden="true">
                <FolderOpen />
              </IconTile>
            </EmptyMedia>
            <EmptyTitle>This folder could not be opened</EmptyTitle>
            <EmptyDescription>{listError}</EmptyDescription>
          </EmptyHeader>
          <EmptyContent className="flex-row justify-center">
            <Button variant="outline" onClick={() => void load(path)}>
              <RotateCw data-icon="inline-start" />
              Retry
            </Button>
            {path !== '/' && (
              <Button
                variant="outline"
                onClick={() => void navigate(parentPath(path))}
              >
                <ArrowUp data-icon="inline-start" />
                Parent folder
              </Button>
            )}
          </EmptyContent>
        </Empty>
      ) : (
        <ContextMenu>
          <ContextMenuTrigger
            render={<div className="flex min-h-0 flex-1 flex-col" />}
          >
            <FileTable
              entries={visible}
              selection={selection.selected}
              sorting={sorting}
              onSortingChange={setSorting}
              loading={listLoading}
              revealIndex={cursorIndex >= 0 ? cursorIndex : undefined}
              emptyMessage={emptyMessage}
              onRowMouseDown={onRowMouseDown}
              onRowDoubleClick={openEntry}
              onContextMenuTarget={onContextMenuTarget}
              onKeyDown={onGridKeyDown}
            />
          </ContextMenuTrigger>
          <ContextMenuContent className="w-56">
            {target ? (
              <>
                {isDirectoryLike(target) && (
                  <ContextMenuItem onClick={() => openEntry(target.name)}>
                    <FolderOpen />
                    Open
                    <ContextMenuShortcut>Enter</ContextMenuShortcut>
                  </ContextMenuItem>
                )}
                <ContextMenuItem
                  onClick={() =>
                    void startDownload(
                      selection.selected.has(target.name)
                        ? selectedNames
                        : [target.name],
                    )
                  }
                >
                  <Download />
                  {selectedNames.length > 1 &&
                  selection.selected.has(target.name)
                    ? `Download ${selectedNames.length} items…`
                    : 'Download…'}
                </ContextMenuItem>
                <ContextMenuItem onClick={() => copyPath(target.name)}>
                  <ClipboardCopy />
                  Copy path
                </ContextMenuItem>
                <ContextMenuSeparator />
                <ContextMenuItem onClick={() => setRenameTarget(target)}>
                  <Pencil />
                  Rename…
                  <ContextMenuShortcut>F2</ContextMenuShortcut>
                </ContextMenuItem>
                <ContextMenuItem
                  variant="destructive"
                  onClick={() => setDeleteTarget(target)}
                >
                  <Trash2 />
                  Delete…
                  <ContextMenuShortcut>Del</ContextMenuShortcut>
                </ContextMenuItem>
              </>
            ) : (
              <>
                <ContextMenuItem onClick={() => setMkdirOpen(true)}>
                  <FolderPlus />
                  New folder…
                </ContextMenuItem>
                <ContextMenuItem onClick={() => void startUpload()}>
                  <Upload />
                  Upload files…
                </ContextMenuItem>
                <ContextMenuSeparator />
                <ContextMenuItem onClick={() => void load(path)}>
                  <RotateCw />
                  Refresh
                  <ContextMenuShortcut>F5</ContextMenuShortcut>
                </ContextMenuItem>
              </>
            )}
          </ContextMenuContent>
        </ContextMenu>
      )}

      <TransferPanel
        transfers={transfers}
        onCancel={(id) =>
          connectionId && window.rtx.files.cancelTransfer(connectionId, id)
        }
        onRetry={(id) =>
          connectionId && window.rtx.files.retryTransfer(connectionId, id)
        }
        onClear={() =>
          setTransfers((prev) =>
            prev.filter(
              (t) => t.status === 'transferring' || t.status === 'queued',
            ),
          )
        }
      />

      <NameDialog
        open={mkdirOpen}
        title="New folder"
        description={`Create a folder in ${path}`}
        label="Folder name"
        initial=""
        submitLabel="Create"
        maxLength={255}
        validate={(name) => entryNameProblem(name, byName)}
        onSubmit={(name) => void doMkdir(name)}
        onClose={() => setMkdirOpen(false)}
      />
      <NameDialog
        open={renameTarget !== null}
        title="Rename"
        description={renameTarget ? joinPath(path, renameTarget.name) : ''}
        label="New name"
        initial={renameTarget?.name ?? ''}
        submitLabel="Rename"
        maxLength={255}
        validate={(name) => entryNameProblem(name, byName, renameTarget?.name)}
        onSubmit={(name) => void doRename(name)}
        onClose={() => setRenameTarget(null)}
      />
      <NameDialog
        open={gotoOpen}
        title="Go to path"
        description="An absolute path, or one relative to the current folder."
        label="Path"
        placeholder="/var/log"
        initial={path}
        submitLabel="Go"
        maxLength={4096}
        onSubmit={(value) =>
          void navigate(value.startsWith('/') ? value : joinPath(path, value))
        }
        onClose={() => setGotoOpen(false)}
      />
      <ConflictDialog
        open={pending !== null}
        total={pending?.sources.length ?? 0}
        conflicts={pending?.conflicts ?? []}
        direction={pending?.direction ?? 'upload'}
        onChoose={(resolution) => {
          if (!pending) return;
          const { conflicts: _conflicts, ...spec } = pending;
          setPending(null);
          void runTransfer(spec, resolution);
        }}
        onOpenChange={(open) => !open && setPending(null)}
      />

      <AlertDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Delete{' '}
              {deleteTarget?.type === 'directory'
                ? 'this folder and everything in it'
                : deleteTarget?.type === 'symlink'
                  ? 'this link'
                  : 'this file'}
              ?
            </AlertDialogTitle>
            <AlertDialogDescription className="break-all">
              {deleteTarget && joinPath(path, deleteTarget.name)}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <p className="text-sm text-muted-foreground">
            {deleteTarget?.type === 'symlink'
              ? 'Only the link is removed; what it points to is not touched. '
              : ''}
            This cannot be undone.
          </p>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => void doDelete()}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </PaneShell>
  );
}

function BreadcrumbItemGroup({
  last,
  children,
}: {
  last: boolean;
  children: React.ReactNode;
}) {
  return (
    <>
      <BreadcrumbItem className="min-w-0">{children}</BreadcrumbItem>
      {!last && <BreadcrumbSeparator />}
    </>
  );
}

function PaneShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-full min-h-0 flex-col bg-workspace">{children}</div>
  );
}
