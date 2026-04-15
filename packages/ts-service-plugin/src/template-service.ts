import * as ts from 'typescript/lib/tsserverlibrary';
import { log } from './global';
import {
  calcAbsSourceMap,
  calcHeadSourceMap,
  createMemo,
  findPrecedingClassName,
  fixTextSpan,
  getClassMemberNames,
  getRealName,
  getVirtualName,
  inInsBrace,
  isOverlap,
  isVirtualFile
} from './util';
import { sharedEntries, htmlData } from './data/webCustomData';
import { DefinitionInfoAndBoundSpan } from 'typescript/lib/tsserverlibrary';
import { Position, VirtualDocumentResult } from './type';
import { matchIdStart2 } from 'bobe-shared';

/** BobeTemplateService 方法接收的最小 context 对象 */
export interface BobeContext {
  node: ts.TemplateLiteral;
  fileName: string;
  text: string;
  sf: ts.SourceFile;
}

const memoTag = createMemo();
const memoProp = createMemo();
const memoComponentProp = createMemo();
const WHOLE_TEXT = /^\w+$/;
const QUOTE = /'|"/g;
const TAG_TEXT = /(?!(for|if|else))^\w+/;
const PROP_TEXT = /(?:^|\s)([a-zA-Z@\-\[\]\(\)]*)$/;
export class BobeTemplateService {
  constructor(
    public tss: typeof ts,
    public _ls: ts.LanguageService,
    public project: ts.server.Project,
    public getVirtualResult: (virtualFileName: string) => VirtualDocumentResult
  ) {}
  // 这里的 position 是相对于模板内部的偏移量（0 是反引号后的第一个字符）
  getCompletionsAtPosition(context: BobeContext, position: Position): ts.CompletionInfo {
    let entries: ts.CompletionEntry[] = [];
    // 1. 计算光标在 context.text 中的索引
    // 注意：TemplateContext 处理了换行，我们需要将 LineAndCharacter 转为 character offset
    const lines = context.text.split(/\n/);
    const currentLine = lines[position.line];
    const prefix = currentLine.slice(0, position.column).trimStart();
    log('当前行', currentLine);
    log('当前文件', context.fileName);
    log('前置', currentLine.slice(0, position.column));

    /*----------------- 在 {} 内且当前字符不是 '.' -----------------*/
    if (inInsBrace(currentLine, position.column)) {
      const curr = currentLine[position.column - 1];
      if (!['.', '"', "'"].some(c => c === curr)) {
        const name = findPrecedingClassName(context.node, context.sf, this.tss);
        if (name) {
          const keys = getClassMemberNames(name, context.sf, this.tss);
          entries = keys.map((key, i) => ({
            name: key.name!.getText(),
            kind: this.tss.ScriptElementKind.memberVariableElement,
            sortText: `00000000${i}${key}`
          }));
        }
        return { isGlobalCompletion: false, isMemberCompletion: true, isNewIdentifierLocation: false, entries };
      }
    } else {
      /*----------------- 输入位置为标签/关键字 -----------------*/
      if (WHOLE_TEXT.test(prefix)) {
        entries = this.getEntriesByTagPrefix(prefix);
        return { isGlobalCompletion: false, isMemberCompletion: false, isNewIdentifierLocation: false, entries };
      }
      /*----------------- 输入位置为 dom 属性 -----------------*/
      const quoteList = prefix.match(QUOTE) || [];
      const keyMatch = prefix.match(PROP_TEXT);
      const tagName = prefix.match(TAG_TEXT)?.[0];
      if (quoteList.length % 2 === 0 && keyMatch && tagName) {
        const propPrefix = keyMatch[1];
        entries = this.getEntriesByTagPropPrefix(tagName + '.' + propPrefix);

        return { isGlobalCompletion: false, isMemberCompletion: true, isNewIdentifierLocation: false, entries };
      }
    }

    /*----------------- 其余情况使用 虚拟文档模拟 -----------------*/
    const vFileName = getVirtualName(context.fileName);

    // 计算光标在模板字符串内的绝对 offset
    const cursorOffset = position.offset;

    // 从 sourceMap 找到光标所在表达式，映射到虚拟文档的绝对 offset
    const { templates } = this.getVirtualResult(vFileName);
    const map = calcAbsSourceMap(cursorOffset, templates);

    if (map === undefined) {
      return { isGlobalCompletion: false, isMemberCompletion: false, isNewIdentifierLocation: false, entries: [] };
    }

    log('cursorOffset', String(cursorOffset));
    log('virtualOffset', String(map.virtualOffset));

    const comp = this._ls.getCompletionsAtPosition(vFileName, map.virtualOffset, undefined);
    log('虚拟文档模拟', JSON.stringify(comp?.entries[0], undefined, 2));
    log('是否有 hello', String(Boolean(comp?.entries.find(it => it.name === 'hello'))));

    return {
      isGlobalCompletion: false,
      isMemberCompletion: false,
      isNewIdentifierLocation: false,
      entries: comp?.entries || []
    };
  }

