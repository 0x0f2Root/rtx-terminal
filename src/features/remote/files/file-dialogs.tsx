import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { ConflictResolution } from '@/shared/remote';

/** A single-field prompt reused for New folder, Rename and Go to path. */
export function PromptDialog({
  open,
  title,
  description,
  label,
  initialValue,
  confirmLabel,
  placeholder,
  onConfirm,
  onOpenChange,
}: {
  open: boolean;
  title: string;
  description?: string;
  label: string;
  initialValue: string;
  confirmLabel: string;
  placeholder?: string;
  onConfirm: (value: string) => void;
  onOpenChange: (open: boolean) => void;
}) {
  const [value, setValue] = useState(initialValue);
  useEffect(() => {
    if (open) setValue(initialValue);
  }, [open, initialValue]);

  const submit = () => {
    const trimmed = value.trim();
    if (!trimmed) return;
    onConfirm(trimmed);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description && <DialogDescription>{description}</DialogDescription>}
        </DialogHeader>
        <div className="flex flex-col gap-2">
          <Label htmlFor="prompt-input">{label}</Label>
          <Input
            id="prompt-input"
            autoFocus
            value={value}
            placeholder={placeholder}
            onChange={(event) => setValue(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') submit();
            }}
          />
        </div>
        <DialogFooter>
          <DialogClose render={<Button variant="outline">Cancel</Button>} />
          <Button onClick={submit} disabled={!value.trim()}>
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Asks how to handle name collisions for a whole transfer batch. Defaults to keeping both, so a
 *  file is never silently overwritten. */
export function ConflictDialog({
  open,
  count,
  onChoose,
  onOpenChange,
}: {
  open: boolean;
  count: number;
  onChoose: (resolution: ConflictResolution) => void;
  onOpenChange: (open: boolean) => void;
}) {
  const choose = (resolution: ConflictResolution) => {
    onChoose(resolution);
    onOpenChange(false);
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            Transfer {count} item{count === 1 ? '' : 's'}
          </DialogTitle>
          <DialogDescription>
            If a file with the same name already exists at the destination, how
            should it be handled?
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-2">
          <Button variant="outline" onClick={() => choose('rename')}>
            Keep both (add a number)
          </Button>
          <Button variant="outline" onClick={() => choose('overwrite')}>
            Overwrite existing files
          </Button>
          <Button variant="outline" onClick={() => choose('skip')}>
            Skip files that already exist
          </Button>
        </div>
        <DialogFooter>
          <DialogClose render={<Button variant="ghost">Cancel</Button>} />
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
