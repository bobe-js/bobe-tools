import * as ts from 'typescript/lib/tsserverlibrary';
import { log } from 'bobe-language-core';
import {
  AND,
  calcAbsSourceMap,
  createMemo,
  findTemplateTypePos,
  fixTextSpan,
  getRealName,
  getSharedItems,
  getVirtualName,
  inVirtualPart,
  inWitchVirtualPart,
  isOverlap,
  isVirtualFile,
  uniqBy
} from 'bobe-language-core';
import { sharedEntries, htmlData } from './data/webCustomData';
import { DefinitionInfoAndBoundSpan } from 'typescript/lib/tsserverlibrary';
import { Position, VirtualDocumentResult, BOBE_PREFIX } from 'bobe-language-core';

/** BobeTemplateService 方法接收的最小 context 对象 */
export interface BobeContext {
  node: ts.TemplateLiteral;
  fileName: string;
  text: string;
  sf: ts.SourceFile;
}

const memoTag = createMemo();
const memoProp = createMemo();
const WHOLE_TEXT = /^\w+$/;
const QUOTE = /'|"/g;
const TAG_TEXT = /(?!(for|if|else))^\w+/;
const PROP_TEXT = /(?:^|\s)([a-zA-Z@\-\[\]\(\)]*)$/;
export class BobeTemplateService {
  constructor(
    public tss: typeof ts,
    public _ls: ts.LanguageService,
    public project: ts.server.Project,
    public getVirtualResult: (virtualFileName: string) => VirtualDocumentResult,
    public info: ts.server.PluginCreateInfo
  ) {}
  // 这里的 position 是相对于模板内部的偏移量（0 是反引号后的第一个字符）
  getCompletionsAtPosition(context: BobeContext, position: Position, absOffset: number): ts.CompletionInfo {
    let entries: ts.CompletionEntry[] = [];
    // 1. 计算光标在 context.text 中的索引
    // 注意：TemplateContext 处理了换行，我们需要将 LineAndCharacter 转为 character offset
    const lines = context.text.split(/\n/);
    const currentLine = lines[position.line];
    const prefix = currentLine.slice(0, position.column).trimStart();
    log('当前行', currentLine);
    log('当前文件', context.fileName);
    log('前置', currentLine.slice(0, position.column));

    /*----------------- 其余情况使用 虚拟文档模拟 -----------------*/
    const vFileName = getVirtualName(context.fileName);

    // 计算光标在模板字符串内的绝对 offset
    const cursorOffset = position.offset;

    // 从 sourceMap 找到光标所在表达式，映射到虚拟文档的绝对 offset
    const { templates } = this.getVirtualResult(vFileName);
    const map = calcAbsSourceMap(absOffset, templates);

    if (map === undefined) {
      return { isGlobalCompletion: false, isMemberCompletion: false, isNewIdentifierLocation: false, entries: [] };
    }

    log('cursorOffset', String(cursorOffset));
    log('virtualOffset', String(map.virtualOffset));

    const comp = this._ls.getCompletionsAtPosition(vFileName, map.virtualOffset, undefined);
    log('虚拟文档模拟', JSON.stringify(comp?.entries[0], undefined, 2));
    log('是否有 item', String(Boolean(comp?.entries.find(it => it.name === 'item'))));

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
      entries = this.getEntriesByTagPropPrefix(tagName + AND + propPrefix);

      return { isGlobalCompletion: false, isMemberCompletion: true, isNewIdentifierLocation: false, entries };
    }

    entries = comp?.entries.filter((it) => !it.name.startsWith(BOBE_PREFIX)) || []

