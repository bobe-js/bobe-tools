import type { EditorFile, EditorFileKind } from './types';

export type VirtualFileSystemListener = () => void;

const SUPPORTED_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.css', '.json']);

export class VirtualFileSystem {
  private fileMap = new Map<string, EditorFile>();
  private versionMap = new Map<string, number>();
  private listeners = new Set<VirtualFileSystemListener>();

  constructor(files: EditorFile[] = []) {
    files.forEach(file => this.upsertFile(file, false));
  }

  get files() {
    return Array.from(this.fileMap.values()).sort((a, b) => a.path.localeCompare(b.path));
  }

  subscribe(listener: VirtualFileSystemListener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  has(path: string) {
    return this.fileMap.has(normalizePath(path));
  }

  readFile(path: string) {
    return this.getFile(path)?.content;
  }

  getFile(path: string) {
    return this.fileMap.get(normalizePath(path));
  }

  getVersion(path: string) {
    return this.versionMap.get(normalizePath(path)) || 0;
  }

  upsertFile(file: EditorFile, notify = true) {
    const path = normalizePath(file.path);
    assertSupportedPath(path);
    this.fileMap.set(path, { ...file, path, kind: file.kind || getFileKind(path) });
    this.versionMap.set(path, this.getVersion(path) + 1);
    if (notify) this.emit();
  }

  writeFile(path: string, content: string) {
    const normalized = normalizePath(path);
    const current = this.getFile(normalized);
    this.upsertFile({ path: normalized, content, kind: current?.kind || getFileKind(normalized) });
  }

  deleteFile(path: string) {
    const normalized = normalizePath(path);
    const deleted = this.fileMap.delete(normalized);
    this.versionMap.delete(normalized);
    if (deleted) this.emit();
  }

  renameFile(from: string, to: string) {
    const source = normalizePath(from);
    const target = normalizePath(to);
    const file = this.getFile(source);
    if (!file) return;
    assertSupportedPath(target);
    this.fileMap.delete(source);
    this.fileMap.set(target, { ...file, path: target, kind: getFileKind(target) });
    this.versionMap.set(target, this.getVersion(source) + 1);
    this.versionMap.delete(source);
    this.emit();
  }

  private emit() {
    this.listeners.forEach(listener => listener());
  }
}

export function normalizePath(path: string) {
  const normalized = path.replace(/\\/g, '/').replace(/^file:\/\//, '');
  const absolute = normalized.startsWith('/') ? normalized : `/${normalized}`;
  const stack: string[] = [];

  absolute.split('/').forEach(part => {
    if (!part || part === '.') return;
    if (part === '..') {
      stack.pop();
      return;
    }
    stack.push(part);
  });

  return `/${stack.join('/')}`;
}

export function getFileKind(path: string): EditorFileKind {
  const ext = getExtension(path);
  if (ext === '.tsx') return 'tsx';
  if (ext === '.js') return 'js';
  if (ext === '.jsx') return 'jsx';
  if (ext === '.css') return 'css';
  if (ext === '.json') return 'json';
  return 'ts';
}

export function isCodeFile(path: string) {
  const kind = getFileKind(path);
  return kind === 'ts' || kind === 'tsx' || kind === 'js' || kind === 'jsx';
}

export function getExtension(path: string) {
  const index = path.lastIndexOf('.');
  return index >= 0 ? path.slice(index) : '';
}

function assertSupportedPath(path: string) {
  const ext = getExtension(path);
  if (!SUPPORTED_EXTENSIONS.has(ext)) {
    throw new Error(`Unsupported editor file type: ${path}`);
  }
}
