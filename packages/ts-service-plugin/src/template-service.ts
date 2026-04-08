import { TemplateLanguageService, TemplateContext } from 'typescript-template-language-service-decorator';
import * as ts from 'typescript/lib/tsserverlibrary';
import { log, Virtual_File_Suffix } from './global';
import { createMemo, getVirtualName } from './util';
import { sharedEntries, htmlData } from './data/webCustomData';

const memoTag = createMemo();
const memoProp = createMemo();
const memoComponentProp = createMemo();
const WHOLE_TEXT = /^\w+$/;
const QUOTE = /'|"/g;
const TAG_TEXT = /(?!(for|if|else))^\w+/;
const PROP_TEXT = /(?:^|\s)([a-zA-Z@\-\[\]\(\)]*)$/;
export class BobeTemplateService implements TemplateLanguageService {
  constructor(
    public tss: typeof ts,
    public _ls: ts.LanguageService,
    public project: ts.server.Project
  ) {}
  // 这里的 position 是相对于模板内部的偏移量（0 是反引号后的第一个字符）
  getCompletionsAtPosition(context: TemplateContext, position: ts.LineAndCharacter): ts.CompletionInfo {
    let entries: ts.CompletionEntry[] = [];
    this._ls.getCompletionsAtPosition;
    // 1. 计算光标在 context.text 中的索引
    // 注意：TemplateContext 处理了换行，我们需要将 LineAndCharacter 转为 character offset
    const lines = context.text.split(/\n/);
    const currentLine = lines[position.line];
    const prefix = currentLine.slice(0, position.character).trimStart();
    log('当前行', currentLine);
    log('当前文件', context.fileName);
    log('前置', currentLine.slice(0, position.character));
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

    /*----------------- 其余情况使用 虚拟文档模拟 -----------------*/
    const vFileName = getVirtualName(context.fileName);

    const comp = this._ls.getCompletionsAtPosition(vFileName, 7, undefined);
    log('虚拟文档模拟', JSON.stringify(comp?.entries[0], undefined, 2));
    log('是否有 MessageChannel', String(Boolean(comp?.entries.find(it=> it.name==='MessageChannel'))));
    
    return {
      isGlobalCompletion: false,
      isMemberCompletion: false,
      isNewIdentifierLocation: false,
      entries: comp?.entries || []
    };
  }

  /**
   * 辅助方法：简单判断光标是否在 {} 之间
   */
  private isInsideBraces(text: string, offset: number): boolean {
    const beforeText = text.slice(0, offset);
    const afterText = text.slice(offset);

    // 逻辑：向前找最近的 {，且确保这中间没有 }
    const lastOpen = beforeText.lastIndexOf('{');
    const lastClose = beforeText.lastIndexOf('}');

    // 如果没有 { 或者 最近的一个括号是 }，说明不在花括号内
    if (lastOpen === -1 || lastOpen < lastClose) {
      return false;
    }

    // 向后找最近的 }，且确保中间没有 {
    const nextClose = afterText.indexOf('}');
    const nextOpen = afterText.indexOf('{');

    if (nextClose === -1 || (nextOpen !== -1 && nextOpen < nextClose)) {
      return false;
    }

    return true;
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

  // getCompletionEntryDetails(context: TemplateContext, position: ts.LineAndCharacter, name: string) {
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
