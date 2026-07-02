import { StoreIgnoreKeys } from 'aoye';
import { bobe, customRender, effect, Store } from 'bobe';
import { render } from 'bobe-dom';
import { EditorDiagnosticService } from './diagnostics';
import { bundleForPreview, createPreviewHtml, registerPreviewRuntime, unregisterPreviewRuntime } from './preview';
import { BOBE_TS_LANGUAGE_ID, registerBobeMonacoLanguages } from './syntax';
import { injectEditorStyles } from './style';
import type { BobeEditorInstance, DebugLogEntry, DebugLogLevel, EditorDiagnostic, EditorFile } from './types';
import { getFileKind, isCodeFile, normalizePath, VirtualFileSystem } from './vfs';

export * from './diagnostics';
export * from './preview';
export * from './syntax';
export * from './types';
export * from './vfs';

const DEFAULT_ENTRY = 'src/main.ts';

export class BobeEditor extends Store implements BobeEditorInstance {
  static [StoreIgnoreKeys] = [
    ...((Store as any)[StoreIgnoreKeys] || []),
    'vfs',
    'container',
    'monaco',
    'editor',
    'models',
    'diagnosticService',
    'unsubscribeVfs',
    'diagnosticTimer',
    'initPromise',
    'runtimeId',
    'logId'
  ];

  consoleBottom : HTMLElement | null = null;
  domRef: HTMLElement | null = null;
  vfs = new VirtualFileSystem();
  files: EditorFile[] = [];
  selectedPath = normalizePath(DEFAULT_ENTRY);
  entry = DEFAULT_ENTRY;
  initialPath?: string;
  initialDirectory?: string;
  rootDir?: string;
  logs: DebugLogEntry[] = [];
  diagnostics: EditorDiagnostic[] = [];
  activeDebugPanel: 'console' | 'errors' | 'dom' = 'console';
  previewHtml = '';
  isRunning = false;
  readOnly = false;
  autoRun?: boolean;

  private container?: HTMLElement;
  private monaco: any;
  private editor: any;
  private models = new Map<string, any>();
  private diagnosticService = new EditorDiagnosticService(this.vfs);
  private unsubscribeVfs?: () => void;
  private diagnosticTimer?: number;
  private initialized = false;
  private initPromise?: Promise<void>;
  private runtimeId = `bobe-editor-${Math.random().toString(36).slice(2)}`;
  private logId = 0;

  constructor() {
    super();

    effect(
      () => {
        if (!this.domRef) return;
        void this.initOnce().catch(error => this.handleInitError(error));
      },
      [() => this.domRef],
      { type: 'post' }
    );
  }

  ui = bobe`
    div ref={domRef} class="bobe-editor-shell"
      div class="bobe-editor-toolbar"
        div class="bobe-editor-title" children="Bobe Editor"
        button class="bobe-editor-button" onclick={run} disabled={isRunning} children={isRunning ? "Running..." : "Run"}
      div class="bobe-editor-workspace"
        aside class="bobe-editor-sidebar"
          div class="bobe-editor-panel-title" children="Files"
          div class="bobe-editor-files"
            for files; file
              button class={file.path === selectedPath ? "bobe-editor-file bobe-editor-file-active" : "bobe-editor-file"} onclick={() => selectFile(file.path)} title={file.path} children={displayPath(file.path)}
        section class="bobe-editor-code-pane"
          div class="bobe-editor-monaco" data-bobe-editor-code="true"
        section class="bobe-editor-preview-pane"
          div class="bobe-editor-panel-title" children="Preview"
          iframe class="bobe-editor-preview-frame" data-bobe-editor-preview="true" sandbox="allow-scripts allow-same-origin"
      div class="bobe-editor-debug"
        div class="bobe-editor-debug-tabs"
          button class={activeDebugPanel === "console" ? "bobe-editor-tab bobe-editor-tab-active" : "bobe-editor-tab"} onclick={() => setDebugPanel("console")} children={"Console (" + logs.length + ")"}
          button class={activeDebugPanel === "errors" ? "bobe-editor-tab bobe-editor-tab-active" : "bobe-editor-tab"} onclick={() => setDebugPanel("errors")} children={"Errors (" + diagnostics.length + ")"}
          button class={activeDebugPanel === "dom" ? "bobe-editor-tab bobe-editor-tab-active" : "bobe-editor-tab"} onclick={() => setDebugPanel("dom")} children="Preview DOM"
        div class="bobe-editor-debug-body"
          if activeDebugPanel === "console"
            if logs.length
              for logs; log
                div class={"bobe-editor-log bobe-editor-log-level-" + log.level}
                  span children={log.level}
                  span children={log.message}
            else
              div class="bobe-editor-empty" children="No console output"
            div ref={consoleBottom} id="list-bottom"  
          if activeDebugPanel === "errors"
            if diagnostics.length
              for diagnostics; diagnostic
                div class={"bobe-editor-diagnostic bobe-editor-diagnostic-" + diagnostic.severity}
                  span children={diagnostic.severity}
                  span children={formatDiagnostic(diagnostic)}
            else
              div class="bobe-editor-empty" children="No diagnostics"
          if activeDebugPanel === "dom"
            if previewHtml
              pre class="bobe-editor-dom-snapshot" children={previewHtml}
            else
              div class="bobe-editor-empty" children="Run preview to inspect DOM"
  `;

