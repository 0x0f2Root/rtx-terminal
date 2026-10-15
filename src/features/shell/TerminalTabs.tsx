import { Tabs as TabsPrimitive } from '@base-ui/react/tabs';
import { cn } from 'cn';
import { patchUi } from '@/state/ui';
import { activateTab, useWorkspace, type Tab } from '@/state/workspace';
import { closeTab } from '../actions';
import { RAISED, raisedLook, TabLabel, TabShell } from './raised-tab';

function TabItem({ tab, active }: { tab: Tab; active: boolean }) {
  return (
    <TabShell tab={tab} active={active}>
      <TabsPrimitive.Tab
        value={tab.id}
        className={cn(
          RAISED,
          'h-7 max-w-52 min-w-28 pr-7 pl-3',
          raisedLook(tab, active),
        )}
        onAuxClick={(event) => {
          if (event.button === 1) closeTab(tab.id);
        }}
        onDoubleClick={() => patchUi({ renameTabId: tab.id })}
      >
        <TabLabel tab={tab} />
      </TabsPrimitive.Tab>
    </TabShell>
  );
}

export function TerminalTabs() {
  const tabs = useWorkspace((s) => s.tabs);
  const activeTabId = useWorkspace((s) => s.activeTabId);
  if (tabs.length === 0) return null;
  return (
    <TabsPrimitive.Root
      value={activeTabId}
      onValueChange={(value) => activateTab(String(value))}
      className="min-w-0 overflow-x-auto [scrollbar-width:none]"
    >
      {/* Vertical padding keeps the tabs' shadows from being clipped by the scroll container. */}
      <TabsPrimitive.List
        aria-label="Terminal tabs"
        className="flex items-center gap-1.5 px-0.5 py-1.5"
      >
        {tabs.map((tab) => (
          <TabItem key={tab.id} tab={tab} active={tab.id === activeTabId} />
        ))}
      </TabsPrimitive.List>
    </TabsPrimitive.Root>
  );
}
