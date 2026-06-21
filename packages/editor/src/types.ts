export type EditorFileKind = 'ts' | 'tsx' | 'js' | 'jsx' | 'css' | 'json';

export interface EditorFile {
  path: string;
  content: string;
  kind?: EditorFileKind;
}

export type EditorDiagnosticSeverity = 'error' | 'warning' | 'info';

export interface EditorDiagnostic {
  path: string;
  message: string;
  severity: EditorDiagnosticSeverity;
  start: number;
  length: number;
  source: 'typescript' | 'bobe';
}

export type DebugLogLevel = 'log' | 'warn' | 'error' | 'info' | 'status';

export interface DebugLogEntry {
  id: number;
  level: DebugLogLevel;
  message: string;
  time: number;
}

export interface BobeEditorOptions {
  files?: EditorFile[];
  entry?: string;
  initialPath?: string;
  readOnly?: boolean;
  monaco?: any;
  autoRun?: boolean;
}

export interface BobeEditorInstance {
  readonly vfs: import('./vfs').VirtualFileSystem;
  run(): Promise<void>;
  dispose(): void;
}

export interface PreviewBundle {
  entry: string;
  modules: Record<string, string>;
  styles: string[];
}
