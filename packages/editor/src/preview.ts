import * as ts from 'typescript';
import type { PreviewBundle } from './types';
import { getFileKind, isCodeFile, normalizePath, VirtualFileSystem } from './vfs';

export interface PreviewRuntime {
  bobe: any;
  Store: any;
  customRender: any;
  render: any;
}

const RUNTIMES_KEY = '__BOBE_EDITOR_RUNTIMES__';

export function registerPreviewRuntime(id: string, runtime: PreviewRuntime) {
  const win = window as any;
  win[RUNTIMES_KEY] ||= {};
  win[RUNTIMES_KEY][id] = runtime;
}

export function unregisterPreviewRuntime(id: string) {
  const win = window as any;
  if (win[RUNTIMES_KEY]) delete win[RUNTIMES_KEY][id];
}

export function bundleForPreview(vfs: VirtualFileSystem, entry: string): PreviewBundle {
  const normalizedEntry = normalizePath(entry);
  const modules: Record<string, string> = {};
  const styles: string[] = [];
  const seen = new Set<string>();

  visit(normalizedEntry);

  return { entry: normalizedEntry, modules, styles };

  function visit(path: string) {
    const normalized = normalizePath(path);
    if (seen.has(normalized)) return;
    seen.add(normalized);

    const file = vfs.getFile(normalized);
    if (!file) throw new Error(`Preview file not found: ${normalized}`);

    const kind = file.kind || getFileKind(normalized);
    if (kind === 'css') {
      styles.push(file.content);
      modules[normalized] = '';
      return;
    }

    if (kind === 'json') {
      modules[normalized] = `module.exports = ${file.content};`;
      return;
    }

    if (!isCodeFile(normalized)) return;

    const deps = findDependencies(file.content)
      .filter(specifier => specifier.startsWith('.'))
      .map(specifier => resolveImport(vfs, normalized, specifier));
    deps.forEach(visit);
    modules[normalized] = ts.transpileModule(file.content, {
      compilerOptions: {
        target: ts.ScriptTarget.ES2020,
        module: ts.ModuleKind.CommonJS,
        jsx: ts.JsxEmit.ReactJSX,
        esModuleInterop: true
      },
      fileName: normalized
    }).outputText;
  }
}

export function createPreviewHtml(bundle: PreviewBundle, runtimeId: string) {
  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <style>
      html, body, #root { margin: 0; min-height: 100%; }
      body { font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
      ${bundle.styles.join('\n')}
    </style>
  </head>
  <body>
    <div id="root"></div>
    <script>
      ${createPreviewRuntimeScript(bundle, runtimeId)}
    </script>
  </body>
</html>`;
}

function createPreviewRuntimeScript(bundle: PreviewBundle, runtimeId: string) {
  return `
const RUNTIME_ID = ${JSON.stringify(runtimeId)};
const ENTRY = ${JSON.stringify(bundle.entry)};
const MODULES = ${safeJson(bundle.modules)};
const MODULE_IDS = new Set(Object.keys(MODULES));
const cache = Object.create(null);

function send(type, payload) {
  window.parent.postMessage({ source: 'bobe-editor-preview', runtimeId: RUNTIME_ID, type, payload }, '*');
}

['log', 'warn', 'error', 'info'].forEach(level => {
  const raw = console[level].bind(console);
  console[level] = (...args) => {
    raw(...args);
    send('console', { level, args: args.map(formatArg) });
  };
});

window.addEventListener('error', event => {
  send('error', { message: event.message, stack: event.error && event.error.stack });
});

window.addEventListener('unhandledrejection', event => {
  send('error', { message: formatArg(event.reason), stack: event.reason && event.reason.stack });
});

function formatArg(value) {
  if (typeof value === 'string') return value;
  if (value instanceof Error) return value.stack || value.message;
  try { return JSON.stringify(value); } catch { return String(value); }
}

function dirname(path) {
  const index = path.lastIndexOf('/');
  return index <= 0 ? '/' : path.slice(0, index);
}

function normalize(path) {
  const parts = path.split('/');
  const stack = [];
  for (const part of parts) {
    if (!part || part === '.') continue;
    if (part === '..') stack.pop();
    else stack.push(part);
  }
  return '/' + stack.join('/');
}

function resolve(from, specifier) {
  if (!specifier.startsWith('.')) return specifier;
  const base = normalize(dirname(from) + '/' + specifier);
  const candidates = [base, base + '.ts', base + '.tsx', base + '.js', base + '.jsx', base + '.json', base + '.css', base + '/index.ts', base + '/index.tsx', base + '/index.js'];
  const found = candidates.find(candidate => MODULE_IDS.has(candidate));
  if (!found) throw new Error('Cannot resolve ' + specifier + ' from ' + from);
  return found;
}

function load(id) {
  if (id === 'bobe') return bobeModule;
  if (id === 'bobe-dom') return domModule;
  if (cache[id]) return cache[id].exports;
  const code = MODULES[id];
  if (code == null) throw new Error('Module not found: ' + id);
  const module = { exports: {} };
  cache[id] = module;
  const fn = new Function('require', 'exports', 'module', code + '\\n//# sourceURL=bobe-editor:' + id);
  fn(specifier => load(resolve(id, specifier)), module.exports, module);
  return module.exports;
}

const runtimeMap = window.parent && window.parent.__BOBE_EDITOR_RUNTIMES__;
const runtime = runtimeMap && runtimeMap[RUNTIME_ID];
if (!runtime) throw new Error('Bobe preview runtime is not registered.');

const render = runtime.render;
const bobeModule = { bobe: runtime.bobe, Store: runtime.Store, customRender: runtime.customRender };
const domModule = { render };

try {
  const entryExports = load(ENTRY);
  const root = document.getElementById('root');
  const Component = entryExports.default || entryExports.App;
  if (typeof entryExports.mount === 'function') {
    entryExports.mount(root, { render, bobe: runtime.bobe, Store: runtime.Store });
  } else if (typeof Component === 'function') {
    render(Component, root);
  }
  send('status', { message: 'Preview rendered', html: root.innerHTML });
} catch (error) {
  send('error', { message: error && error.message ? error.message : String(error), stack: error && error.stack });
}
`;
}

function safeJson(value: unknown) {
  return JSON.stringify(value).replace(/<\/script/gi, '<\\/script').replace(/<!--/g, '<\\!--');
}

function findDependencies(source: string) {
  const deps: string[] = [];
  const pattern = /(?:import|export)\s+(?:[^'";]*?\s+from\s+)?['"]([^'"]+)['"]|require\(\s*['"]([^'"]+)['"]\s*\)/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(source))) {
    deps.push(match[1] || match[2]);
  }
  return deps;
}

function resolveImport(vfs: VirtualFileSystem, from: string, specifier: string) {
  const base = normalizePath(`${dirname(from)}/${specifier}`);
  const candidates = [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    `${base}.js`,
    `${base}.jsx`,
    `${base}.json`,
    `${base}.css`,
    `${base}/index.ts`,
    `${base}/index.tsx`,
    `${base}/index.js`,
    `${base}/index.jsx`
  ];
  const found = candidates.find(candidate => vfs.has(candidate));
  if (!found) throw new Error(`Cannot resolve ${specifier} from ${from}`);
  return found;
}

function dirname(path: string) {
  const normalized = normalizePath(path);
  const index = normalized.lastIndexOf('/');
  return index <= 0 ? '/' : normalized.slice(0, index);
}
