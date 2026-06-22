import * as ts from 'typescript';
import {
  buildVirtualDocument,
  calcAbsSourceMap,
  fixTextSpan,
  getRealName,
  getVirtualName,
  type VirtualDocumentResult
} from '@bobe-js/lang-core';
import type { EditorDiagnostic } from './types';
import { isCodeFile, normalizePath, VirtualFileSystem } from './vfs';

const LIB_FILE = '/__bobe_editor_lib.d.ts';
const MODULE_FILE = '/__bobe_editor_modules.d.ts';

const compilerOptions: ts.CompilerOptions = {
  target: ts.ScriptTarget.ES2020,
  module: ts.ModuleKind.ESNext,
  moduleResolution: ts.ModuleResolutionKind.NodeJs,
  allowJs: true,
  checkJs: false,
  jsx: ts.JsxEmit.ReactJSX,
  strict: true,
  noEmit: true,
  skipLibCheck: true,
  allowSyntheticDefaultImports: true,
  esModuleInterop: true,
  lib: []
};

export class EditorDiagnosticService {
  constructor(private vfs: VirtualFileSystem) {}

  getDiagnostics() {
    const realFiles = this.getRealFileMap();
    const baseProgram = ts.createProgram(Array.from(realFiles.keys()), compilerOptions, createHost(realFiles));
    const virtualDocs = this.buildVirtualDocs(baseProgram);
    const fullFiles = new Map(realFiles);

    virtualDocs.forEach((doc, virtualName) => fullFiles.set(virtualName, doc.code));

    const fullProgram = ts.createProgram(Array.from(fullFiles.keys()), compilerOptions, createHost(fullFiles));
    const diagnostics: EditorDiagnostic[] = [];

    this.vfs.files.filter(file => isCodeFile(file.path)).forEach(file => {
      const sourceFile = fullProgram.getSourceFile(file.path);
      if (!sourceFile) return;
      const rawDiagnostics = [
        ...fullProgram.getSyntacticDiagnostics(sourceFile),
        ...fullProgram.getSemanticDiagnostics(sourceFile)
      ];
      rawDiagnostics.forEach(diagnostic => {
        diagnostics.push(toEditorDiagnostic(file.path, diagnostic, 'typescript'));
      });
    });

    virtualDocs.forEach((doc, virtualName) => {
      const sourceFile = fullProgram.getSourceFile(virtualName);
      if (!sourceFile) return;

      doc.templates.forEach(template => {
        template.errors.forEach(error => {
          const start = Math.max(0, template.templateStart + error.loc.start.offset - 1);
          const end = Math.max(start + 1, template.templateStart + error.loc.end.offset - 1);
          diagnostics.push({
            path: normalizePath(getRealName(virtualName)),
            message: error.message,
            severity: 'error',
            start,
            length: end - start,
            source: 'bobe'
          });
        });
      });

      const rawDiagnostics = [
        ...fullProgram.getSyntacticDiagnostics(sourceFile),
        ...fullProgram.getSemanticDiagnostics(sourceFile)
      ];
      rawDiagnostics.forEach(diagnostic => {
        const mapped = mapVirtualDiagnostic(virtualName, diagnostic, doc);
        if (mapped) diagnostics.push(mapped);
      });
    });

    return diagnostics;
  }

  private getRealFileMap() {
    const files = new Map<string, string>();
    files.set(LIB_FILE, DEFAULT_LIB);
    files.set(MODULE_FILE, MODULE_TYPES);
    this.vfs.files.forEach(file => {
      files.set(file.path, file.content);
    });
    return files;
  }

  private buildVirtualDocs(baseProgram: ts.Program) {
    const docs = new Map<string, VirtualDocumentResult>();
    this.vfs.files.filter(file => isCodeFile(file.path) && hasBobeTemplate(file.content)).forEach(file => {
      const sourceFile = baseProgram.getSourceFile(file.path);
      if (!sourceFile) return;
      const virtualName = getVirtualName(file.path);
      docs.set(virtualName, buildVirtualDocument(sourceFile, ts as any, baseProgram as any));
    });
    return docs;
  }
}