  getQuickInfoAtPosition(context: BobeContext, position: Position): ts.QuickInfo | undefined {
    const lines = context.text.split(/\n/);
    const currentLine = lines[position.line];
    const vFileName = getVirtualName(context.fileName);

    // 计算光标在模板字符串内的绝对 offset
    const cursorOffset = position.offset;

    // 从 sourceMap 找到光标所在表达式，映射到虚拟文档的绝对 offset
    const { templates, code } = this.getVirtualResult(vFileName);
    const map = calcAbsSourceMap(cursorOffset, templates);
    if (map === undefined) {
      return undefined;
    }

    const quickInfo = this._ls.getQuickInfoAtPosition(vFileName, map.virtualOffset);
    if (!quickInfo) return undefined;
    const newSpan = fixTextSpan(quickInfo.textSpan, code, map);
    return {
      ...quickInfo,
      textSpan: newSpan
    };
  }
  getDefinitionAndBoundSpan(context: BobeContext, position: Position): DefinitionInfoAndBoundSpan | undefined {
    const lines = context.text.split(/\n/);
    const currentLine = lines[position.line];
    const vFileName = getVirtualName(context.fileName);

    // 计算光标在模板字符串内的绝对 offset
    const cursorOffset = position.offset;

    // 从 sourceMap 找到光标所在表达式，映射到虚拟文档的绝对 offset
    const { templates, sf, code } = this.getVirtualResult(vFileName);
    const map = calcAbsSourceMap(cursorOffset, templates);
    if (map === undefined) {
      return undefined;
    }
    log(code);
    const defineInfo = this._ls.getDefinitionAndBoundSpan(vFileName, map.virtualOffset);
    if (!defineInfo || !defineInfo.definitions) return undefined;
    const definitions: ts.DefinitionInfo[] = [];
    for (const item of defineInfo.definitions) {
      let { fileName, textSpan, ...def } = item;
      let inVirtualPart = false;
      // 默认任务虚拟文档就是当前文档对应的那个虚拟文档
      if (isVirtualFile(fileName)) {
        /*----------------- 在虚拟部分 -----------------*/
        if ((inVirtualPart = textSpan.start > sf!.getFullWidth())) {
          const map = calcHeadSourceMap(textSpan.start, templates);
          if (map) {
            const { definitions: subDefs } = this._ls.getDefinitionAndBoundSpan(vFileName, map.virtualOffset) || {};
            subDefs?.forEach(subDef => {
              definitions.push({
                ...subDef,
                fileName: getRealName(subDef.fileName)
              });
            });
          }
          // 在 head 中找不到的映射，可能映射到了 for 的 item i 表达式，将它们转为模板中的偏移
          else {
            const forMap = calcAbsSourceMap(textSpan.start, templates, true, true);
            if (forMap) {
              definitions.push({
                fileName: getRealName(fileName),
                textSpan: { start: forMap.originStart, length: forMap.length },
                kind: this.tss.ScriptElementKind.constElement,
                name: code.slice(forMap.originStart, forMap.originStart + forMap.length),
                containerKind: this.tss.ScriptElementKind.functionElement,
                containerName: 'bobeForLoop'
              });
            }
          }
        }
        fileName = getRealName(fileName);
      }

      if (!inVirtualPart) {
        const defInfo = {
          fileName,
          textSpan,
          ...def
        };
        definitions.push(defInfo);
      }
    }
    const newSpan = fixTextSpan(defineInfo.textSpan, code, map);
    return {
      definitions,
      textSpan: newSpan
    };
  }

