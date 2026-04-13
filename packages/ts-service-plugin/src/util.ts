import * as ts from 'typescript/lib/tsserverlibrary';
import { Virtual_File_Exp, Virtual_File_Suffix } from "./global";

export function isBobeTaggedTemplate(node: ts.TaggedTemplateExpression, tss: typeof ts): boolean {
  return tss.isIdentifier(node.tag) && node.tag.text === 'bobe';
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
  return fileName.match(Virtual_File_Exp)
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
    let stack: ("block" | "expression")[] = [];

    for (let i = 0; i < content.length; i++) {
        // 在检查状态之前，先判断是否到达了目标索引
        if (i === targetIndex) {
            // 判断标准：
            // 1. 栈不为空（表示在某类括号内）
            // 2. 栈顶必须是 'block'，不能是 'expression'
            return stack.length > 0 && stack[stack.length - 1] === "block";
        }

        const char = content[i];
        const nextChar = content[i + 1];

        // 1. 识别 ${
        if (char === '$' && nextChar === '{') {
            stack.push("expression");
            i++; // 跳过 '{'，避免下次循环重复处理
            continue;
        }

        // 2. 识别普通的 {
        if (char === '{') {
            stack.push("block");
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
export function findPrecedingClassName(targetNode: ts.Node, sourceFile: ts.SourceFile, tss: typeof ts): string | undefined {
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
export function getClassMemberNames(className: string, sourceFile: ts.SourceFile, tss: typeof ts): string[] {
  const names: string[] = [];
  function visit(node: ts.Node) {
    if ((tss.isClassDeclaration(node) || tss.isClassExpression(node)) && node.name?.text === className) {
      for (const member of node.members) {
        if ((tss.isPropertyDeclaration(member) || tss.isMethodDeclaration(member)) && tss.isIdentifier(member.name)) {
          names.push(member.name.text);
        }
      }
      return;
    }
    tss.forEachChild(node, visit);
  }
  visit(sourceFile);
  return names;
}