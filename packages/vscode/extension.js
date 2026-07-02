const vscode = require('vscode');
const { collectBobeTagRanges } = require('./tag-scanner');

const TAG_TOKEN_TYPE_BY_SETTING = {
  namespace: 'bobeTagNamespace',
  type: 'bobeTagType',
  class: 'bobeTagClass',
  enum: 'bobeTagEnum',
  interface: 'bobeTagInterface',
  struct: 'bobeTagStruct',
  typeParameter: 'bobeTagTypeParameter',
  parameter: 'bobeTagParameter',
  variable: 'bobeTagVariable',
  property: 'bobeTagProperty',
  enumMember: 'bobeTagEnumMember',
  event: 'bobeTagEvent',
  function: 'bobeTagFunction',
  method: 'bobeTagMethod',
  macro: 'bobeTagMacro',
  keyword: 'bobeTagKeyword',
  modifier: 'bobeTagModifier',
  comment: 'bobeTagComment',
  string: 'bobeTagString',
  number: 'bobeTagNumber',
  regexp: 'bobeTagRegexp',
  operator: 'bobeTagOperator',
  decorator: 'bobeTagDecorator'
};
const TAG_TOKEN_TYPES = Object.values(TAG_TOKEN_TYPE_BY_SETTING);
const TAG_TOKEN_MODIFIERS = [
  'declaration',
  'definition',
  'readonly',
  'static',
  'deprecated',
  'abstract',
  'async',
  'modification',
  'documentation',
  'defaultLibrary'
];
const TOKEN_LEGEND = new vscode.SemanticTokensLegend(TAG_TOKEN_TYPES, TAG_TOKEN_MODIFIERS);
const SUPPORTED_LANGUAGE_IDS = new Set(['javascript', 'typescript', 'javascriptreact', 'typescriptreact', 'bobe']);
const DOCUMENT_SELECTOR = [
  { language: 'javascript' },
  { language: 'typescript' },
  { language: 'javascriptreact' },
  { language: 'typescriptreact' },
  { language: 'bobe' }
];

class BobeTagSemanticTokensProvider {
  constructor() {
    this.changeEmitter = new vscode.EventEmitter();
    this.onDidChangeSemanticTokens = this.changeEmitter.event;
  }

  provideDocumentSemanticTokens(document) {
    const tokenType = getConfiguredTagTokenType();
    const builder = new vscode.SemanticTokensBuilder(TOKEN_LEGEND);
    if (!tokenType) return builder.build();

    const tokenTypeIndex = TAG_TOKEN_TYPES.indexOf(tokenType);
    const tokenModifierBitset = getConfiguredTagTokenModifierBitset();
    const ranges = collectBobeTagRanges(document.getText(), { languageId: document.languageId });

    ranges.forEach(range => {
      const position = document.positionAt(range.start);
      builder.push(position.line, position.character, range.length, tokenTypeIndex, tokenModifierBitset);
    });

    return builder.build();
  }

  refresh() {
    this.changeEmitter.fire();
  }

  dispose() {
    this.changeEmitter.dispose();
  }
}

function activate(context) {
  const provider = new BobeTagSemanticTokensProvider();
  const decorationController = new BobeTagColorDecorationController();
  context.subscriptions.push(provider);
  context.subscriptions.push(decorationController);
  context.subscriptions.push(vscode.languages.registerDocumentSemanticTokensProvider(DOCUMENT_SELECTOR, provider, TOKEN_LEGEND));
  context.subscriptions.push(vscode.workspace.onDidChangeConfiguration(event => {
    if (event.affectsConfiguration('bobe.syntax.tagTokenType') || event.affectsConfiguration('bobe.syntax.tagTokenModifier')) {
      provider.refresh();
    }
    if (event.affectsConfiguration('bobe.syntax.tagColor')) {
      decorationController.reload();
    }
  }));
  context.subscriptions.push(vscode.window.onDidChangeVisibleTextEditors(() => {
    decorationController.refreshVisibleEditors();
  }));
  context.subscriptions.push(vscode.workspace.onDidChangeTextDocument(event => {
    decorationController.refreshDocument(event.document);
  }));
  decorationController.refreshVisibleEditors();
}

function getConfiguredTagTokenType() {
  const configured = vscode.workspace.getConfiguration('bobe.syntax').get('tagTokenType', 'none');
  if (configured === 'none') return undefined;
  return TAG_TOKEN_TYPE_BY_SETTING[configured] || TAG_TOKEN_TYPE_BY_SETTING.property;
}

function getConfiguredTagTokenModifierBitset() {
  const configured = vscode.workspace.getConfiguration('bobe.syntax').get('tagTokenModifier', 'none');
  if (configured === 'none') return 0;
  const modifierIndex = TAG_TOKEN_MODIFIERS.indexOf(configured);
  return modifierIndex === -1 ? 1 << TAG_TOKEN_MODIFIERS.indexOf('declaration') : 1 << modifierIndex;
}

class BobeTagColorDecorationController {
  constructor() {
    this.decorationType = undefined;
    this.reload();
  }

  reload() {
    this.disposeDecorationType();
    const color = getConfiguredTagColor();
    if (color) {
      this.decorationType = vscode.window.createTextEditorDecorationType({ color });
    }
    this.refreshVisibleEditors();
  }

  refreshVisibleEditors() {
    vscode.window.visibleTextEditors.forEach(editor => this.refreshEditor(editor));
  }

  refreshDocument(document) {
    vscode.window.visibleTextEditors
      .filter(editor => editor.document === document)
      .forEach(editor => this.refreshEditor(editor));
  }

  refreshEditor(editor) {
    if (!this.decorationType) return;
    if (!SUPPORTED_LANGUAGE_IDS.has(editor.document.languageId)) {
      editor.setDecorations(this.decorationType, []);
      return;
    }
    const ranges = collectBobeTagRanges(editor.document.getText(), { languageId: editor.document.languageId })
      .map(range => {
        const start = editor.document.positionAt(range.start);
        const end = editor.document.positionAt(range.start + range.length);
        return new vscode.Range(start, end);
      });
    editor.setDecorations(this.decorationType, ranges);
  }

  disposeDecorationType() {
    if (this.decorationType) {
      this.decorationType.dispose();
      this.decorationType = undefined;
    }
  }

  dispose() {
    this.disposeDecorationType();
  }
}

function getConfiguredTagColor() {
  const configured = vscode.workspace.getConfiguration('bobe.syntax').get('tagColor', '');
  return typeof configured === 'string' ? configured.trim() : '';
}

function deactivate() {}

module.exports = {
  activate,
  deactivate
};
