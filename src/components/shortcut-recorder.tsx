import { useEffect, useState } from 'react';
import { Keyboard, X } from 'lucide-react';
import { ShortcutKeys } from '@/components/shortcut-keys';
import { Button } from '@/components/ui/button';
import { eventToAccelerator, shortcutConflict } from '@/lib/accelerator';
import { bindingOwner, suspendShortcuts } from '@/features/shortcuts';

const MODIFIER_KEYS = new Set([
  'Control',
  'Shift',
  'Alt',
  'Meta',
  'AltGraph',
  'CapsLock',
]);

/**
 * Records a key combination. While recording, app shortcuts are paused so the combination is
 * captured instead of triggering its current action. Escape cancels; Backspace clears.
 */
export function ShortcutRecorder({
  value,
  onChange,
  ownerId,
  allowClear = true,
}: {
  value: string | null;
  onChange: (accelerator: string | null) => void;
  /** The action or command being edited, so its own binding is not reported as a conflict. */
  ownerId?: string;
  allowClear?: boolean;
}) {
  const [recording, setRecording] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!recording) return;
    const resume = suspendShortcuts();
    const onKeyDown = (event: KeyboardEvent) => {
      event.preventDefault();
      event.stopPropagation();
      if (MODIFIER_KEYS.has(event.key)) return;
      const hasModifier =
        event.ctrlKey || event.altKey || event.metaKey || event.shiftKey;
      if (event.key === 'Escape' && !hasModifier) {
        setRecording(false);
        return;
      }
      if (event.key === 'Backspace' && !hasModifier && allowClear) {
        onChange(null);
        setError(null);
        setRecording(false);
        return;
      }
      const accelerator = eventToAccelerator(event);
      if (!accelerator) return;
      const conflict = shortcutConflict(accelerator);
      if (conflict) {
        setError(conflict);
        return;
      }
      const owner = bindingOwner(accelerator, ownerId);
      if (owner) {
        setError(`${accelerator} is already used by "${owner}".`);
        return;
      }
      setError(null);
      onChange(accelerator);
      setRecording(false);
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => {
      window.removeEventListener('keydown', onKeyDown, true);
      resume();
    };
  }, [recording, onChange, ownerId, allowClear]);

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          aria-pressed={recording}
          onClick={() => {
            setError(null);
            setRecording((r) => !r);
          }}
          onBlur={() => setRecording(false)}
        >
          <Keyboard data-icon="inline-start" />
          {recording ? (
            'Press keys…'
          ) : value ? (
            <ShortcutKeys accelerator={value} />
          ) : (
            'Record shortcut'
          )}
        </Button>
        {allowClear && value && !recording && (
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label="Remove shortcut"
            onClick={() => onChange(null)}
          >
            <X />
          </Button>
        )}
      </div>
      {recording && !error && (
        <p className="text-xs text-muted-foreground">
          Esc cancels{allowClear ? ', Backspace removes the shortcut' : ''}.
        </p>
      )}
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}
