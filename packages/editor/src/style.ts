const STYLE_ID = 'bobe-editor-style';

export function injectEditorStyles() {
  if (typeof document === 'undefined' || document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = EDITOR_CSS;
  document.head.appendChild(style);
}

const EDITOR_CSS = `
.bobe-editor-shell {
  --be-bg: #151617;
  --be-bg-soft: #1d1f21;
  --be-bg-panel: #232528;
  --be-border: #383b40;
  --be-text: #ebe7df;
  --be-muted: #a69f95;
  --be-accent: #d59f62;
  --be-danger: #f07d78;
  --be-warning: #e4b45f;
  --be-success: #8fcf8f;
  display: grid;
  grid-template-rows: 44px minmax(0, 1fr) 178px;
  width: 100%;
  height: 100%;
  min-height: 640px;
  overflow: hidden;
  background: var(--be-bg);
  color: var(--be-text);
  border: 1px solid var(--be-border);
  border-radius: 8px;
  font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
}

.bobe-editor-toolbar,
.bobe-editor-debug-tabs {
  display: flex;
  align-items: center;
  gap: 8px;
  border-bottom: 1px solid var(--be-border);
  background: var(--be-bg-soft);
  padding: 0 12px;
}

.bobe-editor-title {
  font-size: 14px;
  font-weight: 650;
  margin-right: auto;
}

.bobe-editor-button,
.bobe-editor-tab,
.bobe-editor-file {
  border: 0;
  color: var(--be-text);
  background: transparent;
  font: inherit;
  cursor: pointer;
}

.bobe-editor-button {
  height: 30px;
  padding: 0 12px;
  border-radius: 6px;
  background: var(--be-accent);
  color: #1e1710;
  font-size: 13px;
  font-weight: 700;
}

.bobe-editor-button:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

.bobe-editor-workspace {
  display: grid;
  min-height: 0;
  grid-template-columns: 220px minmax(0, 1fr) minmax(320px, 42%);
}

.bobe-editor-sidebar,
.bobe-editor-preview-pane {
  min-width: 0;
  border-right: 1px solid var(--be-border);
  background: var(--be-bg-soft);
}

.bobe-editor-preview-pane {
  border-right: 0;
  border-left: 1px solid var(--be-border);
  background: #f7f3ea;
}

.bobe-editor-panel-title {
  height: 34px;
  display: flex;
  align-items: center;
  padding: 0 12px;
  color: var(--be-muted);
  border-bottom: 1px solid var(--be-border);
  font-size: 12px;
  font-weight: 700;
  text-transform: uppercase;
}

.bobe-editor-files {
  padding: 6px;
}

.bobe-editor-file {
  display: block;
  width: 100%;
  min-height: 30px;
  padding: 0 8px;
  border-radius: 6px;
  color: var(--be-muted);
  text-align: left;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 12px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.bobe-editor-file:hover,
.bobe-editor-file-active {
  background: var(--be-bg-panel);
  color: var(--be-text);
}

.bobe-editor-code-pane,
.bobe-editor-monaco,
.bobe-editor-preview-frame {
  min-width: 0;
  min-height: 0;
  width: 100%;
  height: 100%;
}

.bobe-editor-preview-frame {
  border: 0;
  background: #fff;
}

.bobe-editor-debug {
  min-height: 0;
  border-top: 1px solid var(--be-border);
  background: var(--be-bg-soft);
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

.bobe-editor-debug-tabs {
  flex: none;
  height: 36px;
  border-bottom: 1px solid var(--be-border);
}

.bobe-editor-tab {
  height: 26px;
  padding: 0 10px;
  border-radius: 5px;
  color: var(--be-muted);
  font-size: 12px;
}

.bobe-editor-tab-active,
.bobe-editor-tab:hover {
  background: var(--be-bg-panel);
  color: var(--be-text);
}

.bobe-editor-debug-body {
  flex: 1;
  overflow: auto;
  padding: 8px 10px;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 12px;
}

.bobe-editor-log,
.bobe-editor-diagnostic {
  display: grid;
  grid-template-columns: 62px minmax(0, 1fr);
  gap: 10px;
  padding: 4px 0;
  border-bottom: 1px solid rgba(255,255,255,0.05);
}

.bobe-editor-log-level-error,
.bobe-editor-diagnostic-error { color: var(--be-danger); }
.bobe-editor-log-level-warn,
.bobe-editor-diagnostic-warning { color: var(--be-warning); }
.bobe-editor-log-level-status { color: var(--be-success); }

.bobe-editor-empty {
  color: var(--be-muted);
}

.bobe-editor-dom-snapshot {
  white-space: pre-wrap;
  color: var(--be-muted);
}
`;