  logLenEf = effect(({val}) => {
    if(val > 0) {
      this.consoleBottom.scrollIntoView({ behavior: 'smooth' });
    }
  }, [() => this.logs.length], { type: 'post' });

  private initOnce() {
    if (this.initialized) return this.initPromise || Promise.resolve();
    if (!this.domRef) return Promise.resolve();
    if (!this.initPromise) {
      this.initPromise = this.initialize(this.domRef).catch(error => {
        this.initPromise = undefined;
        throw error;
      });
    }
    return this.initPromise;
  }

  private async initialize(container: HTMLElement) {
    this.container = container;
    injectEditorStyles();
    this.readOnly = !!this.readOnly;
    const rootDir = normalizeDirectory(this.initialDirectory || this.rootDir);
    const rawFiles = this.files?.length ? this.files : defaultFiles();
    const files = resolveEditorFiles(rawFiles, rootDir);
    this.entry = resolveEditorPath(this.entry || DEFAULT_ENTRY, rootDir);
    this.selectedPath = resolveEditorPath(this.initialPath || this.entry, rootDir);
    this.vfs = new VirtualFileSystem(files);
    this.files = this.vfs.files;
    this.diagnosticService = new EditorDiagnosticService(this.vfs);
    this.unsubscribeVfs = this.vfs.subscribe(() => {
      this.files = this.vfs.files;
      this.syncModels();
      this.scheduleDiagnostics();
    });
    registerPreviewRuntime(this.runtimeId, { bobe, Store, customRender, render });
    window.addEventListener('message', this.handlePreviewMessage);
    await this.setupMonaco(this.monaco);
    this.runDiagnostics();
    this.initialized = true;
    if (this.autoRun !== false) void this.run();
  }

  selectFile = (path: string) => {
    this.selectedPath = normalizePath(path);
    this.openSelectedModel();
  };

  setDebugPanel = (panel: 'console' | 'errors' | 'dom') => {
    this.activeDebugPanel = panel;
  };

