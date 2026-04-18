import * as ts from 'typescript/lib/tsserverlibrary';
import { Virtual_File_Exp, Virtual_File_Suffix } from './global';
import { AbsMap, BobeTemplateInfo, HeadMap, SourceMapEntry } from './type';
import { jsVarRegexp, matchId, matchIdStart2 } from 'bobe-shared';
import { SourceLocation } from 'bobe';

export function isBobeTaggedTemplate(node: ts.TaggedTemplateExpression, tss: typeof ts): boolean {
  return tss.isIdentifier(node.tag) && node.tag.text === 'bobe';
}

export function sfHasBobeTemplate(sf: ts.SourceFile, tss: typeof ts) {
  let hasBobe = false;
  function visit(node: ts.Node) {
    if (tss.isTaggedTemplateExpression(node) && isBobeTaggedTemplate(node, tss) && !hasBobe) {
      hasBobe = true;
    } else {
      tss.forEachChild(node, visit);
    }
  }
  visit(sf);
  return hasBobe;
}

export class LRUCache<K = string, V = any> {
  private maxSize: number;
  private cache: Map<K, V> = new Map();

  constructor(maxSize: number) {
    this.maxSize = maxSize;
  }

  get(key: K): V | undefined {
    if (!this.cache.has(key)) {
      return undefined; // 如果缓存中没有该键，返回 -1
    }

    // 将该键值对移动到 Map 的末尾，表示它是最近使用的
    const value = this.cache.get(key)!;
    this.cache.delete(key); // 先删除
    this.cache.set(key, value); // 再插入到末尾
    return value;
  }

  set(key: K, value: V): void {
    if (this.cache.has(key)) {
      // 更新已有的键值对，并将其移动到末尾
      this.cache.delete(key);
      this.cache.set(key, value);
    } else {
      // 如果缓存已满，移除最久未使用的元素
      if (this.cache.size >= this.maxSize) {
        // Map 会保持插入顺序，删除最前面的键值对
        this.cache.delete(this.cache.keys().next().value!);
      }
      this.cache.set(key, value);
    }
  }

  // 新增 has 方法，检查某个键是否在缓存中
  has = this.cache.has.bind(this.cache) as typeof this.cache.has;

  delete = this.cache.delete.bind(this.cache) as typeof this.cache.delete;
}
export type SingleArgFn = (v: any) => any;

const cache = new LRUCache<any, any>(1000);
export function memo<T extends SingleArgFn>(fn: T): T {
  const wrap = (v: Parameters<T>) => {
    const res = fn(v);
    cache.set(v, res);
    return res;
  };
  return wrap as T;
}

export function createMemo() {
  const cache = new LRUCache<any, any>(1000);
  return function memo<T extends SingleArgFn>(fn: T): T {
    const wrap = (v: Parameters<T>) => {
      const res = fn(v);
      cache.set(v, res);
      return res;
    };
    return wrap as T;
  };
}

export function getVirtualName(fileName: string) {
  const dotI = fileName.lastIndexOf('.');
  const rawName = fileName.slice(0, dotI);
  const suffix = fileName.slice(dotI);
  return rawName + Virtual_File_Suffix + suffix;
}

export function getRealName(virtualFileName: string) {
  return virtualFileName.replace(Virtual_File_Exp, '');
}

export function isVirtualFile(fileName: string) {
  return fileName.match(Virtual_File_Exp);
}

/**
 * s1    e1
 * 0  1
 *    1  2
 *    s2    e2
 */
export function isOverlap(start1: number, end1: number, start2: number, end2: number) {
  return start1 < end2 && start2 < end1;
}

/** 判断在 {} 内 */
export function inInsBrace(content: string, targetIndex: number): boolean {
  let stack: ('block' | 'expression')[] = [];

  for (let i = 0; i < content.length; i++) {
    // 在检查状态之前，先判断是否到达了目标索引
    if (i === targetIndex) {
      // 判断标准：
      // 1. 栈不为空（表示在某类括号内）
      // 2. 栈顶必须是 'block'，不能是 'expression'
      return stack.length > 0 && stack[stack.length - 1] === 'block';
    }

    const char = content[i];
    const nextChar = content[i + 1];

    // 1. 识别 ${
    if (char === '$' && nextChar === '{') {
      stack.push('expression');
      i++; // 跳过 '{'，避免下次循环重复处理
      continue;
    }

    // 2. 识别普通的 {
    if (char === '{') {
      stack.push('block');
      continue;
    }

    // 3. 识别 }
    if (char === '}') {
      stack.pop();
      continue;
    }
  }

  return false;
}

