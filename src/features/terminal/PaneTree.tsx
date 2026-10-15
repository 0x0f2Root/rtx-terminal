import { Fragment } from 'react';
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from '@/components/ui/resizable';
import type { PaneNode } from '@/state/workspace';
import { TerminalPane } from './TerminalPane';

/**
 * Renders a tab's split tree. Panels are keyed by node id, so splitting or closing one pane keeps
 * the others mounted; their terminals and processes are untouched.
 */
export function PaneTree({
  node,
  tabActive,
}: {
  node: PaneNode;
  tabActive: boolean;
}) {
  if (node.kind === 'pane')
    return <TerminalPane paneId={node.id} tabActive={tabActive} />;
  const share = `${100 / node.children.length}%`;
  return (
    <ResizablePanelGroup orientation={node.orientation} id={node.id}>
      {node.children.map((child, index) => (
        <Fragment key={child.id}>
          {index > 0 && <ResizableHandle />}
          <ResizablePanel id={child.id} defaultSize={share} minSize={80}>
            <PaneTree node={child} tabActive={tabActive} />
          </ResizablePanel>
        </Fragment>
      ))}
    </ResizablePanelGroup>
  );
}
