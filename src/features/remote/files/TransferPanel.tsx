import { ArrowDownToLine, ArrowUpFromLine, RotateCw, X } from 'lucide-react';
import { IconButton } from '@/components/icon-button';
import { Badge, type BadgeProps } from '@/components/reui/badge';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { ScrollArea } from '@/components/ui/scroll-area';
import type { TransferProgress, TransferStatus } from '@/shared/remote';
import { formatBytes, formatBytesPerSecond } from '../format';

const STATUS: Record<
  TransferStatus,
  { label: string; variant: BadgeProps['variant'] }
> = {
  queued: { label: 'Queued', variant: 'secondary' },
  transferring: { label: 'Transferring', variant: 'primary-light' },
  completed: { label: 'Done', variant: 'success-light' },
  skipped: { label: 'Skipped', variant: 'secondary' },
  cancelled: { label: 'Cancelled', variant: 'warning-light' },
  failed: { label: 'Failed', variant: 'destructive-light' },
};

function percent(transfer: TransferProgress): number | null {
  if (transfer.total === null || transfer.total === 0) return null;
  return Math.min(
    100,
    Math.round((transfer.transferred / transfer.total) * 100),
  );
}

function TransferRow({
  transfer,
  onCancel,
  onRetry,
}: {
  transfer: TransferProgress;
  onCancel: (id: string) => void;
  onRetry: (id: string) => void;
}) {
  const pct = percent(transfer);
  const status = STATUS[transfer.status];
  const active =
    transfer.status === 'transferring' || transfer.status === 'queued';
  const Direction =
    transfer.direction === 'upload' ? ArrowUpFromLine : ArrowDownToLine;
  return (
    <div className="flex flex-col gap-1.5 px-3 py-2">
      <div className="flex items-center gap-2">
        <Direction
          className="size-4 shrink-0 text-muted-foreground"
          aria-label={transfer.direction === 'upload' ? 'Upload' : 'Download'}
        />
        <span
          className="min-w-0 flex-1 truncate text-sm"
          title={`${transfer.source} → ${transfer.destination}`}
        >
          {transfer.name}
        </span>
        <Badge variant={status.variant}>{status.label}</Badge>
        {active ? (
          <IconButton
            label="Cancel transfer"
            onClick={() => onCancel(transfer.id)}
          >
            <X />
          </IconButton>
        ) : transfer.status === 'failed' || transfer.status === 'cancelled' ? (
          <IconButton
            label="Retry transfer"
            onClick={() => onRetry(transfer.id)}
          >
            <RotateCw />
          </IconButton>
        ) : null}
      </div>
      {transfer.status === 'transferring' && (
        <Progress
          value={pct}
          aria-label={`${transfer.direction === 'upload' ? 'Uploading' : 'Downloading'} ${transfer.name}`}
        />
      )}
      <div className="flex items-center justify-between gap-3 text-xs text-muted-foreground tabular-nums">
        <span className="shrink-0">
          {formatBytes(transfer.transferred)}
          {transfer.total !== null ? ` of ${formatBytes(transfer.total)}` : ''}
          {transfer.status === 'transferring' && pct !== null
            ? ` · ${pct}%`
            : ''}
        </span>
        {transfer.status === 'failed' && transfer.error ? (
          <span className="truncate text-destructive" title={transfer.error}>
            {transfer.error}
          </span>
        ) : transfer.status === 'transferring' &&
          transfer.bytesPerSecond !== null ? (
          <span>{formatBytesPerSecond(transfer.bytesPerSecond)}</span>
        ) : null}
      </div>
    </div>
  );
}

/** The transfer queue for one file view, docked under the listing while it has entries. */
export function TransferPanel({
  transfers,
  onCancel,
  onRetry,
  onClear,
}: {
  transfers: TransferProgress[];
  onCancel: (id: string) => void;
  onRetry: (id: string) => void;
  onClear: () => void;
}) {
  if (transfers.length === 0) return null;
  const active = transfers.filter(
    (t) => t.status === 'transferring' || t.status === 'queued',
  ).length;
  return (
    <section
      aria-label="Transfers"
      className="flex max-h-56 shrink-0 flex-col border-t bg-chrome"
    >
      <div className="flex items-center gap-2 px-3 py-1">
        <span className="text-xs font-medium">Transfers</span>
        {active > 0 && <Badge variant="primary-light">{active} active</Badge>}
        <Button
          size="sm"
          variant="ghost"
          className="ml-auto"
          onClick={onClear}
          disabled={active === transfers.length}
        >
          Clear finished
        </Button>
      </div>
      <ScrollArea className="min-h-0 flex-1">
        <div className="flex flex-col divide-y divide-border/50">
          {transfers.map((transfer) => (
            <TransferRow
              key={transfer.id}
              transfer={transfer}
              onCancel={onCancel}
              onRetry={onRetry}
            />
          ))}
        </div>
      </ScrollArea>
    </section>
  );
}