/** 获取当前节点最近的类名 */
export function findPrecedingClassName(
  targetNode: ts.Node,
  sourceFile: ts.SourceFile,
  tss: typeof ts
): string | undefined {
  let result: string | undefined;
  function visit(node: ts.Node) {
    if (node.pos >= targetNode.pos) return;
    if ((tss.isClassDeclaration(node) || tss.isClassExpression(node)) && node.name) {
      result = node.name.text;
    }
    tss.forEachChild(node, visit);
  }
  visit(sourceFile);
  return result;
}
/** 根据类名获取成员名称列表 */
export function getClassMemberNames(className: string, sourceFile: ts.SourceFile, tss: typeof ts): ts.ClassElement[] {
  const names: ts.ClassElement[] = [];
  function visit(node: ts.Node) {
    if ((tss.isClassDeclaration(node) || tss.isClassExpression(node)) && node.name?.text === className) {
      for (const member of node.members) {
        if (isClassProp(member, tss)) {
          names.push(member);
        }
      }
      return;
    }
    tss.forEachChild(node, visit);
  }
  visit(sourceFile);
  return names;
}

export function calcAbsSourceMap(cursorOffset: number, templates: BobeTemplateInfo[], isVirtualCursor = false) {
  let virtualStart: number | undefined;
  let originStart: number, length: number;
  const compareKey = isVirtualCursor ? 'codeOffset' : 'originOffset';
  const baseKey = isVirtualCursor ? 'iifeStartInVirtual' : 'templateStartInSource';
  for (let i = templates.length; i--; ) {
    const tmpl = templates[i];
    // 比当前 tmpl 起始位置小，不属于这个模板
    if (cursorOffset < tmpl[baseKey]!) continue;
    for (const entry of tmpl.sourceMap) {
      const eStart = tmpl[baseKey]! + entry[compareKey];
      const eEnd = eStart + entry.length;
      if (cursorOffset >= eStart && cursorOffset <= eEnd) {
        virtualStart = tmpl.iifeStartInVirtual! + entry.codeOffset;
        originStart = tmpl.templateStartInSource + entry.originOffset;
        const dt = cursorOffset - eStart;
        length = entry.length;
        return {
          virtualStart,
          originStart,
          virtualOffset: virtualStart + dt,
          originOffset: originStart + dt,
          length
        };
      }
    }
  }
}
/** 计算的是 IIFE 中 解构的 所有类成员的 映射*/
export function calcHeadSourceMap(absCursorOffset: number, templates: BobeTemplateInfo[]) {
  let virtualStart: number | undefined;
  let originStart: number, length: number;
  for (const tmpl of templates) {
    if (!inVirtualHead(tmpl.headMap, { start: absCursorOffset } as any, tmpl)) continue;
    const cursorOffset = absCursorOffset - tmpl.iifeStartInVirtual!;
    for (const entry of tmpl.headMap) {
      if (cursorOffset >= entry.codeOffset && cursorOffset <= entry.codeOffset + entry.length) {
        virtualStart = tmpl.iifeStartInVirtual! + entry.codeOffset;
        originStart = entry.originOffset;
        const dt = cursorOffset - entry.codeOffset;
        length = entry.length;
        return {
          virtualStart,
          originStart,
          virtualOffset: virtualStart + dt,
          originOffset: originStart + dt,
          length
        };
      }
    }
  }
}

/**
 * 1. 插值表达式中的 js 标识符 如 tag prop={ a ? foo : bar } 中的 bar
 * 2. 完整的标识符，如 tag prop=xxx 中的 prop
 */
export function fixTextSpan(textSpan: ts.TextSpan, code: string, map: AbsMap) {
  const originalCode = code.slice(map.originStart, map.originStart + map.length);
  /** 当内容为 js 标识符 且 textSpan 是插值表达式中的一部分时
   * span.start ~ virtualOffset 和
   * targetStart ~ originOffset 是相同的
   * 因此 targetStart = originOffset - (virtualOffset - span.start)
   */
  if (textSpan.length < map.length && !originalCode.match(domPropertyExp)) {
    const { start, length } = textSpan;
    const targetStart = map.originOffset - (map.virtualOffset - start);
    return { start: targetStart, length };
  }

  // 其余情况直接返回完整的原始标识符
  return { start: map.originStart, length: map.length };
}

export function getPosTemplateCtx(
  info: ts.server.PluginCreateInfo,
  tss: typeof ts,
  fileName: string,
  position: number
) {
  const sf = info.languageService.getProgram()?.getSourceFile(fileName);
  if (!sf) return null;
  const node = findNodeAtPosition(tss, sf, position);
  if (!node) return null;
  const templateNode = getValidBobeTemplateNode(tss, node);
  if (!templateNode || position <= templateNode.pos) return null;
  const baseOffset = templateNode.getStart() + 1;
  const ctx = makeContext(templateNode, sf, fileName, baseOffset);
  const relPos = getRelativePosition(info, baseOffset, fileName, position); // 这里找到了相对第二个模板的开始位置
  return { ctx, relPos: relPos as SourceLocation['start'] };
}

