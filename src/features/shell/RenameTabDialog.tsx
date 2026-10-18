import { NameDialog } from '@/components/name-dialog';
import { patchUi, useUi } from '@/state/ui';
import { renameTab, workspace } from '@/state/workspace';

export function RenameTabDialog() {
  const tabId = useUi((s) => s.renameTabId);
  const tab = tabId ? workspace.get().tabs.find((t) => t.id === tabId) : null;
  return (
    <NameDialog
      open={tabId !== null}
      title="Rename tab"
      description="Leave empty to follow the title the shell sets."
      label="Tab name"
      initial={tab?.customTitle ?? ''}
      placeholder="Automatic"
      submitLabel="Rename"
      allowEmpty
      onClose={() => patchUi({ renameTabId: null })}
      onSubmit={(name) => tabId && renameTab(tabId, name || null)}
    />
  );
}