    return {
      isGlobalCompletion: false,
      isMemberCompletion: false,
      isNewIdentifierLocation: false,
      entries,
    };
  }

  getQuickInfoAtPosition(context: BobeContext, position: Position, absOffset: number): ts.QuickInfo | undefined {
    const lines = context.text.split(/\n/);
    const currentLine = lines[position.line];
    const vFileName = getVirtualName(context.fileName);

    // 计算光标在模板字符串内的绝对 offset
    const cursorOffset = position.offset;

    // 从 sourceMap 找到光标所在表达式，映射到虚拟文档的绝对 offset
    const { templates, code } = this.getVirtualResult(vFileName);
    const map = calcAbsSourceMap(absOffset, templates);
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
  getDefinitionAndBoundSpan(
    context: BobeContext,
    position: Position,
    absOffset: number
  ): DefinitionInfoAndBoundSpan | undefined {
    const vFileName = getVirtualName(context.fileName);

    // 计算光标在模板字符串内的绝对 offset
    const cursorOffset = position.offset;

    // 从 sourceMap 找到光标所在表达式，映射到虚拟文档的绝对 offset
    const { templates, sf, code } = this.getVirtualResult(vFileName);
    const map = calcAbsSourceMap(absOffset, templates);
    if (map === undefined) {
      return undefined;
    }
    log(code);
    const defineInfo = this._ls.getDefinitionAndBoundSpan(vFileName, map.virtualOffset);
    if (!defineInfo || !defineInfo.definitions) return undefined;
    const definitions: ts.DefinitionInfo[] = [];
    for (const item of defineInfo.definitions) {
      let { fileName, textSpan, ...def } = item;
      let _inVirtualPart = false;
      // 默认任务虚拟文档就是当前文档对应的那个虚拟文档
      if (isVirtualFile(fileName)) {
        /*----------------- 在虚拟部分 -----------------*/
        if ((_inVirtualPart = inVirtualPart(sf!, textSpan))) {
          const { template, range, part } = inWitchVirtualPart(textSpan.start, templates);
          if (part === 'headClass') {
            // 找定义时要往前查找，应该找 name: 这个位置
            const { definitions: subDefs } = this._ls.getDefinitionAndBoundSpan(vFileName, range!.start) || {};
            subDefs?.forEach(subDef => {
              definitions.push({
                ...subDef,
                fileName: getRealName(subDef.fileName)
              });
            });
          } else if (part === 'headTemplate') {
            const { definitions: subDefs } = this._ls.getDefinitionAndBoundSpan(vFileName, range!.start) || {};
            subDefs?.forEach(({ fileName, textSpan, ...subDef }) => {
              const typeMap = template.typeMap!;
              const { codeOffset, length, originOffset } = typeMap;
              // 1. 找到的仍然在虚拟文档复制的 类型字面量位置，需要转换回原始位置
              if (isVirtualFile(fileName) && textSpan.start >= codeOffset && textSpan.start < codeOffset + length) {
                const spanLen = textSpan.length;
                textSpan = {
                  start: originOffset + textSpan.start - codeOffset,
                  length: spanLen
                };
              }
              // 2. 其余位置只修改 fileName
              definitions.push({
                fileName: getRealName(fileName),
                textSpan,
                ...subDef
              });
            });
          }
          // 在 head 中找不到的映射，可能映射到了 for 的 item i 表达式，将它们转为模板中的偏移
          else {
            const forMap = calcAbsSourceMap(textSpan.start, templates, true);
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

      if (!_inVirtualPart) {
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

  findReferences(fileName: string, position: number) {
    /*----------------- 有 bobe 模板语法的文件 -----------------*/
    const vFileName = getVirtualName(fileName);
    const { templates, sf, code } = this.getVirtualResult(vFileName);
    let refs = this._ls.findReferences(vFileName, position);
    const typeVOffset = findTemplateTypePos(templates, position);
    if (typeVOffset) {
      const additions = this._ls.findReferences(vFileName, typeVOffset.virtualOffset);
      if (additions?.length) {
        if (!refs) {
          refs = additions;
        } else {
          // TS 无法在闭包内窄化 let，用 const 快照供闭包访问
          const refsArr = refs;
          const typeOriginEnd = typeVOffset.originStart + typeVOffset.length;
          const typeVirtualEnd = typeVOffset.virtualStart + typeVOffset.length;
          // 预建索引：fileName+textSpan → refs 下标，用于规则 1 的 O(1) 查找
          const refsIndex = new Map<string, number>();
          // 预收集 definition 落在真实文件 type 范围内的 refs 下标，用于规则 2
          const refsInType: number[] = [];
          for (let i = 0; i < refsArr.length; i++) {
            const d = refsArr[i].definition;
            refsIndex.set(`${d.fileName}::${d.textSpan.start}::${d.textSpan.length}`, i);
            const defEnd = d.textSpan.start + d.textSpan.length;
            if (isOverlap(d.textSpan.start, defEnd, typeVOffset.originStart, typeOriginEnd)) {
              refsInType.push(i);
            }
          }

          for (const addSym of additions) {
            const { definition: addDef, references: addRefs } = addSym;
            const addDefEnd = addDef.textSpan.start + addDef.textSpan.length;
            // 规则 1：同一文件 + 同一位置 的 definition 直接视为同一个符号
            let matchIdx = refsIndex.get(`${addDef.fileName}::${addDef.textSpan.start}::${addDef.textSpan.length}`);
            // 规则 2：addDef 落在虚拟文件的 type 范围内，且 refDef 落在真实文件的 type 范围内
            // 说明二者是 bobe<SomeType> 中类型表达式在原文件与虚拟文件的两份映射，属于同一符号
            if (matchIdx === undefined) {
              if (isOverlap(addDef.textSpan.start, addDefEnd, typeVOffset.virtualStart, typeVirtualEnd)) {
                matchIdx = refsInType.find(i => {
                  const refDef = refsArr[i].definition;
                  const refDefEnd = refDef.textSpan.start + refDef.textSpan.length;
                  return isOverlap(refDef.textSpan.start, refDefEnd, typeVOffset.originStart, typeOriginEnd);
                });
              }
            }
            // 二次判断
            if (matchIdx !== undefined) {
              refsArr[matchIdx].references.push(...addRefs);
            } else {
              refsArr.push(addSym);
            }
          }
          // 合并后按 文件+坐标 对 references 去重
          refs = refsArr.map(sym => ({
            ...sym,
            references: uniqBy(
              sym.references,
              (r: ts.ReferencedSymbolEntry) => `${r.fileName}::${r.textSpan.start}::${r.textSpan.length}`
            )
          }));
        }
      }
    }
    const newResult = refs?.map(({ definition, references }) => {
      // 是虚拟文件中的 定义
      if (isVirtualFile(definition.fileName)) definition.fileName = fileName;
      const newRefs: ts.ReferencedSymbolEntry[] = [];

      references.forEach(ref => {
        // 是虚拟文件中的引用
        if (isVirtualFile(ref.fileName)) {
          ref.fileName = fileName;
          // 是生成的 IIFE 块中的引用
          if (inVirtualPart(sf!, ref.textSpan)) {
            // 1. head 中，因为解构的原因需要 二次查询 map 位置的引用
            const { range, part } = inWitchVirtualPart(ref.textSpan.start, templates);
            if (part) {
              const found = this._ls.findReferences(vFileName, (range!.start + range!.end) >> 1);
              found?.forEach(({ references }) => {
                references.forEach(subRef => {
                  const subTmplMap = calcAbsSourceMap(subRef.textSpan.start, templates, true);
                  if (subTmplMap) {
                    subRef.textSpan = fixTextSpan(subRef.textSpan, code, subTmplMap);
                    // 把所有 引用都映射到模板字符串中
                    subRef.fileName = fileName;
                    newRefs.push(subRef);
                  }
                });
              });
              // subRef 将代替原引用，所以原引用不应该被加入 newRefs
              return;
            }
            // 2. sourceMap 中 修正 span 即可
            else {
              const tmplMap = calcAbsSourceMap(ref.textSpan.start, templates, true);
              if (tmplMap) {
                const newSpan = fixTextSpan(ref.textSpan, code, tmplMap);
                ref.textSpan = newSpan;
              }
              // 不在 head 也不在 sourceMap 中，无法完成映射，
              // 🌰： 重命名 bobe<{ foo: number }> 中的 foo
              // 因为拷贝 { foo: number }， 此时会多一个虚拟部分的 foo 引用，它不需要映射
              else {
                return;
              }
            }
          }
          newRefs.push(ref);
        }
        // 不是虚拟文件中的引用
        else {
          newRefs.push(ref);
        }
      });
      return {
        definition,
        references: newRefs
      };
    });
    return newResult;
  }
  findRenameLocations(
    rawFileName: string,
    position: number,
    findInStrings: boolean,
    findInComments: boolean,
    preferences: ts.UserPreferences
  ) {
    /*----------------- 有 bobe 模板语法的文件 -----------------*/
    const vFileName = getVirtualName(rawFileName);
    const { templates, sf, code } = this.getVirtualResult(vFileName);
    let locations = this._ls.findRenameLocations(vFileName, position, findInStrings, findInComments, preferences);
    const typeVOffset = findTemplateTypePos(templates, position);
    if (typeVOffset) {
      const additions = this._ls.findRenameLocations(
        vFileName,
        typeVOffset.virtualOffset,
        findInStrings,
        findInComments,
        preferences
      );
      locations = [...(locations || []), ...(additions || [])];
      locations = uniqBy(
        locations as ts.RenameLocation[],
        location => `${getRealName(location.fileName)} ${location.textSpan.start} ${location.textSpan.length}`
      );
    }
    const newLocations: ts.RenameLocation[] = [];

    locations?.forEach(({ fileName, textSpan, ...location }) => {
      // 是虚拟文件中的引用
      if (isVirtualFile(fileName)) {
        fileName = rawFileName;
        // 是生成的 IIFE 块中的引用
        if (inVirtualPart(sf!, textSpan)) {
          // 1. head 中，因为解构的原因需要 二次查询 map 位置的引用
          const { range, part } = inWitchVirtualPart(textSpan.start, templates);
          if (part) {
            const found = this._ls.findRenameLocations(
              vFileName,
              (range!.start + range!.end) >> 1,
              findInStrings,
              findInComments,
              preferences
            );
            found?.forEach(subLocation => {
              const subTmplMap = calcAbsSourceMap(subLocation.textSpan.start, templates, true);
              if (subTmplMap) {
                subLocation.textSpan = fixTextSpan(subLocation.textSpan, code, subTmplMap);
                // 把所有 引用都映射到模板字符串中
                subLocation.fileName = rawFileName;
                newLocations.push(subLocation);
              }
            });
            // subRef 将代替原引用，所以原引用不应该被加入 newRefs
            return;
          }
          // 2. sourceMap 中 修正 span 即可
          else {
            const tmplMap = calcAbsSourceMap(textSpan.start, templates, true);
            if (tmplMap) {
              const newSpan = fixTextSpan(textSpan, code, tmplMap);
              textSpan = newSpan;
            }
            // 不在 head 也不在 sourceMap 中，无法完成映射，
            // 🌰： 重命名 bobe<{ foo: number }> 中的 foo
            // 此时会多一个虚拟部分的 foo 引用，它不需要映射
            else {
              return;
            }
          }
        }
      }
      newLocations.push({ ...location, fileName, textSpan });
    });
    return newLocations;
  }

  // TODO: findRenameLocations
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
    const [targetTag, propPrefix] = tagDotProp.split(AND);

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
    const tmpl = templates.find(t => t.templateStart === templateStartInSource);
    if (!tmpl) return [];

    let rawDiags: ts.Diagnostic[];
    try {
      rawDiags = this._ls.getSemanticDiagnostics(vFileName);
    } catch (e) {
      log('getSemanticDiagnostics 异常', String(e));
      return [];
    }
    const result: ts.Diagnostic[] = [];
    rawDiags.sort((a, b) => a.start! - b.start!);
    const gen = getSharedItems(
      rawDiags,
      tmpl.sourceMap,
      (diag, entry) => {
        if (diag.start === undefined) return false;
        const entryVirtualStart = entry.codeOffset;
        return isOverlap(
          entryVirtualStart,
          entryVirtualStart + entry.length,
          diag.start,
          diag.start + (diag.length ?? 1)
        );
      },
      (diag, entry) => {
        // diag 较小会跳过
        if (diag.start === undefined) return false;
        return diag.start > entry.codeOffset;
      }
    );
    let iterRes = gen.next();
    while (!iterRes.done) {
      const [diag, entry] = iterRes.value;
      const dtStart = diag.start! - entry.codeOffset;
      if (dtStart >= 0) {
        result.push({ ...diag, start: entry.originOffset + dtStart, length: diag.length });
      } else {
        result.push({ ...diag, start: entry.originOffset, length: entry.length });
      }
      iterRes = gen.next();
    }

    // for (const diag of rawDiags) {
    //   if (diag.start === undefined) continue;

    //   // 反向映射：虚拟文档绝对 offset → 模板内相对 offset（0-based）
    //   // decorator 会自动加上 context.node.getStart() + 1，所以这里只返回相对值
    //   let templateRelativeOffset: number | undefined;
    //   let mappedLength = diag.length ?? 1;

    //   for (const entry of tmpl.sourceMap) {
    //     const entryVirtualStart = tmpl.iifeStartInVirtual! + entry.codeOffset;
    //     const entryVirtualEnd = entryVirtualStart + entry.length;
    //     if (isOverlap(entryVirtualStart, entryVirtualEnd, diag.start, diag.start + mappedLength)) {
    //       templateRelativeOffset = entry.originOffset;
    //       mappedLength = Math.min(mappedLength, entry.length - (diag.start - entryVirtualStart));
    //       result.push({ ...diag, start: entry.originOffset, length: entry.length });
    //       break;
    //     }
    //   }
    // }

    log('getSemanticDiagnostics 映射结果', result.length);
    return result;
  }

  getSyntacticDiagnostics(context: BobeContext): ts.Diagnostic[] {
    const vFileName = getVirtualName(context.fileName);
    const { templates } = this.getVirtualResult(vFileName);

    // 找到与当前 context 对应的模板（通过 反引号 后第一个字符的绝对 offset 匹配）
    const templateStartInSource = context.node.getStart() + 1;
    const tmpl = templates.find(t => t.templateStart === templateStartInSource);
    if (!tmpl || !tmpl.errors.length) return [];
    const { errors } = tmpl;
    const sf = context.sf;
    return errors.map(err => {
      return {
        category: ts.DiagnosticCategory.Error,
        code: err.code,
        messageText: err.message,
        file: sf,
        start: templateStartInSource + err.loc?.start?.offset - 1,
        length: err.loc?.source?.length,
        source: 'bobe-js'
      } as ts.Diagnostic;
    });
  }

  // getCompletionEntryDetails(context: TemplateContext, position: Position, absOffset: number, name: string) {
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
    },
    {
      name: 'context',
      kind: ts.ScriptElementKind.keyword,
      sortText: '        4context',
      labelDetails: {
        description: 'bobe context'
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