  displayPath = (path: string) => {
    const rootDir = normalizeDirectory(this.initialDirectory || this.rootDir);
    return stripRootDir(path, rootDir).replace(/^\//, '');
  };

  formatDiagnostic = (diagnostic: EditorDiagnostic) => {
    return `${this.displayPath(diagnostic.path)}:${diagnostic.start} ${diagnostic.message}`;
  };

  run = async () => {
    this.isRunning = true;
    this.logs = [];
    this.previewHtml = '';
    try {
      if (!this.initialized) await this.initOnce();
      this.runDiagnostics();
      const iframe = this.container?.querySelector<HTMLIFrameElement>('[data-bobe-editor-preview]');
      if (!iframe) throw new Error('Preview iframe is not mounted.');
      const bundle = bundleForPreview(this.vfs, this.entry);
      iframe.srcdoc = createPreviewHtml(bundle, this.runtimeId);
      this.pushLog('status', `Running ${this.displayPath(this.entry)}`);
    } catch (error) {
      this.pushLog('error', error instanceof Error ? error.message : String(error));
      this.activeDebugPanel = 'console';
    } finally {
      this.isRunning = false;
    }
  };

  dispose() {
    this.unsubscribeVfs?.();
    if (typeof window !== 'undefined') {
      if (this.diagnosticTimer) window.clearTimeout(this.diagnosticTimer);
      window.removeEventListener('message', this.handlePreviewMessage);
      unregisterPreviewRuntime(this.runtimeId);
    }
    this.models.forEach(model => model.dispose?.());
    this.models.clear();
    this.editor?.dispose?.();
    this.initialized = false;
    this.initPromise = undefined;
  }

  private async setupMonaco(monacoApi?: any) {
    this.monaco = monacoApi || await import('monaco-editor').then((mod: any) => mod.default || mod);
    registerBobeMonacoLanguages(this.monaco);
    this.syncModels();
    const mount = this.container?.querySelector<HTMLElement>('[data-bobe-editor-code]');
    if (!mount) throw new Error('Editor mount node is not available.');
    this.editor = this.monaco.editor.create(mount, {
      model: null,
      automaticLayout: true,
      readOnly: this.readOnly,
      minimap: { enabled: false },
      fontSize: 14,
      lineHeight: 22,
      theme: 'vs-dark',
      scrollBeyondLastLine: false
    });
    this.openSelectedModel();
  }

  private syncModels() {
    if (!this.monaco) return;
    const livePaths = new Set(this.vfs.files.map(file => file.path));
    this.vfs.files.forEach(file => {
      const existing = this.models.get(file.path);
      if (existing) {
        if (existing.getValue() !== file.content) existing.setValue(file.content);
        return;
      }
      const uri = this.monaco.Uri.parse(`file://${file.path}`);
      const model = this.monaco.editor.createModel(file.content, languageForPath(file.path), uri);
      model.onDidChangeContent(() => {
        if (this.selectedPath === file.path) {
          this.vfs.writeFile(file.path, model.getValue());
          this.scheduleDiagnostics();
        }
      });
      this.models.set(file.path, model);
    });
    Array.from(this.models.entries()).forEach(([path, model]) => {
      if (!livePaths.has(path)) {
        model.dispose?.();
        this.models.delete(path);
      }
    });
    this.applyMarkers();
  }

  private openSelectedModel() {
    if (!this.editor) return;
    const model = this.models.get(this.selectedPath) || this.models.values().next().value;
    if (model) this.editor.setModel(model);
  }

  private scheduleDiagnostics() {
    if (this.diagnosticTimer) window.clearTimeout(this.diagnosticTimer);
    this.diagnosticTimer = window.setTimeout(() => this.runDiagnostics(), 120);
  }

  private runDiagnostics() {
    try {
      this.diagnostics = this.diagnosticService.getDiagnostics();
      this.applyMarkers();
    } catch (error) {
      this.diagnostics = [{
        path: this.selectedPath,
        message: error instanceof Error ? error.message : String(error),
        severity: 'error',
        start: 0,
        length: 1,
        source: 'bobe'
      }];
      this.applyMarkers();
    }
  }

  private applyMarkers() {
    if (!this.monaco) return;
    const byPath = new Map<string, EditorDiagnostic[]>();
    this.diagnostics.forEach(diagnostic => {
      const list = byPath.get(diagnostic.path) || [];
      list.push(diagnostic);
      byPath.set(diagnostic.path, list);
    });
    this.models.forEach((model, path) => {
      const markers = (byPath.get(path) || []).map(diagnostic => {
        const start = model.getPositionAt(diagnostic.start);
        const end = model.getPositionAt(diagnostic.start + diagnostic.length);
        return {
          severity: markerSeverity(this.monaco, diagnostic.severity),
          message: diagnostic.message,
          startLineNumber: start.lineNumber,
          startColumn: start.column,
          endLineNumber: end.lineNumber,
          endColumn: end.column,
          source: diagnostic.source
        };
      });
      this.monaco.editor.setModelMarkers(model, 'bobe-editor', markers);
    });
  }

  private handlePreviewMessage = (event: MessageEvent) => {
    const data = event.data;
    if (!data || data.source !== 'bobe-editor-preview' || data.runtimeId !== this.runtimeId) return;
    if (data.type === 'console') {
      this.pushLog(data.payload.level, data.payload.args.join(' '));
    }
    if (data.type === 'error') {
      this.pushLog('error', [data.payload.message, data.payload.stack].filter(Boolean).join('\n'));
      this.activeDebugPanel = 'console';
    }
    if (data.type === 'status') {
      this.previewHtml = data.payload.html || '';
      this.pushLog('status', data.payload.message || 'Preview updated');
    }
  };

  private pushLog(level: DebugLogLevel, message: string) {
    this.logs.push({ id: ++this.logId, level, message, time: Date.now() });
  }

  private handleInitError(error: unknown) {
    this.pushLog('error', error instanceof Error ? error.message : String(error));
    this.activeDebugPanel = 'console';
  }
}

function languageForPath(path: string) {
  if (isCodeFile(path)) return BOBE_TS_LANGUAGE_ID;
  if (path.endsWith('.css')) return 'css';
  if (path.endsWith('.json')) return 'json';
  return getFileKind(path);
}

function markerSeverity(monaco: any, severity: EditorDiagnostic['severity']) {
  if (severity === 'error') return monaco.MarkerSeverity.Error;
  if (severity === 'warning') return monaco.MarkerSeverity.Warning;
  return monaco.MarkerSeverity.Info;
}

function normalizeDirectory(path?: string) {
  if (!path) return '/';
  return normalizePath(path);
}

function resolveEditorFiles(files: EditorFile[], rootDir: string) {
  return files.map(file => ({
    ...file,
    path: resolveEditorPath(file.path, rootDir)
  }));
}

function resolveEditorPath(path: string, rootDir: string) {
  if (!rootDir || rootDir === '/' || isAbsoluteEditorPath(path)) {
    return normalizePath(path);
  }
  return normalizePath(`${rootDir}/${path}`);
}

function stripRootDir(path: string, rootDir: string) {
  const normalized = normalizePath(path);
  if (!rootDir || rootDir === '/') return normalized;
  const normalizedRoot = normalizeDirectory(rootDir);
  if (normalized === normalizedRoot) return '/';
  if (normalized.startsWith(`${normalizedRoot}/`)) {
    return normalized.slice(normalizedRoot.length);
  }
  return normalized;
}

function isAbsoluteEditorPath(path: string) {
  const normalized = path.replace(/\\/g, '/');
  return normalized.startsWith('/') || normalized.startsWith('file://');
}

function defaultFiles(): EditorFile[] {
  return [
    {
      path: DEFAULT_ENTRY,
      content: `import { bobe, Store } from 'bobe';
import './style.css';

export default class App extends Store {
  count = 0;

  increment = () => {
    this.count += 1;
    console.log('count', this.count);
  };

  ui = bobe\`
    div class="demo-card"
      h1 children="Bobe online editor"
      p children={"Count: " + count}
      button onclick={increment} children="Increment"
  \`;
}
`
    },
    {
      path: 'src/style.css',
      content: `.demo-card {
  min-height: 100vh;
  box-sizing: border-box;
  padding: 32px;
  background: #f7f3ea;
  color: #28231d;
}

.demo-card h1 {
  margin: 0 0 12px;
  font-size: 28px;
}

.demo-card button {
  height: 34px;
  border: 0;
  border-radius: 6px;
  padding: 0 14px;
  background: #2d2924;
  color: #fff7eb;
  cursor: pointer;
}
`
    }
  ];
}
