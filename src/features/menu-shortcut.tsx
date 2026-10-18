import { ShortcutKeys } from '@/components/shortcut-keys';
import { ContextMenuShortcut } from '@/components/ui/context-menu';
import { useAppData } from '@/state/app-data';
import { shortcutFor } from './actions';

/** The live shortcut for an action, right-aligned in a context menu item; nothing when unbound. */
export function MenuShortcut({ action }: { action: string }) {
  const accelerator = useAppData((s) =>
    shortcutFor(action, s.preferences.shortcuts),
  );
  return accelerator ? (
    <ContextMenuShortcut>
      <ShortcutKeys accelerator={accelerator} />
    </ContextMenuShortcut>
  ) : null;
}
