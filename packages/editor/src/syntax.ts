export const BOBE_TS_LANGUAGE_ID = 'bobe-ts';
export const BOBE_LANGUAGE_ID = 'bobe';

export const bobeTextMateGrammarPaths = {
  bobe: '../vscode/syntaxes/bobe.tmLanguage.json',
  inline: '../vscode/syntaxes/bobe-inline.tmLanguage.json'
};

export function registerBobeMonacoLanguages(monaco: any) {
  const languages = monaco.languages.getLanguages?.() || [];
  if (!languages.some((item: any) => item.id === BOBE_LANGUAGE_ID)) {
    monaco.languages.register({ id: BOBE_LANGUAGE_ID, extensions: ['.bobe'] });
    monaco.languages.setMonarchTokensProvider(BOBE_LANGUAGE_ID, createBobeTokenizer());
  }
  if (!languages.some((item: any) => item.id === BOBE_TS_LANGUAGE_ID)) {
    monaco.languages.register({ id: BOBE_TS_LANGUAGE_ID, extensions: ['.ts', '.tsx', '.js', '.jsx'] });
    monaco.languages.setMonarchTokensProvider(BOBE_TS_LANGUAGE_ID, createBobeTsTokenizer());
  }
  monaco.languages.setLanguageConfiguration(BOBE_LANGUAGE_ID, {
    comments: { lineComment: '#' },
    brackets: [['{', '}'], ['[', ']'], ['(', ')']],
    autoClosingPairs: [
      { open: '{', close: '}' },
      { open: '[', close: ']' },
      { open: '(', close: ')' },
      { open: '"', close: '"' },
      { open: "'", close: "'" },
      { open: '`', close: '`' }
    ]
  });
}

