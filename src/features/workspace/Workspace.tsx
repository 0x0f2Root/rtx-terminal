import { IconTile } from '@/components/reui/icon-tile';
import { Plus, SquareTerminal } from 'lucide-react';
import { ShortcutKeys } from '@/components/shortcut-keys';
import { Button } from '@/components/ui/button';
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty';
import { useAppData } from '@/state/app-data';
import { useWorkspace } from '@/state/workspace';
import { newTab, shortcutFor } from '../actions';
import { PaneTree } from '../terminal/PaneTree';

/** Every tab stays mounted; inactive ones are hidden so their terminals keep scrollback and size. */
export function Workspace() {
  const tabs = useWorkspace((s) => s.tabs);
  const activeTabId = useWorkspace((s) => s.activeTabId);
  const newShortcut = useAppData((s) =>
    shortcutFor('terminal.new', s.preferences.shortcuts),
  );

  if (tabs.length === 0) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center bg-workspace">
        <Empty>
          <EmptyHeader>
            <EmptyMedia>
              <IconTile variant="elevated" size="lg" aria-hidden="true">
                <SquareTerminal />
              </IconTile>
            </EmptyMedia>
            <EmptyTitle>No terminals open</EmptyTitle>
            <EmptyDescription>
              Start a shell to get going, or open a saved session from the
              sidebar.
            </EmptyDescription>
          </EmptyHeader>
          <EmptyContent className="items-center">
            <Button onClick={() => newTab()}>
              <Plus data-icon="inline-start" />
              New terminal
            </Button>
            <ShortcutKeys accelerator={newShortcut} />
          </EmptyContent>
        </Empty>
      </div>
    );
  }

  return (
    <div className="relative min-h-0 flex-1 bg-workspace">
      {tabs.map((tab) => (
        <div
          key={tab.id}
          className={
            tab.id === activeTabId
              ? 'absolute inset-0'
              : 'invisible absolute inset-0'
          }
          aria-hidden={tab.id !== activeTabId}
          inert={tab.id !== activeTabId}
        >
          <PaneTree node={tab.root} tabActive={tab.id === activeTabId} />
        </div>
      ))}
    </div>
  );
}
