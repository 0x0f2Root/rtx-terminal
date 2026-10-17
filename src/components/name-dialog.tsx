import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Field, FieldError, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { LIMITS } from '@/shared/config';

/**
 * The app's one-field prompt: naming a group, renaming a tab, creating a remote folder, renaming a
 * remote file, going to a path. Enter submits through the form; the value is trimmed.
 */
export function NameDialog({
  open,
  title,
  description,
  label,
  initial,
  placeholder,
  submitLabel,
  allowEmpty = false,
  maxLength = LIMITS.name,
  validate,
  onSubmit,
  onClose,
}: {
  open: boolean;
  title: string;
  description: string;
  label: string;
  initial: string;
  placeholder?: string;
  submitLabel: string;
  allowEmpty?: boolean;
  maxLength?: number;
  /** Returns a message to show when the trimmed value is not acceptable. */
  validate?: (value: string) => string | null;
  onSubmit: (value: string) => void;
  onClose: () => void;
}) {
  const [value, setValue] = useState(initial);
  useEffect(() => {
    if (open) setValue(initial);
  }, [open, initial]);
  const trimmed = value.trim();
  const error = trimmed ? (validate?.(trimmed) ?? null) : null;
  const invalid = (!allowEmpty && !trimmed) || error !== null;
  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="sm:max-w-sm">
        <form
          className="flex flex-col gap-6"
          onSubmit={(e) => {
            e.preventDefault();
            if (invalid) return;
            onSubmit(trimmed);
            onClose();
          }}
        >
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription className="wrap-break-word">
              {description}
            </DialogDescription>
          </DialogHeader>
          <Field data-invalid={error !== null}>
            <FieldLabel htmlFor="name-dialog-input">{label}</FieldLabel>
            <Input
              id="name-dialog-input"
              autoFocus
              value={value}
              maxLength={maxLength}
              placeholder={placeholder}
              aria-invalid={error !== null}
              onFocus={(e) => e.target.select()}
              onChange={(e) => setValue(e.target.value)}
            />
            {error && <FieldError>{error}</FieldError>}
          </Field>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={invalid}>
              {submitLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
