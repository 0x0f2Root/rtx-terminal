import { useMemo, useState } from 'react';
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
import type { ProcessMetric } from '@/shared/remote';
import { formatBytes, formatDuration } from '../format';

const NUMERIC = {
  headerClassName: 'text-end [&>div]:justify-end',
  cellClassName: 'text-end tabular-nums',
};

const columns: ColumnDef<DataGridFeatures, ProcessMetric>[] = [
  {
    id: 'pid',
    accessorKey: 'pid',
    header: ({ column }) => (
      <DataGridColumnHeader title="PID" column={column} />
    ),
    size: 80,
    meta: {
      ...NUMERIC,
      cellClassName: `${NUMERIC.cellClassName} text-muted-foreground`,
    },
  },
  {
    id: 'user',
    accessorKey: 'user',
    header: ({ column }) => (
      <DataGridColumnHeader title="User" column={column} />
    ),
    size: 104,
    meta: { cellClassName: 'text-muted-foreground' },
  },
  {
    // ps reports CPU time over the process lifetime, so this is an average, not current load.
    id: 'cpu',
    accessorKey: 'cpu',
    header: ({ column }) => (
      <DataGridColumnHeader title="Avg CPU %" column={column} />
    ),
    cell: ({ row }) => row.original.cpu.toFixed(1),
    size: 104,
    sortDescFirst: true,
    meta: NUMERIC,
  },
  {
    id: 'memoryPercent',
    accessorKey: 'memoryPercent',
    header: ({ column }) => (
      <DataGridColumnHeader title="Mem %" column={column} />
    ),
    cell: ({ row }) => row.original.memoryPercent.toFixed(1),
    size: 88,
    sortDescFirst: true,
    meta: NUMERIC,
  },
  {
    id: 'rss',
    accessorKey: 'rss',
    header: ({ column }) => (
      <DataGridColumnHeader title="Resident" column={column} />
    ),
    cell: ({ row }) => formatBytes(row.original.rss),
    size: 104,
    sortDescFirst: true,
    meta: {
      ...NUMERIC,
      cellClassName: `${NUMERIC.cellClassName} text-muted-foreground`,
    },
  },
  {
    id: 'state',
    accessorKey: 'state',
    header: ({ column }) => (
      <DataGridColumnHeader title="State" column={column} />
    ),
    size: 72,
    meta: { cellClassName: 'font-mono text-xs text-muted-foreground' },
  },
  {
    id: 'elapsedSeconds',
    accessorKey: 'elapsedSeconds',
    header: ({ column }) => (
      <DataGridColumnHeader title="Running" column={column} />
    ),
    cell: ({ row }) => formatDuration(row.original.elapsedSeconds),
    size: 96,
    sortDescFirst: true,
    meta: {
      ...NUMERIC,
      cellClassName: `${NUMERIC.cellClassName} text-muted-foreground`,
    },
  },
  {
    id: 'name',
    accessorKey: 'name',
    header: ({ column }) => (
      <DataGridColumnHeader title="Command" column={column} />
    ),
    cell: ({ row }) => (
      <span className="truncate" title={row.original.name}>
        {row.original.name}
      </span>
    ),
    size: 240,
    minSize: 160,
    meta: { fillWidth: true },
  },
];

/** The remote process list as a virtualized ReUI data-grid; every row renders on demand. */
export function ProcessTable({
  processes,
  selectedPid,
  onSelect,
  emptyMessage,
}: {
  /** Already filtered by the caller. */
  processes: ProcessMetric[];
  selectedPid: number | null;
  onSelect: (pid: number) => void;
  emptyMessage: React.ReactNode;
}) {
  const [sorting, setSorting] = useState<SortingState>([
    { id: 'cpu', desc: true },
  ]);
  const rowSelection = useMemo(() => {
    const state: Record<string, true> = {};
    if (selectedPid !== null) state[String(selectedPid)] = true;
    return state;
  }, [selectedPid]);

  const table = useTable({
    features: dataGridFeatures,
    columns,
    data: processes,
    getRowId: (process: ProcessMetric) => String(process.pid),
    manualPagination: true,
    enableRowSelection: true,
    state: { sorting, rowSelection },
    onSortingChange: setSorting,
  });

  return (
    <DataGrid
      table={table}
      recordCount={processes.length}
      emptyMessage={emptyMessage}
      onRowClick={(process) => onSelect(process.pid)}
      tableLayout={{ dense: true, headerSticky: true, columnsResizable: true }}
      tableClassNames={{
        headerSticky: 'sticky top-0 z-10 bg-muted/90 backdrop-blur-xs',
        bodyRow: 'cursor-default',
      }}
    >
      <DataGridScrollArea className="h-96">
        <DataGridTableVirtual estimateSize={33} />
      </DataGridScrollArea>
    </DataGrid>
  );
}
