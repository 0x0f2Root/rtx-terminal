import {
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent,
} from 'react';
import {
  File as FileIcon,
  FileQuestion,
  FileSymlink,
  Folder,
  FolderSymlink,
  Link2,
} from 'lucide-react';
import {
  type ColumnDef,
  type SortingState,
  useTable,
} from '@tanstack/react-table';
import {
  DataGrid,
  dataGridFeatures,
  type DataGridFeatures,
} from '@/components/reui/data-grid/data-grid';
import { DataGridColumnHeader } from '@/components/reui/data-grid/data-grid-column-header';
import { DataGridScrollArea } from '@/components/reui/data-grid/data-grid-scroll-area';
import { DataGridTableVirtual } from '@/components/reui/data-grid/data-grid-table-virtual';
import type { RemoteDirEntry } from '@/shared/remote';
import { formatBytes, formatDateTime } from '../format';
import { isDirectoryLike } from './files-helpers';

/**
 * The remote listing as a ReUI data-grid. The grid owns rendering, sorting chrome, sticky headers
 * and row virtualization; the file manager owns selection and actions. Row interaction is read
 * through the grid's documented `data-row-id` attribute (the entry name, via getRowId), so one
 * delegated handler serves clicks, double-clicks, the context menu and the keyboard.
 */

/** Dense grid rows are h-8 plus the 1px row border. */
const ROW_HEIGHT = 33;

export function entryKind(entry: RemoteDirEntry): string {
  if (entry.type === 'directory') return 'Folder';
  if (entry.type === 'file') return 'File';
  if (entry.type === 'symlink') {
    if (entry.resolvedType === 'directory') return 'Link to folder';
    if (entry.resolvedType === 'file') return 'Link to file';
    return 'Broken link';
  }
  return 'Special';
}

function EntryIcon({ entry }: { entry: RemoteDirEntry }) {
  if (entry.type === 'directory')
    return <Folder className="size-4 shrink-0 text-primary" />;
  if (entry.type === 'symlink')
    return entry.resolvedType === 'directory' ? (
      <FolderSymlink className="size-4 shrink-0 text-primary" />
    ) : (
      <FileSymlink className="size-4 shrink-0 text-muted-foreground" />
    );
  if (entry.type === 'other')
    return <FileQuestion className="size-4 shrink-0 text-muted-foreground" />;
  return <FileIcon className="size-4 shrink-0 text-muted-foreground" />;
}

const columns: ColumnDef<DataGridFeatures, RemoteDirEntry>[] = [
  {
    id: 'name',
    accessorKey: 'name',
    header: ({ column }) => (
      <DataGridColumnHeader title="Name" column={column} />
    ),
    cell: ({ row }) => {
      const entry = row.original;
      return (
        <span className="flex min-w-0 items-center gap-2">
          <EntryIcon entry={entry} />
          <span className="truncate" title={entry.name}>
            {entry.name}
          </span>
          {entry.type === 'symlink' && (
            <span
              className="flex min-w-0 items-center gap-1 text-xs text-muted-foreground"
              title={entry.linkTarget ?? 'Unreadable link'}
            >
              <Link2 className="size-3 shrink-0" />
              <span className="truncate">{entry.linkTarget ?? '?'}</span>
            </span>
          )}
        </span>
      );
    },
    size: 320,
    minSize: 160,
    meta: { fillWidth: true },
  },
  {
    id: 'size',
    accessorKey: 'size',
    header: ({ column }) => (
      <DataGridColumnHeader title="Size" column={column} />
    ),
    cell: ({ row }) =>
      isDirectoryLike(row.original) ? '—' : formatBytes(row.original.size),
    size: 96,
    meta: {
      headerClassName: 'text-end [&>div]:justify-end',
      cellClassName: 'text-end tabular-nums text-muted-foreground',
    },
  },
  {
    id: 'type',
    accessorKey: 'type',
    header: ({ column }) => (
      <DataGridColumnHeader title="Kind" column={column} />
    ),
    cell: ({ row }) => entryKind(row.original),
    size: 120,
    meta: { cellClassName: 'text-muted-foreground' },
  },
  {
    id: 'permissions',
    accessorKey: 'permissions',
    header: ({ column }) => (
      <DataGridColumnHeader title="Permissions" column={column} />
    ),
    cell: ({ row }) => row.original.permissions,
    size: 112,
    enableSorting: false,
    meta: { cellClassName: 'font-mono text-xs text-muted-foreground' },
  },
  {
    id: 'owner',
    header: ({ column }) => (
      <DataGridColumnHeader title="Owner:Group" column={column} />
    ),
    cell: ({ row }) => `${row.original.uid}:${row.original.gid}`,
    size: 112,
    enableSorting: false,
    meta: {
      headerClassName: 'text-end [&>div]:justify-end',
      cellClassName: 'text-end tabular-nums text-muted-foreground',
    },
  },
  {
    id: 'mtime',
    accessorKey: 'mtime',
    header: ({ column }) => (
      <DataGridColumnHeader title="Modified" column={column} />
    ),
    cell: ({ row }) => formatDateTime(row.original.mtime),
    size: 192,
    meta: { cellClassName: 'tabular-nums text-muted-foreground' },
  },
];

