import { useState, type ReactNode } from 'react';
import {
  History,
  ImagePlus,
  Keyboard,
  Palette,
  RotateCcw,
  Settings,
  SquareTerminal,
  Type,
} from 'lucide-react';
import { toast } from 'sonner';
import { ShortcutRecorder } from '@/components/shortcut-recorder';
import { Button } from '@/components/ui/button';
import { IconTile } from '@/components/reui/icon-tile';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldGroup,
  FieldLabel,
  FieldSeparator,
  FieldTitle,
} from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import defaultGlassBackdrop from '../../../assets/glass-backdrop.webp';
import {
  DEFAULT_PREFERENCES,
  type AppThemeId,
  type GlassPreferences,
  type HistoryMode,
  type TerminalPreferences,
} from '@/shared/config';
import {
  clearHistory,
  createGlassWallpaperUrl,
  setGlassWallpaperUrl,
  updatePreferences,
  useAppData,
} from '@/state/app-data';
import { patchUi, useUi, type SettingsSection } from '@/state/ui';
import { ACTIONS, type ActionGroup } from '../actions';
import { FONT_FAMILIES, TERMINAL_THEMES } from '../terminal/themes';

type Section = SettingsSection;

const SECTIONS: { id: Section; label: string; icon: typeof Palette }[] = [
  { id: 'themes', label: 'Themes', icon: Palette },
  { id: 'appearance', label: 'Appearance', icon: Type },
  { id: 'shell', label: 'Shell', icon: SquareTerminal },
  { id: 'keyboard', label: 'Keyboard', icon: Keyboard },
  { id: 'history', label: 'History', icon: History },
];

const SYSTEM_SHELL = '__system';
const CUSTOM_FONT = '__custom';

const APP_THEMES: {
  id: AppThemeId;
  name: string;
  description: string;
}[] = [
  {
    id: 'gray-dark',
    name: 'Gray Dark',
    description: 'The existing rtx-terminal appearance.',
  },
  {
    id: 'full-black',
    name: 'Full Black',
    description: 'Deep black surfaces with clear separation.',
  },
  {
    id: 'light',
    name: 'Light',
    description: 'Neutral light surfaces and readable contrast.',
  },
  {
    id: 'glass',
    name: 'Glass',
    description: 'Warm translucent panels with in-app blur.',
  },
];

function ThemePreview({ theme }: { theme: AppThemeId }) {
  return (
    <div
      aria-hidden="true"
      data-app-theme={theme}
      className="flex h-9 w-12 shrink-0 overflow-hidden border border-border bg-background"
    >
      <span className="w-1.5 shrink-0 border-r border-sidebar-border bg-sidebar" />
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="h-1 border-b border-border bg-chrome" />
        <span
          data-theme-preview-pane
          className="flex min-h-0 flex-1 items-center gap-0.5 px-0.5"
        >
          <span className="h-1 w-2 bg-primary/70" />
          <span className="h-1 w-2 bg-muted-foreground/50" />
        </span>
      </span>
    </div>
  );
}

function ThemesSection() {
  const appTheme = useAppData((s) => s.preferences.ui.theme);
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h3 className="text-sm font-medium">Application appearance</h3>
        <p className="text-sm text-muted-foreground">
          Switch the app theme immediately. Terminal color schemes stay
          independent. Glass blurs in-app panels; the Linux window remains
          opaque.
        </p>
      </div>
      <RadioGroup
        value={appTheme}
        onValueChange={(value) =>
          updatePreferences((p) => ({
            ...p,
            ui: { ...p.ui, theme: value as AppThemeId },
          }))
        }
        className="grid grid-cols-2 gap-2"
        aria-label="App theme"
      >
        {APP_THEMES.map((theme) => (
          <FieldLabel key={theme.id} htmlFor={`theme-${theme.id}`}>
            <Field orientation="horizontal">
              <ThemePreview theme={theme.id} />
              <FieldContent>
                <FieldTitle>{theme.name}</FieldTitle>
                <FieldDescription>{theme.description}</FieldDescription>
              </FieldContent>
              <RadioGroupItem value={theme.id} id={`theme-${theme.id}`} />
            </Field>
          </FieldLabel>
        ))}
      </RadioGroup>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="self-start"
        disabled={appTheme === DEFAULT_PREFERENCES.ui.theme}
        onClick={() =>
          updatePreferences((p) => ({
            ...p,
            ui: { ...p.ui, theme: DEFAULT_PREFERENCES.ui.theme },
          }))
        }
      >
        <RotateCcw data-icon="inline-start" />
        Reset to Gray Dark
      </Button>
      {appTheme === 'glass' && <GlassSection />}
    </div>
  );
}

