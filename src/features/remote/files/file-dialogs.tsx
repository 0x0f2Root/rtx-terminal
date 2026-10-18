import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import type { ConflictResolution } from '@/shared/remote';

/** How many clashing names the dialog lists before it summarizes the rest. */
const LISTED = 5;

/**
 * Asks how name collisions are handled, and only opens when some names are already taken. The
 * safe choice (keep both) is the default action; overwriting is offered but styled as destructive.
 * Files that do not clash transfer either way.
 */
export function ConflictDialog({
  open,
  total,
  conflicts,
  direction,
  onChoose,
  onOpenChange,
}: {
  open: boolean;
  /** Every file in the batch. */
  total: number;
  /** The names that already exist at the destination. */
  conflicts: string[];
  direction: 'upload' | 'download';
  onChoose: (resolution: ConflictResolution) => void;
  onOpenChange: (open: boolean) => void;
}) {
  const choose = (resolution: ConflictResolution) => {
    onChoose(resolution);
    onOpenChange(false);
  };
  const count = conflicts.length;
  const where = direction === 'upload' ? 'on the server' : 'in that folder';
  const summary =
    count === total
      ? `${count === 1 ? 'This file already exists' : `All ${count} files already exist`} ${where}.`
      : `${count} of ${total} files already exist ${where}. The others transfer as they are.`;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {count === 1 ? 'Replace existing file?' : 'Replace existing files?'}
          </DialogTitle>
          <DialogDescription>{summary}</DialogDescription>
        </DialogHeader>
        <ul className="flex flex-col gap-1 font-mono text-xs">
          {conflicts.slice(0, LISTED).map((name) => (
            <li key={name} className="truncate">
              {name}
            </li>
          ))}
          {count > LISTED && (
            <li className="font-sans text-muted-foreground">
              and {count - LISTED} more
            </li>
          )}
        </ul>
        <ul className="flex flex-col gap-1 text-sm text-muted-foreground">
          <li>
            <span className="font-medium text-foreground">Keep both</span> saves
            the new copy as “name (1)”.
          </li>
          <li>
            <span className="font-medium text-foreground">Skip</span> leaves the
            existing file and transfers the rest.
          </li>
          <li>
            <span className="font-medium text-foreground">Overwrite</span>{' '}
            replaces the existing file. This cannot be undone.
          </li>
        </ul>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button variant="destructive" onClick={() => choose('overwrite')}>
            Overwrite
          </Button>
          <Button variant="outline" onClick={() => choose('skip')}>
            Skip
          </Button>
          <Button autoFocus onClick={() => choose('rename')}>
            Keep both
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