  getEntriesByTagPrefix = memoTag((prefix: string) => {
    const filteredHTMLEntries = htmlData.tags
      .filter(tag => tag.name.startsWith(prefix))
      .map(tag => {
        return {
          name: tag.name,
          kind: this.tss.ScriptElementKind.classElement,
          sortText: `00000000${tag.name}`
        };
      });
    const filteredKeyWordEntries = BobeTemplateService.KeyWordEntries.filter(entry => entry.name.startsWith(prefix));
    return [...filteredHTMLEntries, ...filteredKeyWordEntries];
  });

  getEntriesByTagPropPrefix = memoProp((tagDotProp: string) => {
    const [targetTag, propPrefix] = tagDotProp.split('.');

    const item = htmlData.tags.find(tag => tag.name === targetTag);
    const propEntries =
      item?.attributes
        .filter(prop => prop.name.startsWith(propPrefix))
        .map(prop => {
          return {
            name: prop.name,
            kind: this.tss.ScriptElementKind.memberVariableElement,
            sortText: `00000000${prop.name}`,
            insertText: `${prop.name}='$0'`,
            isSnippet: true
          } as ts.CompletionEntry;
        }) || [];
    log('props 匹配', JSON.stringify(propEntries[0], undefined, 2));
    return [...propEntries, ...sharedEntries];
  });

  getSemanticDiagnostics(context: BobeContext): ts.Diagnostic[] {
    const vFileName = getVirtualName(context.fileName);
    const { templates } = this.getVirtualResult(vFileName);

    // 找到与当前 context 对应的模板（通过 backtick 后第一个字符的绝对 offset 匹配）
    const templateStartInSource = context.node.getStart() + 1;
    const tmpl = templates.find(t => t.templateStartInSource === templateStartInSource);
    if (!tmpl) return [];

    let rawDiags: ts.Diagnostic[];
    try {
      rawDiags = this._ls.getSemanticDiagnostics(vFileName);
    } catch (e) {
      log('getSemanticDiagnostics 异常', String(e));
      return [];
    }
    const result: ts.Diagnostic[] = [];
    for (const diag of rawDiags) {
      if (diag.start === undefined) continue;

      // 反向映射：虚拟文档绝对 offset → 模板内相对 offset（0-based）
      // decorator 会自动加上 context.node.getStart() + 1，所以这里只返回相对值
      let templateRelativeOffset: number | undefined;
      let mappedLength = diag.length ?? 1;

      for (const entry of tmpl.sourceMap) {
        const entryVirtualStart = tmpl.iifeStartInVirtual! + entry.codeOffset;
        const entryVirtualEnd = entryVirtualStart + entry.length;
        if (isOverlap(entryVirtualStart, entryVirtualEnd, diag.start, diag.start + mappedLength)) {
          templateRelativeOffset = entry.originOffset;
          mappedLength = Math.min(mappedLength, entry.length - (diag.start - entryVirtualStart));
          result.push({ ...diag, start: entry.originOffset, length: entry.length });
          break;
        }
      }
    }

    log('getSemanticDiagnostics 映射结果', result.length);
    return result;
  }