/** The entry name of the grid row an event happened in, or null for the empty area. */
export function rowNameFromEvent(event: {
  target: EventTarget;
}): string | null {
  const row = (event.target as HTMLElement).closest<HTMLElement>(
    'tr[data-row-id]',
  );
  return row?.dataset.rowId ?? null;
}

export type FileTableProps = {
  /** Entries already filtered and sorted by the caller (folders first). */
  entries: RemoteDirEntry[];
  selection: Set<string>;
  sorting: SortingState;
  onSortingChange: (sorting: SortingState) => void;
  loading: boolean;
  /** The row to keep in view, e.g. the keyboard cursor. */
  revealIndex: number | undefined;
  emptyMessage: React.ReactNode;
  onRowMouseDown: (name: string, event: MouseEvent) => void;
  onRowDoubleClick: (name: string) => void;
  onContextMenuTarget: (name: string | null) => void;
  onKeyDown: (event: KeyboardEvent) => void;
};

/**
 * The grid's scroll area sizes to an explicit height, not to a flex parent, so the region's
 * measured height is handed down; the listing then scrolls inside the pane instead of growing it.
 */
function useFillHeight() {
  const ref = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState<number | null>(null);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) =>
      setHeight(Math.floor(entry.contentRect.height)),
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return { ref, height };
}

export function FileTable(props: FileTableProps) {
  const fill = useFillHeight();
  // TanStack v9 row selection lists only selected ids, each mapped to `true`.
  const rowSelection = useMemo(() => {
    const state: Record<string, true> = {};
    for (const name of props.selection) state[name] = true;
    return state;
  }, [props.selection]);

  const table = useTable({
    features: dataGridFeatures,
    columns,
    data: props.entries,
    getRowId: (entry: RemoteDirEntry) => entry.name,
    // The listing is the whole page: render every row, the virtualizer windows them.
    manualPagination: true,
    // Folders stay first in both directions, so the caller sorts; the grid only drives the state.
    manualSorting: true,
    enableRowSelection: true,
    state: { sorting: props.sorting, rowSelection },
    onSortingChange: (updater) =>
      props.onSortingChange(
        typeof updater === 'function' ? updater(props.sorting) : updater,
      ),
  });

  return (
    <div
      ref={fill.ref}
      role="region"
      tabIndex={0}
      aria-label="Remote files"
      className="flex min-h-0 flex-1 flex-col outline-none focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-inset"
      onMouseDown={(event) => {
        // Only presses on a row select; the header (sorting), scrollbars and empty space do not.
        const name = event.button === 0 ? rowNameFromEvent(event) : null;
        if (name) props.onRowMouseDown(name, event);
      }}
      onDoubleClick={(event) => {
        const name = rowNameFromEvent(event);
        if (name) props.onRowDoubleClick(name);
      }}
      onContextMenuCapture={(event) =>
        props.onContextMenuTarget(rowNameFromEvent(event))
      }
      onKeyDown={props.onKeyDown}
    >
      <DataGrid
        table={table}
        recordCount={props.entries.length}
        isLoading={props.loading}
        emptyMessage={props.emptyMessage}
        tableLayout={{
          dense: true,
          headerSticky: true,
          columnsResizable: true,
        }}
        tableClassNames={{
          headerSticky: 'sticky top-0 z-10 bg-muted/90 backdrop-blur-xs',
          bodyRow: 'cursor-default select-none',
        }}
      >
        <DataGridScrollArea
          style={fill.height === null ? undefined : { height: fill.height }}
        >
          <DataGridTableVirtual
            estimateSize={ROW_HEIGHT}
            scrollToRowIndex={props.revealIndex}
          />
        </DataGridScrollArea>
      </DataGrid>
    </div>
  );
}
