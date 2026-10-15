import { useEffect, useState } from 'react';
import { ShieldAlert, ShieldQuestion } from 'lucide-react';
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogMedia,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Field, FieldLabel } from '@/components/ui/field';
import { Switch } from '@/components/ui/switch';
import { answerHostKey, useSshPrompts } from './ssh-prompts';

function Fact({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="font-mono text-xs break-all select-text">
        {children}
      </span>
    </div>
  );
}

/**
 * The trust decision for a server's host key. Unknown keys need an explicit yes. Changed keys
 * are blocked by default: replacing the saved key requires confirming the new fingerprint was
 * verified, because a changed key is what a man-in-the-middle attack looks like.
 */
export function HostKeyDialog() {
  const prompt = useSshPrompts((s) => s.hostKeys[0] ?? null);
  const [verified, setVerified] = useState(false);

  useEffect(() => setVerified(false), [prompt?.promptId]);

  if (!prompt) return null;
  const changed = prompt.status === 'changed';
  const where =
    prompt.port === 22 ? prompt.host : `${prompt.host}:${prompt.port}`;

  return (
    <AlertDialog
      open
      onOpenChange={(open) => {
        if (!open) answerHostKey(prompt.promptId, false);
      }}
    >
      <AlertDialogContent className="sm:max-w-lg">
        <AlertDialogHeader>
          <AlertDialogMedia
            className={changed ? 'text-destructive' : undefined}
          >
            {changed ? <ShieldAlert /> : <ShieldQuestion />}
          </AlertDialogMedia>
          <AlertDialogTitle>
            {changed
              ? 'Host key changed: connection blocked'
              : `Trust ${where}?`}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {changed
              ? `The key ${where} presented does not match the one saved${
                  prompt.source === 'user' ? ' in ~/.ssh/known_hosts' : ''
                }. The server may have been reinstalled, or someone may be intercepting the connection.`
              : `rtx-terminal has not connected to ${where} before. Compare this fingerprint with one obtained from the server's administrator or by running "ssh-keygen -lf" on the server.`}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <div className="flex flex-col gap-3 rounded-md bg-muted p-3">
          <Fact label="Host">{`${prompt.hostLabel} · ${where}`}</Fact>
          <Fact label={`Presented ${prompt.keyType} key`}>
            {prompt.fingerprint}
          </Fact>
          {changed &&
            prompt.knownFingerprints.map((fp) => (
              <Fact key={fp} label="Expected (saved) key">
                {fp}
              </Fact>
            ))}
        </div>
        {changed && (
          <Field orientation="horizontal">
            <FieldLabel htmlFor="host-key-verified" className="font-normal">
              I verified the new fingerprint with the server's owner
            </FieldLabel>
            <Switch
              id="host-key-verified"
              checked={verified}
              onCheckedChange={setVerified}
            />
          </Field>
        )}
        <AlertDialogFooter>
          <AlertDialogCancel autoFocus>
            {changed ? 'Keep blocked' : 'Cancel'}
          </AlertDialogCancel>
          <Button
            type="button"
            variant={changed ? 'destructive' : 'default'}
            disabled={changed && !verified}
            onClick={() => answerHostKey(prompt.promptId, true)}
          >
            {changed ? 'Replace saved key and connect' : 'Trust and connect'}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