  getSyntacticDiagnostics(context: BobeContext): ts.Diagnostic[] {
    const vFileName = getVirtualName(context.fileName);
    const { templates } = this.getVirtualResult(vFileName);

    // 找到与当前 context 对应的模板（通过 backtick 后第一个字符的绝对 offset 匹配）
    const templateStartInSource = context.node.getStart() + 1;
    const tmpl = templates.find(t => t.templateStartInSource === templateStartInSource);
    if (!tmpl || !tmpl.errors.length) return [];
    const { errors } = tmpl;
    const sf = context.sf;
    return errors.map(err => {
      return {
        category: ts.DiagnosticCategory.Error,
        code: err.code,
        messageText: err.message,
        file: sf,
        start: err.loc?.start?.offset - 1,
        length: err.loc?.source?.length,
        source: 'bobe-js'
      } as ts.Diagnostic;
    });
  }

  // getCompletionEntryDetails(context: TemplateContext, position: Position, name: string) {
  //   // 根据 name 返回不同的文档描述
  //   const documentation = this.getDocByName(name);

  //   return {
  //     name: name,
  //     kind: ts.ScriptElementKind.enumElement,
  //     kindModifiers: '',
  //     // 1. 顶部的签名部分（通常显示类型）
  //     displayParts: [
  //       { text: '(property)', kind: 'text' },
  //       { text: ' ', kind: 'space' },
  //       { text: name, kind: 'propertyName' },
  //       { text: ': ', kind: 'punctuation' },
  //       { text: 'string', kind: 'keyword' }
  //     ],
  //     // 2. 中间的主要描述部分（支持多行）
  //     documentation: [{ text: documentation, kind: 'text' }],
  //     // 3. 底部的标签部分（如 @example, @deprecated）
  //     tags: [
  //       {
  //         name: 'example',
  //         text: [{ text: `<input ${name}="text" />`, kind: 'text' }]
  //       }
  //     ]
  //   };
  // }

  // private getDocByName(name: string): string {
  //   const docs: Record<string, string> = {
  //     value: '设置或返回输入框的值。对于文本框，这是用户输入的文本内容。',
  //     oninput: '当用户输入时立即触发的事件。比 onchange 更灵敏。'
  //   };
  //   return docs[name] || '这是 DOM 属性的详细描述。';
  // }

  static KeyWordEntries: ts.CompletionEntry[] = [
    {
      name: 'if',
      kind: ts.ScriptElementKind.keyword,
      sortText: '        1if',
      labelDetails: {
        description: 'bobe if'
      }
    },
    {
      name: 'else',
      kind: ts.ScriptElementKind.keyword,
      sortText: '        2else',
      labelDetails: {
        description: 'bobe else'
      }
    },
    {
      name: 'fail',
      kind: ts.ScriptElementKind.keyword,
      sortText: '        2else',
      labelDetails: {
        description: 'fail 条件渲染'
      }
    },
    {
      name: 'for',
      kind: ts.ScriptElementKind.keyword,
      sortText: '        3for',
      labelDetails: {
        description: 'bobe for'
      }
    }
  ];
  // 辅助方法：根据符号标志返回对应的图标类型
  private getCompletionKind(symbol: ts.Symbol): ts.ScriptElementKind {
    const flags = symbol.getFlags();

    // 如果是函数
    if (flags & this.tss.SymbolFlags.Function) {
      return this.tss.ScriptElementKind.functionElement;
    }

    // 判断是否为 const
    const declarations = symbol.getDeclarations();
    if (declarations && declarations.length > 0) {
      const firstDeclaration = declarations[0];
      // 检查声明节点的父节点（VariableDeclarationList）是否有 NodeFlags.Const
      if (
        firstDeclaration.parent &&
        this.tss.getCombinedNodeFlags(firstDeclaration.parent) & this.tss.NodeFlags.Const
      ) {
        return this.tss.ScriptElementKind.constElement;
      }
    }

    return this.tss.ScriptElementKind.variableElement;
  }
}