function setGlass(patch: Partial<GlassPreferences>) {
  updatePreferences((p) => ({
    ...p,
    glass: { ...p.glass, ...patch },
  }));
}

function GlassPreview({
  wallpaperUrl,
  dimming,
}: {
  wallpaperUrl: string | null;
  dimming: number;
}) {
  const image = wallpaperUrl ?? defaultGlassBackdrop;
  return (
    <div
      role="img"
      aria-label="Preview of the Glass menu, sidebar, terminal tab, and panel surfaces"
      className="flex min-h-28 overflow-hidden border border-border"
      style={{
        backgroundImage: `linear-gradient(rgb(0 0 0 / ${dimming / 100}), rgb(0 0 0 / ${dimming / 100})), url("${image}")`,
        backgroundPosition: 'center',
        backgroundSize: 'cover',
      }}
    >
      <div className="flex w-full flex-col">
        <div className="glass-material flex items-center gap-3 border-b border-border bg-chrome px-3 py-2 text-xs text-foreground">
          <span className="font-medium">File</span>
          <span>Edit</span>
          <span>View</span>
          <span className="ml-auto text-muted-foreground">Menu</span>
        </div>
        <div className="flex min-h-20 flex-1">
          <div className="glass-material flex w-28 shrink-0 flex-col gap-2 border-r border-sidebar-border bg-sidebar p-3 text-xs text-sidebar-foreground">
            <span className="font-medium">Sidebar</span>
            <span className="opacity-80">Sessions</span>
            <span className="opacity-80">Saved commands</span>
          </div>
          <div className="flex min-w-0 flex-1 flex-col gap-2 bg-workspace p-3">
            <span className="glass-material flex w-fit items-center border border-border bg-(--tab-active-bg) px-3 py-1 text-xs text-foreground">
              Terminal tab
            </span>
            <div className="glass-material flex min-h-10 flex-1 items-center border border-border bg-card px-3 text-xs text-foreground">
              Glass panel
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function GlassSection() {
  const glass = useAppData((s) => s.preferences.glass);
  const wallpaperUrl = useAppData((s) => s.glassWallpaperUrl);
  const [choosing, setChoosing] = useState(false);
  const tintItems = [
    { value: 'black', label: 'Black' },
    { value: 'neutral', label: 'Neutral gray' },
    { value: 'warm', label: 'Warm tint' },
  ];
  const hasCustomWallpaper = Boolean(glass.wallpaperRef && wallpaperUrl);
  const isDefault =
    JSON.stringify(glass) === JSON.stringify(DEFAULT_PREFERENCES.glass);

  const chooseWallpaper = async () => {
    setChoosing(true);
    try {
      const result = await window.rtx.store.pickGlassWallpaper();
      if (result.status === 'cancelled') return;
      const nextWallpaperUrl = await createGlassWallpaperUrl(result.dataUrl);
      if (!nextWallpaperUrl) {
        await window.rtx.store.discardGlassWallpaper(result.wallpaperRef);
        toast.error('Could not use this image', {
          description: 'Choose a valid PNG, JPG, or WebP image under 12 MB.',
        });
        return;
      }
      setGlassWallpaperUrl(nextWallpaperUrl);
      setGlass({ wallpaperRef: result.wallpaperRef });
    } catch (error) {
      toast.error('Could not load the wallpaper', {
        description: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setChoosing(false);
    }
  };

  const removeWallpaper = () => {
    setGlassWallpaperUrl(null);
    setGlass({ wallpaperRef: null });
  };

  const restoreDefaults = () => {
    setGlassWallpaperUrl(null);
    setGlass(DEFAULT_PREFERENCES.glass);
  };

  return (
    <FieldGroup>
      <FieldSeparator />
      <div className="flex flex-col gap-1">
        <h3 className="text-sm font-medium">Glass appearance</h3>
        <FieldDescription>
          Personalize the image and surfaces. Terminal colors stay independent.
        </FieldDescription>
      </div>
      <GlassPreview wallpaperUrl={wallpaperUrl} dimming={glass.dimming} />
      <Row
        label="Background image"
        description={
          hasCustomWallpaper
            ? 'Custom image saved on this device.'
            : 'Using the built-in landscape.'
        }
      >
        <div className="flex shrink-0 gap-2">
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={choosing}
            onClick={() => void chooseWallpaper()}
          >
            <ImagePlus data-icon="inline-start" />
            {choosing ? 'Choosing…' : 'Change image'}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={!hasCustomWallpaper || choosing}
            onClick={removeWallpaper}
          >
            Remove
          </Button>
        </div>
      </Row>
      <Row label="Blur intensity" description={`${glass.blur} px`}>
        <div className="w-56 shrink-0">
          <Slider
            min={0}
            max={28}
            step={1}
            value={glass.blur}
            aria-label="Glass blur intensity"
            onValueChange={(value) => setGlass({ blur: Number(value) })}
          />
        </div>
      </Row>
      <Row
        label="Panel transparency"
        description={`${glass.transparency}% transparent`}
      >
        <div className="w-56 shrink-0">
          <Slider
            min={20}
            max={55}
            step={1}
            value={glass.transparency}
            aria-label="Glass panel transparency"
            onValueChange={(value) => setGlass({ transparency: Number(value) })}
          />
        </div>
      </Row>
      <Row label="Glass tint">
        <Select
          items={tintItems}
          value={glass.tint}
          onValueChange={(value) =>
            value &&
            setGlass({ tint: String(value) as GlassPreferences['tint'] })
          }
        >
          <SelectTrigger className="w-48" aria-label="Glass tint">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {tintItems.map((item) => (
              <SelectItem key={item.value} value={item.value}>
                {item.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Row>
      <Row label="Image dimming" description={`${glass.dimming}%`}>
        <div className="w-56 shrink-0">
          <Slider
            min={0}
            max={45}
            step={1}
            value={glass.dimming}
            aria-label="Glass image dimming"
            onValueChange={(value) => setGlass({ dimming: Number(value) })}
          />
        </div>
      </Row>
      <div className="flex justify-end">
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={isDefault}
          onClick={restoreDefaults}
        >
          <RotateCcw data-icon="inline-start" />
          Restore default
        </Button>
      </div>
    </FieldGroup>
  );
}

function setTerminal(patch: Partial<TerminalPreferences>) {
  updatePreferences((p) => ({ ...p, terminal: { ...p.terminal, ...patch } }));
}

/** A setting row: label and description on the left, the control on the right. */
function Row({
  label,
  description,
  htmlFor,
  children,
}: {
  label: string;
  description?: string;
  htmlFor?: string;
  children: ReactNode;
}) {
  return (
    <Field orientation="horizontal">
      <FieldContent>
        <FieldLabel htmlFor={htmlFor}>{label}</FieldLabel>
        {description && <FieldDescription>{description}</FieldDescription>}
      </FieldContent>
      {children}
    </Field>
  );
}

function NumberInput({
  id,
  value,
  min,
  max,
  onCommit,
}: {
  id: string;
  value: number;
  min: number;
  max: number;
  onCommit: (value: number) => void;
}) {
  const [draft, setDraft] = useState(String(value));
  const [lastValue, setLastValue] = useState(value);
  if (value !== lastValue) {
    setLastValue(value);
    setDraft(String(value));
  }
  const commit = () => {
    const parsed = Math.round(Number(draft));
    if (Number.isFinite(parsed) && parsed >= min && parsed <= max)
      onCommit(parsed);
    else setDraft(String(value));
  };
  return (
    <Input
      id={id}
      type="number"
      min={min}
      max={max}
      value={draft}
      className="w-28 tabular-nums"
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => e.key === 'Enter' && commit()}
    />
  );
}

function AppearanceSection() {
  const t = useAppData((s) => s.preferences.terminal);
  const knownFont = FONT_FAMILIES.includes(t.fontFamily);
  const [customFont, setCustomFont] = useState(knownFont ? '' : t.fontFamily);
  const fontItems = [
    ...FONT_FAMILIES.map((f) => ({ value: f, label: f })),
    { value: CUSTOM_FONT, label: 'Other installed font…' },
  ];
  const themeItems = TERMINAL_THEMES.map((theme) => ({
    value: theme.id,
    label: theme.name,
  }));
  return (
    <FieldGroup>
      <Row
        label="Terminal color scheme"
        description="Terminal text and background colors, independent of app appearance."
      >
        <Select
          items={themeItems}
          value={t.themeId}
          onValueChange={(value) => setTerminal({ themeId: String(value) })}
        >
          <SelectTrigger className="w-48">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {TERMINAL_THEMES.map((theme) => (
              <SelectItem key={theme.id} value={theme.id}>
                <span
                  className="size-3 rounded-full border"
                  style={{ background: theme.colors.background }}
                />
                {theme.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Row>
      <FieldSeparator />
      <Row
        label="Font"
        description="Nerd Font icons fall back to an installed Nerd Font."
      >
        <div className="flex flex-col items-end gap-2">
          <Select
            items={fontItems}
            value={knownFont ? t.fontFamily : CUSTOM_FONT}
            onValueChange={(value) => {
              if (value !== CUSTOM_FONT)
                setTerminal({ fontFamily: String(value) });
            }}
          >
            <SelectTrigger className="w-56">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {fontItems.map((item) => (
                <SelectItem key={item.value} value={item.value}>
                  {item.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {!knownFont && (
            <Input
              className="w-56"
              value={customFont}
              aria-label="Font family name"
              placeholder="Font family name"
              onChange={(e) => setCustomFont(e.target.value)}
              onBlur={() =>
                customFont.trim() &&
                setTerminal({ fontFamily: customFont.trim() })
              }
            />
          )}
        </div>
      </Row>
      <Row label="Font size" description={`${t.fontSize} px`}>
        <div className="w-56 shrink-0">
          <Slider
            min={8}
            max={32}
            step={1}
            value={t.fontSize}
            aria-label="Font size"
            onValueChange={(value) => setTerminal({ fontSize: Number(value) })}
          />
        </div>
      </Row>
      <Row label="Line height" description={t.lineHeight.toFixed(2)}>
        <div className="w-56 shrink-0">
          <Slider
            min={1}
            max={2}
            step={0.05}
            value={t.lineHeight}
            aria-label="Line height"
            onValueChange={(value) =>
              setTerminal({ lineHeight: Math.round(Number(value) * 100) / 100 })
            }
          />
        </div>
      </Row>
      <FieldSeparator />
      <Row label="Cursor">
        <ToggleGroup
          variant="outline"
          size="sm"
          value={[t.cursorStyle]}
          onValueChange={(value) =>
            value[0] &&
            setTerminal({
              cursorStyle: value[0] as TerminalPreferences['cursorStyle'],
            })
          }
        >
          <ToggleGroupItem value="block">Block</ToggleGroupItem>
          <ToggleGroupItem value="bar">Bar</ToggleGroupItem>
          <ToggleGroupItem value="underline">Underline</ToggleGroupItem>
        </ToggleGroup>
      </Row>
      <Row label="Blinking cursor" htmlFor="cursor-blink">
        <Switch
          id="cursor-blink"
          checked={t.cursorBlink}
          onCheckedChange={(checked) => setTerminal({ cursorBlink: checked })}
        />
      </Row>
      <Row
        label="GPU acceleration"
        description="Draws terminals with WebGL. Turn off if text looks wrong on your graphics driver."
        htmlFor="gpu"
      >
        <Switch
          id="gpu"
          checked={t.gpuAcceleration}
          onCheckedChange={(checked) =>
            setTerminal({ gpuAcceleration: checked })
          }
        />
      </Row>
    </FieldGroup>
  );
}

function ShellSection() {
  const t = useAppData((s) => s.preferences.terminal);
  const shells = useAppData((s) => s.shells);
  const systemDefault = shells.find((s) => s.isDefault);
  const shellItems = [
    {
      value: SYSTEM_SHELL,
      label: `System default${systemDefault ? ` (${systemDefault.name})` : ''}`,
    },
    ...shells.map((s) => ({ value: s.path, label: s.path })),
    ...(t.defaultShell && !shells.some((s) => s.path === t.defaultShell)
      ? [{ value: t.defaultShell, label: t.defaultShell }]
      : []),
  ];
  const [customShell, setCustomShell] = useState('');
  return (
    <FieldGroup>
      <Row
        label="Default shell"
        description="Started in every new terminal unless a saved session chooses another."
      >
        <Select
          items={shellItems}
          value={t.defaultShell ?? SYSTEM_SHELL}
          onValueChange={(value) =>
            setTerminal({
              defaultShell: value === SYSTEM_SHELL ? null : String(value),
            })
          }
        >
          <SelectTrigger className="w-64">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {shellItems.map((item) => (
              <SelectItem key={item.value} value={item.value}>
                {item.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Row>
      <Row
        label="Other shell"
        description="An absolute path to any executable shell."
      >
        <div className="flex items-center gap-2">
          <Input
            className="w-56 font-mono text-xs"
            value={customShell}
            placeholder="/usr/local/bin/fish"
            aria-label="Shell path"
            onChange={(e) => setCustomShell(e.target.value)}
          />
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={!customShell.trim().startsWith('/')}
            onClick={() => {
              setTerminal({ defaultShell: customShell.trim() });
              setCustomShell('');
            }}
          >
            Use
          </Button>
        </div>
      </Row>
      <FieldSeparator />
      <Row
        label="Initial columns"
        description="Size of a new terminal before its pane is measured."
        htmlFor="cols"
      >
        <NumberInput
          id="cols"
          value={t.defaultCols}
          min={20}
          max={500}
          onCommit={(v) => setTerminal({ defaultCols: v })}
        />
      </Row>
      <Row label="Initial rows" htmlFor="rows">
        <NumberInput
          id="rows"
          value={t.defaultRows}
          min={5}
          max={200}
          onCommit={(v) => setTerminal({ defaultRows: v })}
        />
      </Row>
      <Row
        label="Scrollback lines"
        description="Lines kept above the screen in each terminal."
        htmlFor="scrollback"
      >
        <NumberInput
          id="scrollback"
          value={t.scrollback}
          min={0}
          max={100000}
          onCommit={(v) => setTerminal({ scrollback: v })}
        />
      </Row>
      <Row
        label="Copy on select"
        description="Copy text to the clipboard as soon as it is selected."
        htmlFor="copy-select"
      >
        <Switch
          id="copy-select"
          checked={t.copyOnSelect}
          onCheckedChange={(checked) => setTerminal({ copyOnSelect: checked })}
        />
      </Row>
    </FieldGroup>
  );
}

const GROUP_ORDER: ActionGroup[] = [
  'Terminal',
  'Panes',
  'Tabs',
  'Commands',
  'View',
  'App',
];

function KeyboardSection() {
  const overrides = useAppData((s) => s.preferences.shortcuts);
  const setShortcut = (id: string, accelerator: string | null) =>
    updatePreferences((p) => ({
      ...p,
      shortcuts: { ...p.shortcuts, [id]: accelerator },
    }));
  const reset = (id: string) =>
    updatePreferences((p) => {
      const shortcuts = { ...p.shortcuts };
      delete shortcuts[id];
      return { ...p, shortcuts };
    });
  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between gap-4">
        <p className="text-sm text-muted-foreground">
          App shortcuts use Ctrl+Shift so plain Ctrl keys keep reaching the
          shell.
        </p>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={Object.keys(overrides).length === 0}
          onClick={() => updatePreferences((p) => ({ ...p, shortcuts: {} }))}
        >
          <RotateCcw data-icon="inline-start" />
          Reset all
        </Button>
      </div>
      {GROUP_ORDER.map((group) => (
        <FieldGroup key={group} className="gap-3">
          <h3 className="text-sm font-medium">{group}</h3>
          {ACTIONS.filter((a) => a.group === group).map((action) => {
            const overridden = Object.prototype.hasOwnProperty.call(
              overrides,
              action.id,
            );
            const value = overridden
              ? overrides[action.id]
              : action.defaultShortcut;
            return (
              <Field key={action.id} orientation="horizontal">
                <FieldLabel className="font-normal">{action.title}</FieldLabel>
                <div className="flex items-center gap-1">
                  <ShortcutRecorder
                    value={value}
                    ownerId={action.id}
                    onChange={(acc) => setShortcut(action.id, acc)}
                  />
                  {overridden && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      aria-label={`Reset ${action.title}`}
                      onClick={() => reset(action.id)}
                    >
                      <RotateCcw />
                    </Button>
                  )}
                </div>
              </Field>
            );
          })}
        </FieldGroup>
      ))}
    </div>
  );
}

function HistorySection() {
  const history = useAppData((s) => s.preferences.history);
  const count = useAppData((s) => s.history.entries.length);
  const setHistory = (patch: Partial<typeof history>) =>
    updatePreferences((p) => ({ ...p, history: { ...p.history, ...patch } }));
  return (
    <FieldGroup>
      <Row
        label="Record commands"
        description="rtx-terminal only sees what is typed in its own terminals. Your shell's history file is separate and unaffected."
      >
        <ToggleGroup
          variant="outline"
          size="sm"
          value={[history.mode]}
          onValueChange={(value) =>
            value[0] && setHistory({ mode: value[0] as HistoryMode })
          }
        >
          <ToggleGroupItem value="off">Off</ToggleGroupItem>
          <ToggleGroupItem value="memory">This session</ToggleGroupItem>
          <ToggleGroupItem value="persist">Save to disk</ToggleGroupItem>
        </ToggleGroup>
      </Row>
      <FieldDescription>
        Recorded: commands typed with plain editing and echoed by the terminal,
        and saved commands you run. Never recorded: lines edited with arrow keys
        or Tab completion, input that is not echoed (such as passwords),
        anything inside full-screen programs, and lines starting with a space.
        Saved history is stored unencrypted in your config folder.
      </FieldDescription>
      <FieldSeparator />
      <Row
        label="Keep at most"
        description="Older entries are dropped first."
        htmlFor="history-max"
      >
        <NumberInput
          id="history-max"
          value={history.maxEntries}
          min={10}
          max={10000}
          onCommit={(v) => setHistory({ maxEntries: v })}
        />
      </Row>
      <Row
        label="Clear history"
        description={`${count} command${count === 1 ? '' : 's'} recorded.`}
      >
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={count === 0}
          onClick={clearHistory}
        >
          Clear
        </Button>
      </Row>
    </FieldGroup>
  );
}

export function SettingsDialog() {
  const open = useUi((s) => s.settingsOpen);
  // The section lives in UI state so menus can open Settings at a specific page.
  const section = useUi((s) => s.settingsSection);
  const setSection = (id: Section) => patchUi({ settingsSection: id });
  const isDefault = useAppData(
    (s) =>
      JSON.stringify(s.preferences.terminal) ===
      JSON.stringify(DEFAULT_PREFERENCES.terminal),
  );
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => patchUi({ settingsOpen: next })}
    >
      <DialogContent className="flex h-[min(40rem,85vh)] flex-col gap-4 sm:max-w-3xl">
        <DialogHeader className="flex-row items-center gap-3">
          <IconTile variant="elevated" size="default" aria-hidden="true">
            <Settings />
          </IconTile>
          <div className="flex min-w-0 flex-col gap-0.5">
            <DialogTitle>Settings</DialogTitle>
            <DialogDescription>
              Changes apply immediately and are saved to ~/.config/rtx-terminal.
            </DialogDescription>
          </div>
        </DialogHeader>
        <Tabs
          value={section}
          onValueChange={(value) => setSection(value as Section)}
          orientation="vertical"
          className="min-h-0 flex-1 gap-6"
        >
          <div className="flex w-44 shrink-0 flex-col gap-2">
            <TabsList
              variant="line"
              className="w-full"
              aria-label="Settings sections"
            >
              {SECTIONS.map(({ id, label, icon: Icon }) => (
                <TabsTrigger key={id} value={id}>
                  <Icon />
                  {label}
                </TabsTrigger>
              ))}
            </TabsList>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="mt-auto justify-start text-muted-foreground"
              disabled={isDefault}
              onClick={() =>
                updatePreferences((p) => ({
                  ...p,
                  terminal: DEFAULT_PREFERENCES.terminal,
                }))
              }
            >
              <RotateCcw data-icon="inline-start" />
              Reset terminal
            </Button>
          </div>
          <ScrollArea className="min-h-0 min-w-0 flex-1">
            <div className="pr-4 pb-2">
              <TabsContent value="themes">
                <ThemesSection />
              </TabsContent>
              <TabsContent value="appearance">
                <AppearanceSection />
              </TabsContent>
              <TabsContent value="shell">
                <ShellSection />
              </TabsContent>
              <TabsContent value="keyboard">
                <KeyboardSection />
              </TabsContent>
              <TabsContent value="history">
                <HistorySection />
              </TabsContent>
            </div>
          </ScrollArea>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
