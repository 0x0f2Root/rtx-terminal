import { Kbd, KbdGroup } from '@/components/ui/kbd';
import { acceleratorKeys } from '@/lib/accelerator';

/** An accelerator such as "Ctrl+Shift+T" printed as key caps. */
export function ShortcutKeys({
  accelerator,
  className,
}: {
  accelerator: string | null;
  className?: string;
}) {
  if (!accelerator) return null;
  return (
    <KbdGroup className={className}>
      {acceleratorKeys(accelerator).map((key, index) => (
        <Kbd key={`${key}-${index}`}>{key}</Kbd>
      ))}
    </KbdGroup>
  );
}