export function getSourceFileAndNode(
  info: ts.server.PluginCreateInfo,
  tss: typeof ts,
  fileName: string,
  position: number
) {
  const sf = info.languageService.getProgram()?.getSourceFile(fileName);
  if (!sf) return null;
  const node = findNodeAtPosition(tss, sf, position);
  if (!node) return null;
  return { sf, node };
}

// 判断节点是否属于 bobe 标签模板，返回模板字面量节点
export function getValidBobeTemplateNode(tss: typeof ts, node: ts.Node): ts.TemplateLiteral | undefined {
  switch (node.kind) {
    case tss.SyntaxKind.TaggedTemplateExpression: {
      const t = node as ts.TaggedTemplateExpression;
      return isBobeTaggedTemplate(t, tss) ? t.template : undefined;
    }
    case tss.SyntaxKind.NoSubstitutionTemplateLiteral: {
      const p = node.parent;
      return p && tss.isTaggedTemplateExpression(p) && isBobeTaggedTemplate(p, tss)
        ? (node as ts.NoSubstitutionTemplateLiteral)
        : undefined;
    }
    case tss.SyntaxKind.TemplateHead:
      return node.parent?.parent ? getValidBobeTemplateNode(tss, node.parent.parent) : undefined;
    case tss.SyntaxKind.TemplateMiddle:
    case tss.SyntaxKind.TemplateTail:
      return node.parent?.parent?.parent ? getValidBobeTemplateNode(tss, node.parent.parent.parent) : undefined;
    default:
      return undefined;
  }
}

/** 将文件绝对 offset 转换为相对模板开头 ` 的偏移量 */
export function getRelativePosition(
  info: ts.server.PluginCreateInfo,
  baseOffset: number,
  fileName: string,
  position: number
): SourceLocation['start'] {
  const scriptInfo = info.project.getScriptInfo(fileName);
  if (!scriptInfo) return { line: 0, column: 0, offset: position - baseOffset };
  const baseLoc = scriptInfo.positionToLineOffset(baseOffset); // 1-based
  const cursorLoc = scriptInfo.positionToLineOffset(position);
  const bl = baseLoc.line - 1,
    bc = baseLoc.offset - 1;
  const cl = cursorLoc.line - 1,
    cc = cursorLoc.offset - 1;
  return { line: cl - bl, column: cl === bl ? cc - bc : cc, offset: position - baseOffset };
}

// 构造最小 context 对象（BobeTemplateService 只用 node、fileName、text）
export function makeContext(templateNode: ts.TemplateLiteral, sf: ts.SourceFile, fileName: string, baseOffset: number) {
  return { node: templateNode, fileName, text: templateNode.getText().slice(1, -1), sf, baseOffset };
}

// 在 AST 中找到 position 处最深的节点
export function findNodeAtPosition(tss: typeof ts, sf: ts.SourceFile, position: number): ts.Node | undefined {
  function find(node: ts.Node): ts.Node | undefined {
    if (position >= node.getStart() && position < node.getEnd()) {
      return tss.forEachChild(node, find) || node;
    }
    return undefined;
  }
  return find(sf);
}

export const domPropertyExp = /^[a-zA-Z][\w-]*$/;

export const AND = `__BOBE_AND_${Date.now().toString(36)}__`;

export function isClassProp(node: ts.Node, tss: typeof ts) {
  return tss.isPropertyDeclaration(node) || (tss.isMethodDeclaration(node) && tss.isIdentifier(node.name));
}

export function* getSharedItems<A, B>(
  arr1: A[],
  arr2: B[],
  isEqual: (a: A, b: B) => boolean,
  isBigger: (a: A, b: B) => boolean
) {
  const it1 = arr1[Symbol.iterator]();
  const it2 = arr2[Symbol.iterator]();

  let res1 = it1.next();
  let res2 = it2.next();

  while (!res1.done && !res2.done) {
    const v1 = res1.value;
    const v2 = res2.value;

    // 始终保持 v1 在前，v2 在后
    if (isEqual(v1, v2)) {
      yield [v1, v2] as const; // 或者根据需求 yield { v1, v2 }
      res1 = it1.next();
      res2 = it2.next();
    } else if (isBigger(v1, v2)) {
      // v1 > v2: 因为是递增数组，说明 v2 太小了，需要移动 arr2 的指针
      res2 = it2.next();
    } else {
      // v1 < v2: 说明 v1 太小了，移动 arr1 的指针
      res1 = it1.next();
    }
  }
}

export const inVirtualPart = (sf: ts.SourceFile, textSpan: ts.TextSpan) => textSpan.start > sf.getFullWidth();
export const inVirtualHead = (headMap: HeadMap, textSpan: ts.TextSpan, tmpl: BobeTemplateInfo) =>
  tmpl.iifeStartInVirtual! + headMap.range![0] <= textSpan.start &&
  textSpan.start < tmpl.iifeStartInVirtual! + headMap.range![1];
