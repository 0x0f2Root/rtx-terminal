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

/**
 * Asks how name collisions in a transfer batch are handled, before anything is written. The safe
 * choice (keep both) is the default action; overwriting is offered but styled as destructive.
 */
export function ConflictDialog({
  open,
  count,
  direction,
  onChoose,
  onOpenChange,
}: {
  open: boolean;
  count: number;
  direction: 'upload' | 'download';
  onChoose: (resolution: ConflictResolution) => void;
  onOpenChange: (open: boolean) => void;
}) {
  const choose = (resolution: ConflictResolution) => {
    onChoose(resolution);
    onOpenChange(false);
  };
  const items = `${count} item${count === 1 ? '' : 's'}`;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {direction === 'upload' ? `Upload ${items}` : `Download ${items}`}
          </DialogTitle>
          <DialogDescription>
            {direction === 'upload'
              ? 'When a file with the same name already exists on the server:'
              : 'When a file with the same name already exists in the chosen folder:'}
          </DialogDescription>
        </DialogHeader>
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
