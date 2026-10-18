import {
  Terminal,
  type IDisposable,
  type ITerminalOptions,
} from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { SearchAddon, type ISearchOptions } from '@xterm/addon-search';
import { Unicode11Addon } from '@xterm/addon-unicode11';
import { WebLinksAddon } from '@xterm/addon-web-links';
import type { WebglAddon } from '@xterm/addon-webgl';
import type {
  CreateSessionResult,
  SessionExit,
  SessionInfo,
  SshConnectState,
} from '@/shared/api';
import type { AppThemeId, TerminalPreferences } from '@/shared/config';
import { hexToRgb, luminance } from '@/lib/color';
import { appData, recordHistory } from '@/state/app-data';
import { patchSearch, ui } from '@/state/ui';
import { updatePane, workspace } from '@/state/workspace';
import { newId } from '@/lib/ids';
import {
  askCredential,
  dropPromptsFor,
  refreshSecretState,
} from '../ssh/ssh-prompts';
import { terminalColors } from './themes';

const SEARCH_DECORATIONS = {
  matchBackground: '#6ea8ff33',
  matchOverviewRuler: '#6ea8ff88',
  activeMatchBackground: '#e6c07b66',
  activeMatchColorOverviewRuler: '#e6c07b',
} as const;

// oxlint-disable-next-line no-control-regex -- bracketed paste markers are escape sequences by definition
const BRACKETED_PASTE = /\x1b\[200~([\s\S]*?)\x1b\[201~/g;

/**
 * The chosen family first, then Nerd Font families for prompt icons (powerline, devicons) when
 * they are installed, then the bundled JetBrains Mono. Missing families are skipped by the browser.
 */
const ICON_FALLBACKS = [
  'Symbols Nerd Font Mono',
  'JetBrainsMono Nerd Font Mono',
  'JetBrainsMono Nerd Font',
  'FiraCode Nerd Font Mono',
];

function fontStack(family: string): string {
  const families = [
    family,
    ...ICON_FALLBACKS,
    'JetBrains Mono Variable',
  ].filter((f, i, all) => all.indexOf(f) === i);
  return `${families.map((f) => `"${f.replaceAll('"', '')}"`).join(', ')}, monospace`;
}

function terminalOptions(
  prefs: TerminalPreferences,
  appTheme: AppThemeId,
): ITerminalOptions {
  const colors = terminalColors(prefs.themeId, appTheme);
  const rgb = hexToRgb(colors.background ?? '#0c0d10');
  const scrollbar =
    rgb !== null && luminance(rgb) > 0.5 ? '0, 0, 0' : '255, 255, 255';
  return {
    // xterm locks this option when opened. Keep the renderer alpha-capable so an existing session
    // can become transparent when Glass is selected; other themes still use opaque backgrounds.
    allowTransparency: true,
    fontFamily: fontStack(prefs.fontFamily),
    fontSize: prefs.fontSize,
    lineHeight: prefs.lineHeight,
    cursorStyle: prefs.cursorStyle,
    cursorBlink: prefs.cursorBlink,
    scrollback: prefs.scrollback,
    theme: {
      ...colors,
      scrollbarSliderBackground: `rgba(${scrollbar}, 0.18)`,
      scrollbarSliderHoverBackground: `rgba(${scrollbar}, 0.3)`,
      scrollbarSliderActiveBackground: `rgba(${scrollbar}, 0.42)`,
    },
  };
}

export type SessionSink = {
  bind(sessionId: string, controller: TerminalController): void;
  unbind(sessionId: string): void;
};

/**
 * One pane's terminal. xterm.js renders into `host`, a div that outlives React re-renders: panes
 * move between split containers without losing scrollback or restarting their process.
 */
export class TerminalController {
  readonly host: HTMLDivElement;
  readonly term: Terminal;
  private readonly fitAddon = new FitAddon();
  private readonly searchAddon = new SearchAddon({ highlightLimit: 2000 });
  private webgl: WebglAddon | null = null;
  private readonly disposables: IDisposable[] = [];
  private readonly resizeObserver: ResizeObserver;
  private fitFrame = 0;
  private ptyResizeTimer: ReturnType<typeof setTimeout> | null = null;
  private dprQuery: MediaQueryList | null = null;
  private opened = false;
  private starting = false;
  private sshRequestId: string | null = null;
  private disposed = false;
  private sessionId: string | null = null;
  private applied: TerminalPreferences;
  private appliedAppTheme: AppThemeId;
  /** Typed characters since the last Enter, used to observe commands for history. */
  private line = '';
  private lineReliable = true;
  private suppressTracking = false;

  constructor(
    readonly paneId: string,
    private readonly sink: SessionSink,
  ) {
    const prefs = appData.get().preferences.terminal;
    const appTheme = appData.get().preferences.ui.theme;
    this.applied = prefs;
    this.appliedAppTheme = appTheme;
    this.host = document.createElement('div');
    this.host.className = 'rtx-terminal h-full w-full';
    this.term = new Terminal({
      ...terminalOptions(prefs, appTheme),
      allowProposedApi: true,
      cursorInactiveStyle: 'outline',
      drawBoldTextInBrightColors: true,
      rescaleOverlappingGlyphs: true,
      scrollOnUserInput: true,
    });
    this.term.loadAddon(this.fitAddon);
    this.term.loadAddon(this.searchAddon);
    this.term.loadAddon(new Unicode11Addon());
    this.term.unicode.activeVersion = '11';
    // Links open in the system browser on Ctrl+click so a stray click never leaves the app.
    this.term.loadAddon(
      new WebLinksAddon((event, uri) => {
        if (event.ctrlKey || event.metaKey)
          void window.rtx.system.openExternal(uri);
      }),
    );

    this.disposables.push(
      this.term.onData((data) => this.handleInput(data)),
      this.term.onBinary(
        (data) =>
          this.sessionId && window.rtx.terminal.write(this.sessionId, data),
      ),
      this.term.onResize(() => this.schedulePtyResize()),
      this.term.onTitleChange((title) =>
        updatePane(this.paneId, { title: title.slice(0, 120) || null }),
      ),
      this.term.onSelectionChange(() => {
        if (
          appData.get().preferences.terminal.copyOnSelect &&
          this.term.hasSelection()
        ) {
          void window.rtx.system.writeClipboard(this.term.getSelection());
        }
      }),
      this.searchAddon.onDidChangeResults(({ resultIndex, resultCount }) => {
        if (ui.get().search.paneId === this.paneId)
          patchSearch({ resultIndex, resultCount });
      }),
    );
    this.resizeObserver = new ResizeObserver(() => this.scheduleFit());
    // Cell metrics change when a web font finishes loading or the screen scale changes, and
    // neither resizes the host, so the observer alone would leave the grid measured wrong.
    document.fonts.addEventListener('loadingdone', this.onMetricsChange);
    void document.fonts.ready.then(this.onMetricsChange);
    this.watchPixelRatio();
  }

  private readonly onMetricsChange = (): void => this.scheduleFit();

  private readonly onPixelRatioChange = (): void => {
    this.watchPixelRatio();
    this.scheduleFit();
  };

  /** A resolution query matches one ratio only, so it is re-armed after every change. */
  private watchPixelRatio(): void {
    this.dprQuery?.removeEventListener('change', this.onPixelRatioChange);
    if (this.disposed) return;
    this.dprQuery = window.matchMedia(
      `(resolution: ${window.devicePixelRatio}dppx)`,
    );
    this.dprQuery.addEventListener('change', this.onPixelRatioChange);
  }

  /**
   * xterm reflows on every frame of a drag, but each PTY resize makes the shell redraw its
   * prompt; sending only the settled size avoids a trail of half-drawn prompts.
   */
  private schedulePtyResize(): void {
    if (this.ptyResizeTimer) clearTimeout(this.ptyResizeTimer);
    this.ptyResizeTimer = setTimeout(() => {
      this.ptyResizeTimer = null;
      if (this.sessionId && !this.disposed)
        window.rtx.terminal.resize(
          this.sessionId,
          this.term.cols,
          this.term.rows,
        );
    }, 60);
  }

  get session(): string | null {
    return this.sessionId;
  }

  /** Puts the terminal into `container`; the first attach opens xterm and starts the session. */
  attach(container: HTMLElement): void {
    if (this.disposed) return;
    if (this.host.parentElement !== container) container.appendChild(this.host);
    if (!this.opened) {
      this.term.open(this.host);
      this.opened = true;
      this.resizeObserver.observe(this.host);
      void this.applyRenderer();
    }
    this.scheduleFit();
    if (
      !this.sessionId &&
      !this.starting &&
      workspace.get().panes[this.paneId]?.status === 'starting'
    ) {
      void this.start();
    }
  }

  private scheduleFit(): void {
    if (this.fitFrame) return;
    this.fitFrame = requestAnimationFrame(() => {
      this.fitFrame = 0;
      // Hidden tabs measure 0x0; fitting then would shrink the PTY to nothing.
      if (
        this.disposed ||
        this.host.clientWidth === 0 ||
        this.host.clientHeight === 0
      )
        return;
      try {
        this.fitAddon.fit();
      } catch {
        // The renderer is not ready yet; the next resize fits.
      }
    });
  }

  async start(): Promise<void> {
    if (this.starting || this.disposed) return;
    const pane = workspace.get().panes[this.paneId];
    if (!pane) return;
    this.starting = true;
    updatePane(this.paneId, {
      status: 'starting',
      error: null,
      exitCode: null,
    });
    const prefs = appData.get().preferences.terminal;
    const proposed =
      this.opened && this.host.clientWidth > 0
        ? this.fitAddon.proposeDimensions()
        : undefined;
    const cols =
      proposed && proposed.cols > 1 ? proposed.cols : prefs.defaultCols;
    const rows =
      proposed && proposed.rows > 1 ? proposed.rows : prefs.defaultRows;
    if (this.term.cols !== cols || this.term.rows !== rows)
      this.term.resize(cols, rows);

    if (pane.launch.ssh) {
      await this.startSsh(pane.launch.ssh.hostId, cols, rows);
      return;
    }

    let result: Awaited<ReturnType<typeof window.rtx.terminal.create>>;
    try {
      result = await window.rtx.terminal.create({
        cols,
        rows,
        ...(pane.launch.shell ? { shell: pane.launch.shell } : {}),
        ...(pane.launch.cwd ? { cwd: pane.launch.cwd } : {}),
      });
    } catch (error) {
      result = {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
    this.starting = false;
    if (this.disposed) {
      if (result.ok) void window.rtx.terminal.close(result.session.id);
      return;
    }
    if (!result.ok) {
      updatePane(this.paneId, { status: 'error', error: result.error });
      return;
    }
    this.bindSession(result.session, cols, rows);
  }

  private bindSession(session: SessionInfo, cols: number, rows: number): void {
    this.sessionId = session.id;
    this.sink.bind(session.id, this);
    updatePane(this.paneId, {
      status: 'running',
      sessionId: session.id,
      shell: session.shell,
      shellName: session.shellName,
      pid: session.pid,
      remote: session.remote ?? null,
      connecting: null,
      exitReason: null,
      errorCode: null,
    });
    // The pane may have been resized while the session was starting.
    if (this.term.cols !== cols || this.term.rows !== rows) {
      window.rtx.terminal.resize(session.id, this.term.cols, this.term.rows);
    }
    if (this.isActivePane()) this.focus();
  }

  /** The SSH attempt in flight, so progress events and cancellation reach the right pane. */
  get pendingRequest(): string | null {
    return this.sshRequestId;
  }

  onSshProgress(state: SshConnectState): void {
    updatePane(this.paneId, { connecting: state });
  }

  /**
   * Opens a saved SSH host. Credentials are asked for only when the server needs them, and a
   * rejected password or passphrase asks again rather than failing outright.
   */
  private async startSsh(
    hostId: string,
    cols: number,
    rows: number,
  ): Promise<void> {
    let password: string | undefined;
    let passphrase: string | undefined;
    let saveSecret = false;
    for (let attempt = 0; attempt < 5; attempt++) {
      const requestId = newId('ssh');
      this.sshRequestId = requestId;
      updatePane(this.paneId, {
        connecting: 'connecting',
        errorCode: null,
        error: null,
      });
      let result: CreateSessionResult;
      try {
        result = await window.rtx.terminal.create({
          cols,
          rows,
          ssh: {
            hostId,
            requestId,
            ...(password ? { password } : {}),
            ...(passphrase ? { passphrase } : {}),
            ...(saveSecret ? { saveSecret: true } : {}),
          },
        });
      } catch (error) {
        result = {
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        };
      }
      this.sshRequestId = null;
      this.starting = false;
      if (this.disposed) {
        if (result.ok) void window.rtx.terminal.close(result.session.id);
        return;
      }
      if (result.ok) {
        if (saveSecret) void refreshSecretState();
        this.bindSession(result.session, cols, rows);
        return;
      }

      const host = appData.get().profiles.hosts.find((h) => h.id === hostId);
      const code = result.code;
      const kind =
        code === 'password-required' ||
        (code === 'auth' && host?.auth === 'password')
          ? 'password'
          : code === 'passphrase-required' || code === 'passphrase-wrong'
            ? 'passphrase'
            : null;
      if (kind && host) {
        const answer = await askCredential({
          kind,
          hostLabel: host.name,
          target: `${host.username || '…'}@${host.host || host.configAlias || '…'}${host.port !== 22 ? `:${host.port}` : ''}`,
          message:
            code === 'auth'
              ? 'The server rejected the password.'
              : code === 'passphrase-wrong'
                ? 'That passphrase is not correct.'
                : null,
        });
        if (this.disposed) return;
        if (answer) {
          if (kind === 'password') password = answer.secret;
          else passphrase = answer.secret;
          saveSecret = answer.save;
          this.starting = true;
          continue;
        }
        updatePane(this.paneId, {
          status: 'error',
          error: 'Signing in was cancelled.',
          errorCode: 'cancelled',
          connecting: null,
        });
        return;
      }
      updatePane(this.paneId, {
        status: 'error',
        error: result.error,
        errorCode: code ?? null,
        connecting: null,
      });
      return;
    }
  }

  /** Ends an SSH session but keeps the pane and its output, ready to reconnect. */
  disconnect(): void {
    if (this.sessionId) void window.rtx.terminal.close(this.sessionId);
  }

  /** Stops an SSH connection that is still being opened. */
  cancelConnect(): void {
    const requestId = this.sshRequestId;
    if (!requestId) return;
    dropPromptsFor(requestId);
    void window.rtx.ssh.cancel(requestId);
  }

  /** Starts a fresh session in the same pane after the previous one exited or failed. */
  restart(launchOverride?: { shell?: string }): void {
    if (this.sessionId || this.starting) return;
    if (launchOverride) {
      const pane = workspace.get().panes[this.paneId];
      if (pane)
        updatePane(this.paneId, {
          launch: { ...pane.launch, ...launchOverride },
        });
    }
    const pane = workspace.get().panes[this.paneId];
    if (pane?.launch.ssh) this.term.write('\r\n');
    else this.term.reset();
    void this.start();
  }

  receive(data: string): void {
    const id = this.sessionId;
    this.term.write(data, () => {
      if (id) window.rtx.terminal.ack(id, data.length);
    });
  }

  handleExit(exit: SessionExit): void {
    if (this.sessionId) this.sink.unbind(this.sessionId);
    this.sessionId = null;
    this.line = '';
    updatePane(this.paneId, {
      status: 'exited',
      exitCode: exit.exitCode,
      exitReason: exit.reason ?? null,
      sessionId: null,
      pid: null,
    });
  }

  private handleInput(data: string): void {
    if (!this.sessionId) return;
    window.rtx.terminal.write(this.sessionId, data);
    if (!this.suppressTracking) this.observeInput(data);
  }

  /**
   * Follows typed input to recognise commands for history. Only plain typing (with backspace and
   * paste) is trusted: once arrows, Tab completion or other editing keys touch the line, the app
   * cannot know what the shell will run, so that line is not recorded.
   */
  private observeInput(data: string): void {
    if (this.term.buffer.active.type === 'alternate') {
      this.line = '';
      return;
    }
    const text = data.replace(BRACKETED_PASTE, (_match, pasted: string) =>
      pasted.includes('\r') || pasted.includes('\n') ? '\x00' : pasted,
    );
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (ch === '\r') {
        this.commitLine();
      } else if (ch === '\x7f' || ch === '\b') {
        this.line = this.line.slice(0, -1);
      } else if (ch === '\x03' || ch === '\x15') {
        this.line = '';
        this.lineReliable = true;
      } else if (ch === '\x1b') {
        this.lineReliable = false;
        // Skip the rest of the escape sequence.
        while (i + 1 < text.length && !/[A-Za-z~]/.test(text[i + 1])) i++;
        i++;
      } else if (ch < ' ') {
        this.lineReliable = false;
      } else {
        this.line += ch;
      }
    }
  }

  private commitLine(): void {
    const typed = this.line;
    const reliable = this.lineReliable;
    this.line = '';
    this.lineReliable = true;
    // A leading space hides a command from history, matching HISTCONTROL=ignorespace.
    if (!reliable || !typed.trim() || typed.startsWith(' ')) return;
    // Only record what the terminal echoed back: unechoed input (a password prompt) is skipped.
    if (!this.cursorLineText().includes(typed.trim())) return;
    const pane = workspace.get().panes[this.paneId];
    recordHistory({
      command: typed,
      cwd:
        ui.get().runtime.paneId === this.paneId
          ? (ui.get().runtime.info?.cwd ?? null)
          : null,
      shell: pane?.shell ?? null,
      source: 'typed',
    });
  }

  private cursorLineText(): string {
    const buffer = this.term.buffer.active;
    let y = buffer.baseY + buffer.cursorY;
    let text = buffer.getLine(y)?.translateToString(true) ?? '';
    while (y > 0 && buffer.getLine(y)?.isWrapped) {
      y--;
      text = (buffer.getLine(y)?.translateToString(true) ?? '') + text;
    }
    return text;
  }

  /** Types `command` at the prompt without running it. */
  insert(command: string): boolean {
    if (!this.sessionId) return false;
    this.term.paste(command);
    this.focus();
    return true;
  }

  /** Types `command` and presses Enter. Confirmation for destructive commands happens before this. */
  run(command: string): boolean {
    if (!this.sessionId) return false;
    this.suppressTracking = true;
    try {
      this.term.paste(command);
    } finally {
      this.suppressTracking = false;
    }
    window.rtx.terminal.write(this.sessionId, '\r');
    this.line = '';
    this.lineReliable = true;
    const pane = workspace.get().panes[this.paneId];
    recordHistory({
      command,
      cwd: null,
      shell: pane?.shell ?? null,
      source: 'app',
    });
    this.focus();
    return true;
  }

  focus(): void {
    if (this.opened && !this.disposed) this.term.focus();
  }

  copySelection(): boolean {
    if (!this.term.hasSelection()) return false;
    void window.rtx.system.writeClipboard(this.term.getSelection());
    return true;
  }

  async pasteClipboard(): Promise<void> {
    const text = await window.rtx.system.readClipboard();
    if (text && this.sessionId) this.term.paste(text);
    this.focus();
  }

  selectAll(): void {
    this.term.selectAll();
  }

  clearSelection(): void {
    this.term.clearSelection();
  }

  /** Clears xterm's screen, scrollback and modes. The shell keeps running; it redraws its prompt. */
  reset(): void {
    this.term.reset();
    if (this.sessionId) window.rtx.terminal.write(this.sessionId, '\x0c');
    this.focus();
  }

  /** Sends Ctrl+C to the foreground process, exactly as pressing it in the terminal would. */
  interrupt(): boolean {
    if (!this.sessionId) return false;
    window.rtx.terminal.write(this.sessionId, '\x03');
    this.focus();
    return true;
  }

  clear(): void {
    this.term.clear();
    this.focus();
  }

  hasSelection(): boolean {
    return this.term.hasSelection();
  }

  selection(): string {
    return this.term.getSelection();
  }

  find(
    query: string,
    options: Omit<ISearchOptions, 'decorations'>,
    direction: 'next' | 'previous',
  ): boolean {
    if (!query) {
      this.searchAddon.clearDecorations();
      return false;
    }
    const search = { ...options, decorations: SEARCH_DECORATIONS };
    return direction === 'next'
      ? this.searchAddon.findNext(query, search)
      : this.searchAddon.findPrevious(query, search);
  }

  clearSearch(): void {
    this.searchAddon.clearDecorations();
    this.term.clearSelection();
  }

  /** Applies changed preferences in place; the session keeps running. */
  applyPreferences(prefs: TerminalPreferences, appTheme: AppThemeId): void {
    const previous = this.applied;
    const previousAppTheme = this.appliedAppTheme;
    this.applied = prefs;
    this.appliedAppTheme = appTheme;
    const options = terminalOptions(prefs, appTheme);
    const t = this.term.options;
    if (previous.fontFamily !== prefs.fontFamily)
      t.fontFamily = options.fontFamily;
    if (previous.fontSize !== prefs.fontSize) t.fontSize = options.fontSize;
    if (previous.lineHeight !== prefs.lineHeight)
      t.lineHeight = options.lineHeight;
    if (previous.cursorStyle !== prefs.cursorStyle)
      t.cursorStyle = options.cursorStyle;
    if (previous.cursorBlink !== prefs.cursorBlink)
      t.cursorBlink = options.cursorBlink;
    if (previous.scrollback !== prefs.scrollback)
      t.scrollback = options.scrollback;
    if (previous.themeId !== prefs.themeId || previousAppTheme !== appTheme)
      t.theme = options.theme;
    if (previous.gpuAcceleration !== prefs.gpuAcceleration)
      void this.applyRenderer();
    this.scheduleFit();
  }

  /** WebGL draws on the GPU; if it is unavailable or its context is lost, xterm falls back to DOM. */
  private async applyRenderer(): Promise<void> {
    const wantGpu = appData.get().preferences.terminal.gpuAcceleration;
    if (!wantGpu) {
      this.webgl?.dispose();
      this.webgl = null;
      updatePane(this.paneId, { renderer: 'dom' });
      this.scheduleFit();
      return;
    }
    if (this.webgl || !this.opened) return;
    try {
      const { WebglAddon } = await import('@xterm/addon-webgl');
      if (this.disposed || this.webgl) return;
      const addon = new WebglAddon();
      addon.onContextLoss(() => {
        addon.dispose();
        if (this.webgl === addon) this.webgl = null;
        updatePane(this.paneId, { renderer: 'dom' });
        this.scheduleFit();
      });
      this.term.loadAddon(addon);
      this.webgl = addon;
      updatePane(this.paneId, { renderer: 'webgl' });
      // The GPU renderer measures cells slightly differently from the DOM one.
      this.scheduleFit();
    } catch {
      this.webgl = null;
      updatePane(this.paneId, { renderer: 'dom' });
    }
  }

  private isActivePane(): boolean {
    const state = workspace.get();
    const tab = state.tabs.find((t) => t.id === state.activeTabId);
    return tab?.activePaneId === this.paneId;
  }

  dispose(): void {
    if (this.disposed) return;
    this.cancelConnect();
    this.disposed = true;
    if (this.fitFrame) cancelAnimationFrame(this.fitFrame);
    if (this.ptyResizeTimer) clearTimeout(this.ptyResizeTimer);
    this.resizeObserver.disconnect();
    document.fonts.removeEventListener('loadingdone', this.onMetricsChange);
    this.dprQuery?.removeEventListener('change', this.onPixelRatioChange);
    for (const disposable of this.disposables) disposable.dispose();
    if (this.sessionId) {
      this.sink.unbind(this.sessionId);
      void window.rtx.terminal.close(this.sessionId);
      this.sessionId = null;
    }
    this.webgl?.dispose();
    this.term.dispose();
    this.host.remove();
  }
}

// Development only: this module holds live terminals, which hot replacement cannot carry over.
// Reload the page instead; the main process ends the old sessions when the page navigates.
if (import.meta.hot) import.meta.hot.dispose(() => window.location.reload());
