import { Fragment, lazy, Suspense } from 'react';
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from '@/components/ui/resizable';
import { Spinner } from '@/components/ui/spinner';
import { useWorkspace, type PaneNode } from '@/state/workspace';
import { TerminalPane } from './TerminalPane';

// The remote views pull in recharts and the SFTP UI; load them only when a pane needs one so the
// terminal workspace starts without that weight.
const FilesPane = lazy(() =>
  import('@/features/remote/files/FilesPane').then((m) => ({
    default: m.FilesPane,
  })),
);
const MonitorPane = lazy(() =>
  import('@/features/remote/monitor/MonitorPane').then((m) => ({
    default: m.MonitorPane,
  })),
);

function PaneLoading() {
  return (
    <div className="flex h-full items-center justify-center bg-workspace">
      <Spinner />
    </div>
  );
}

/** Renders one leaf pane as a terminal, remote file manager or resource monitor. */
function LeafPane({
  paneId,
  tabActive,
}: {
  paneId: string;
  tabActive: boolean;
}) {
  const view = useWorkspace((s) => s.panes[paneId]?.launch.view);
  if (view === 'files')
    return (
      <Suspense fallback={<PaneLoading />}>
        <FilesPane paneId={paneId} tabActive={tabActive} />
      </Suspense>
    );
  if (view === 'monitor')
    return (
      <Suspense fallback={<PaneLoading />}>
        <MonitorPane paneId={paneId} tabActive={tabActive} />
      </Suspense>
    );
  return <TerminalPane paneId={paneId} tabActive={tabActive} />;
}

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
    return <LeafPane paneId={node.id} tabActive={tabActive} />;
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