function createBobeTsTokenizer() {
  return {
    defaultToken: '',
    tokenPostfix: '.bobe-ts',
    keywords: [
      'abstract', 'any', 'as', 'async', 'await', 'boolean', 'break', 'case', 'catch', 'class', 'const',
      'constructor', 'continue', 'default', 'do', 'else', 'export', 'extends', 'false', 'finally', 'for',
      'from', 'function', 'if', 'implements', 'import', 'in', 'interface', 'let', 'new', 'null', 'number',
      'private', 'protected', 'public', 'return', 'static', 'string', 'super', 'switch', 'this', 'true',
      'try', 'type', 'undefined', 'void', 'while'
    ],
    tokenizer: {
      root: [
        [/\bbobe(?=\s*(<[^`]*>)?`)/, { token: 'keyword', next: '@bobeTag' }],
        [/\/\/.*$/, 'comment'],
        [/\/\*/, 'comment', '@comment'],
        [/"([^"\\]|\\.)*$/, 'string.invalid'],
        [/'([^'\\]|\\.)*$/, 'string.invalid'],
        [/"/, 'string', '@stringDouble'],
        [/'/, 'string', '@stringSingle'],
        [/`/, 'string', '@templateString'],
        [/[{}()[\]]/, '@brackets'],
        [/[a-zA-Z_$][\w$]*/, { cases: { '@keywords': 'keyword', '@default': 'identifier' } }],
        [/\d+(\.\d+)?/, 'number'],
        [/[=><!~?:&|+\-*\/\^%]+/, 'operator']
      ],
      bobeTag: [
        [/\s+/, 'white'],
        [/<[^`]*>/, 'type.identifier'],
        [/`/, { token: 'string.delimiter', next: '@bobeTemplateStart' }]
      ],
      bobeTemplateStart: bobeTemplateStartRules('@pop'),
      bobeTemplate: bobeTemplateRules('@pop'),
      bobeComponentExpression: [
        [/\}(?=<)/, { token: 'delimiter.bracket', switchTo: '@bobeComponentTypeArgs' }],
        [/\}/, { token: 'delimiter.bracket', next: '@pop' }],
        [/\/\/.*$/, 'comment'],
        [/\/\*/, 'comment', '@comment'],
        [/"/, 'string', '@stringDouble'],
        [/'/, 'string', '@stringSingle'],
        [/[{}()[\]]/, '@brackets'],
        [/[a-zA-Z_$][\w$]*/, { cases: { '@keywords': 'keyword', '@default': 'identifier' } }],
        [/\d+(\.\d+)?/, 'number'],
        [/[=><!~?:&|+\-*\/\^%]+/, 'operator']
      ],
      bobeComponentTypeArgs: [
        [/=>/, 'operator'],
        [/</, { token: 'type.identifier', next: '@bobeComponentTypeArgs' }],
        [/>/, { token: 'type.identifier', next: '@pop' }],
        [/\/\/.*$/, 'comment'],
        [/\/\*/, 'comment', '@comment'],
        [/"/, 'string', '@stringDouble'],
        [/'/, 'string', '@stringSingle'],
        [/[{}()[\],.;:?]/, '@brackets'],
        [/[a-zA-Z_$][\w$]*/, { cases: { '@keywords': 'keyword', '@default': 'type.identifier' } }],
        [/\d+(\.\d+)?/, 'number'],
        [/[=!~?:&|+\-*\/\^%]+/, 'operator']
      ],
      bobeStringDouble: [[/[^\\"$]+/, 'string'], [/\$\{/, { token: 'delimiter.bracket', next: '@bobeExpression' }], [/\\./, 'string.escape'], [/"/, 'string', '@pop']],
      bobeStringSingle: [[/[^\\'$]+/, 'string'], [/\$\{/, { token: 'delimiter.bracket', next: '@bobeExpression' }], [/\\./, 'string.escape'], [/'/, 'string', '@pop']],
      bobeExpression: [
        [/\}/, { token: 'delimiter.bracket', next: '@pop' }],
        [/\/\/.*$/, 'comment'],
        [/\/\*/, 'comment', '@comment'],
        [/"/, 'string', '@stringDouble'],
        [/'/, 'string', '@stringSingle'],
        [/[{}()[\]]/, '@brackets'],
        [/[a-zA-Z_$][\w$]*/, { cases: { '@keywords': 'keyword', '@default': 'identifier' } }],
        [/\d+(\.\d+)?/, 'number'],
        [/[=><!~?:&|+\-*\/\^%]+/, 'operator']
      ],
      templateString: [
        [/\$\{/, { token: 'delimiter.bracket', next: '@bobeExpression' }],
        [/`/, { token: 'string', next: '@pop' }],
        [/[^`$]+/, 'string'],
        [/./, 'string']
      ],
      stringDouble: [[/[^\\"]+/, 'string'], [/\\./, 'string.escape'], [/"/, 'string', '@pop']],
      stringSingle: [[/[^\\']+/, 'string'], [/\\./, 'string.escape'], [/'/, 'string', '@pop']],
      comment: [[/[^/*]+/, 'comment'], [/\*\//, 'comment', '@pop'], [/[/*]/, 'comment']]
    }
  };
}

function createBobeTokenizer() {
  return {
    defaultToken: '',
    tokenPostfix: '.bobe',
    tokenizer: {
      root: bobeTemplateStartRules(undefined),
      bobeTemplate: bobeTemplateRules(undefined),
      bobeComponentExpression: [
        [/\}(?=<)/, { token: 'delimiter.bracket', switchTo: '@bobeComponentTypeArgs' }],
        [/\}/, { token: 'delimiter.bracket', next: '@pop' }],
        [/\/\/.*$/, 'comment'],
        [/\/\*/, 'comment', '@comment'],
        [/"/, 'string', '@bobeStringDouble'],
        [/'/, 'string', '@bobeStringSingle'],
        [/[{}()[\]]/, '@brackets'],
        [/[a-zA-Z_$][\w$]*/, 'identifier'],
        [/\d+(\.\d+)?/, 'number'],
        [/[=><!~?:&|+\-*\/\^%]+/, 'operator']
      ],
      bobeComponentTypeArgs: [
        [/=>/, 'operator'],
        [/</, { token: 'type.identifier', next: '@bobeComponentTypeArgs' }],
        [/>/, { token: 'type.identifier', next: '@pop' }],
        [/\/\/.*$/, 'comment'],
        [/\/\*/, 'comment', '@comment'],
        [/"/, 'string', '@bobeStringDouble'],
        [/'/, 'string', '@bobeStringSingle'],
        [/[{}()[\],.;:?]/, '@brackets'],
        [/[a-zA-Z_$][\w$]*/, 'type.identifier'],
        [/\d+(\.\d+)?/, 'number'],
        [/[=!~?:&|+\-*\/\^%]+/, 'operator']
      ],
      bobeExpression: [
        [/\}/, { token: 'delimiter.bracket', next: '@pop' }],
        [/\/\/.*$/, 'comment'],
        [/\/\*/, 'comment', '@comment'],
        [/"/, 'string', '@bobeStringDouble'],
        [/'/, 'string', '@bobeStringSingle'],
        [/[{}()[\]]/, '@brackets'],
        [/[a-zA-Z_$][\w$]*/, 'identifier'],
        [/\d+(\.\d+)?/, 'number'],
        [/[=><!~?:&|+\-*\/\^%]+/, 'operator']
      ],
      bobeStringDouble: [[/[^\\"$]+/, 'string'], [/\$\{/, { token: 'delimiter.bracket', next: '@bobeExpression' }], [/\\./, 'string.escape'], [/"/, 'string', '@pop']],
      bobeStringSingle: [[/[^\\'$]+/, 'string'], [/\$\{/, { token: 'delimiter.bracket', next: '@bobeExpression' }], [/\\./, 'string.escape'], [/'/, 'string', '@pop']],
      comment: [[/[^/*]+/, 'comment'], [/\*\//, 'comment', '@pop'], [/[/*]/, 'comment']]
    }
  };
}

function bobeTemplateStartRules(popOnBacktick: string | undefined) {
  return [
    [/\s+/, 'white'],
    [/(?!(?:if|else|for|tp|context)\b)[a-z][\w-]*(?:-[a-z][\w-]*)*/, { token: 'tag', switchTo: '@bobeTemplate' }],
    [/./, { token: '', goBack: 1, switchTo: '@bobeTemplate' }]
  ];
}

function bobeTemplateRules(popOnBacktick: string | undefined) {
  const rules: any[] = [
    [/\$\{/, { token: 'delimiter.bracket', next: '@bobeComponentExpression' }],
    [/(?<==)\{/, { token: 'delimiter.bracket', next: '@bobeExpression' }],
    [/#.*$/, 'comment'],
    [/^\s*(if|else|for|tp|context)\b/, 'keyword'],
    [/^\s*(?!(?:if|else|for|tp|context)\b)[a-z][\w-]*(?:-[a-z][\w-]*)*/, 'tag'],
    [/\b[a-zA-Z_:@.#[\]-][\w:@.#[\]-]*(?=\s*=)/, 'attribute.name'],
    [/"/, 'string', '@bobeStringDouble'],
    [/'/, 'string', '@bobeStringSingle'],
    [/\b\d+(\.\d+)?\b/, 'number'],
    [/[=;|]/, 'operator']
  ];
  if (popOnBacktick) {
    rules.unshift([/`/, { token: 'string.delimiter', next: popOnBacktick }]);
  }
  rules.push([/[^`$#"'=;|{}]+/, '']);
  return rules;
}
