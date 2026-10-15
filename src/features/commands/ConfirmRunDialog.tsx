import { TriangleAlert } from 'lucide-react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogMedia,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { patchUi, useUi } from '@/state/ui';
import { tabTitle, tabForPane, workspace } from '@/state/workspace';
import { confirmPendingRun, insertCommand } from '../actions';

/** Shown before the app runs a command that looks destructive. Inserting is offered as the safe path. */
export function ConfirmRunDialog() {
  const pending = useUi((s) => s.pendingRun);
  const tab = pending ? tabForPane(pending.paneId) : null;
  const target = tab ? tabTitle(tab, workspace.get()) : 'the active terminal';
  return (
    <AlertDialog
      open={pending !== null}
      onOpenChange={(open) => !open && patchUi({ pendingRun: null })}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogMedia>
            <TriangleAlert />
          </AlertDialogMedia>
          <AlertDialogTitle>Run this command?</AlertDialogTitle>
          <AlertDialogDescription>
            It {pending?.reason}. It will run in “{target}” as soon as you
            confirm.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <pre className="max-h-40 overflow-auto rounded-md bg-muted p-3 font-mono text-xs whitespace-pre-wrap break-all select-text">
          {pending?.command}
        </pre>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <Button
            variant="outline"
            onClick={() => {
              if (pending) insertCommand(pending.command, pending.paneId);
              patchUi({ pendingRun: null });
            }}
          >
            Insert without running
          </Button>
          <AlertDialogAction variant="destructive" onClick={confirmPendingRun}>
            Run command
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