function createHost(files: Map<string, string>): ts.CompilerHost {
  return {
    getSourceFile(fileName, languageVersion) {
      const normalized = normalizePath(fileName);
      const source = files.get(normalized);
      if (source == null) return undefined;
      return ts.createSourceFile(normalized, source, languageVersion, true, getScriptKind(normalized));
    },
    getDefaultLibFileName: () => LIB_FILE,
    writeFile: () => {},
    getCurrentDirectory: () => '/',
    getDirectories: () => [],
    fileExists: fileName => files.has(normalizePath(fileName)),
    readFile: fileName => files.get(normalizePath(fileName)),
    getCanonicalFileName: fileName => normalizePath(fileName),
    useCaseSensitiveFileNames: () => true,
    getNewLine: () => '\n',
    resolveModuleNames(moduleNames, containingFile) {
      return moduleNames.map(moduleName => resolveModuleName(files, moduleName, containingFile));
    }
  };
}

function resolveModuleName(files: Map<string, string>, moduleName: string, containingFile: string): ts.ResolvedModuleFull | undefined {
  if (moduleName === 'bobe' || moduleName === 'bobe-dom') {
    return {
      resolvedFileName: MODULE_FILE,
      extension: ts.Extension.Dts,
      isExternalLibraryImport: true
    };
  }

  if (!moduleName.startsWith('.')) return undefined;

  const base = normalizePath(`${dirname(containingFile)}/${moduleName}`);
  const candidates = [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    `${base}.js`,
    `${base}.jsx`,
    `${base}.json`,
    `${base}/index.ts`,
    `${base}/index.tsx`,
    `${base}/index.js`,
    `${base}/index.jsx`
  ];
  const found = candidates.find(candidate => files.has(candidate));
  if (!found) return undefined;

  return {
    resolvedFileName: found,
    extension: toExtension(found)
  };
}

function mapVirtualDiagnostic(
  virtualName: string,
  diagnostic: ts.Diagnostic,
  doc: VirtualDocumentResult
): EditorDiagnostic | undefined {
  if (diagnostic.start == null) return undefined;
  const map = calcAbsSourceMap(diagnostic.start, doc.templates, true);
  if (!map) return undefined;
  const span = fixTextSpan(
    { start: diagnostic.start, length: diagnostic.length || map.length || 1 },
    doc.code,
    map
  );
  return {
    path: normalizePath(getRealName(virtualName)),
    message: flattenMessage(diagnostic.messageText),
    severity: toSeverity(diagnostic.category),
    start: span.start,
    length: Math.max(1, span.length),
    source: 'typescript'
  };
}

function toEditorDiagnostic(path: string, diagnostic: ts.Diagnostic, source: EditorDiagnostic['source']): EditorDiagnostic {
  return {
    path: normalizePath(path),
    message: flattenMessage(diagnostic.messageText),
    severity: toSeverity(diagnostic.category),
    start: diagnostic.start || 0,
    length: Math.max(1, diagnostic.length || 1),
    source
  };
}

function flattenMessage(message: string | ts.DiagnosticMessageChain): string {
  return ts.flattenDiagnosticMessageText(message, '\n');
}

function toSeverity(category: ts.DiagnosticCategory): EditorDiagnostic['severity'] {
  if (category === ts.DiagnosticCategory.Error) return 'error';
  if (category === ts.DiagnosticCategory.Warning) return 'warning';
  return 'info';
}

function getScriptKind(path: string) {
  if (path.endsWith('.tsx')) return ts.ScriptKind.TSX;
  if (path.endsWith('.jsx')) return ts.ScriptKind.JSX;
  if (path.endsWith('.js')) return ts.ScriptKind.JS;
  if (path.endsWith('.json')) return ts.ScriptKind.JSON;
  return ts.ScriptKind.TS;
}

function toExtension(path: string) {
  if (path.endsWith('.tsx')) return ts.Extension.Tsx;
  if (path.endsWith('.jsx')) return ts.Extension.Jsx;
  if (path.endsWith('.js')) return ts.Extension.Js;
  if (path.endsWith('.json')) return ts.Extension.Json;
  return ts.Extension.Ts;
}

function dirname(path: string) {
  const normalized = normalizePath(path);
  const index = normalized.lastIndexOf('/');
  return index <= 0 ? '/' : normalized.slice(0, index);
}

function hasBobeTemplate(source: string) {
  return /\bbobe(?:\s*<[^`]*>)?`/.test(source);
}

const DEFAULT_LIB = `
type Partial<T> = { [P in keyof T]?: T[P] };
type Record<K extends keyof any, T> = { [P in K]: T };
type NonNullable<T> = T & {};
type Omit<T, K extends keyof any> = Pick<T, Exclude<keyof T, K>>;
type Pick<T, K extends keyof T> = { [P in K]: T[P] };
type Exclude<T, U> = T extends U ? never : T;
type InstanceType<T extends new (...args: any) => any> = T extends new (...args: any) => infer R ? R : any;
type ReturnType<T extends (...args: any) => any> = T extends (...args: any) => infer R ? R : any;
interface Array<T> { length: number; forEach(callbackfn: (value: T, index: number, array: T[]) => void): void; push(...items: T[]): number; map<U>(callbackfn: (value: T, index: number, array: T[]) => U): U[]; }
interface ReadonlyArray<T> { length: number; forEach(callbackfn: (value: T, index: number, array: readonly T[]) => void): void; }
interface TemplateStringsArray extends ReadonlyArray<string> { readonly raw: readonly string[]; }
interface String { readonly length: number; trim(): string; }
interface Number {}
interface Boolean {}
interface Function {}
interface Object {}
interface RegExp {}
interface CallableFunction extends Function {}
interface NewableFunction extends Function {}
interface IArguments {}
interface Promise<T> {}
interface Event { target: EventTarget | null; }
interface EventTarget { addEventListener(type: string, listener: any): void; removeEventListener(type: string, listener: any): void; }
interface Node extends EventTarget { textContent: string | null; appendChild(node: Node): Node; remove(): void; }
interface Text extends Node {}
interface Element extends Node { innerHTML: string; setAttribute(name: string, value: string): void; removeAttribute(name: string): void; }
interface HTMLElement extends Element { className: string; style: any; id: string; }
interface HTMLInputElement extends HTMLElement { value: string; checked: boolean; }
interface HTMLButtonElement extends HTMLElement { disabled: boolean; }
interface HTMLDivElement extends HTMLElement {}
interface HTMLSpanElement extends HTMLElement {}
interface HTMLAnchorElement extends HTMLElement { href: string; }
interface HTMLElementTagNameMap { div: HTMLDivElement; span: HTMLSpanElement; button: HTMLButtonElement; input: HTMLInputElement; a: HTMLAnchorElement; p: HTMLElement; h1: HTMLElement; h2: HTMLElement; h3: HTMLElement; ul: HTMLElement; li: HTMLElement; }
interface Document { createElement<K extends keyof HTMLElementTagNameMap>(tagName: K): HTMLElementTagNameMap[K]; createElement(tagName: string): HTMLElement; getElementById(id: string): HTMLElement | null; body: HTMLElement; }
interface ElementCreationOptions {}
declare var document: Document;
declare var window: any;
declare var console: { log(...args: any[]): void; warn(...args: any[]): void; error(...args: any[]): void; info(...args: any[]): void };
declare var setTimeout: any;
declare var clearTimeout: any;
`;

const MODULE_TYPES = `
declare module 'bobe' {
  export class Store { static new<T extends typeof Store>(this: T): InstanceType<T>; [key: string]: any; }
  export function bobe<T extends Record<any, any> = any>(fragments: TemplateStringsArray, ...values: any[]): any;
  export function customRender(option: any): any;
  export function effect(...args: any[]): any;
}
declare module 'bobe-dom' {
  export const render: any;
}
`;
