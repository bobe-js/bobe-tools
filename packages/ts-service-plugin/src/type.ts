import { ParseError, SourceLocation } from 'bobe';
import ts from 'typescript';

export type Position = SourceLocation['start'];

export interface VirtualDocumentResult {
  code: string;
  /** 每个 bobe 模板对应一条记录 */
  templates: BobeTemplateInfo[];
  sf?: ts.SourceFile;
}

export type BobeTemplateInfo = {
  /** 该模板字符串在原始源文件中的起始 offset（反引号后第一个字符） */
  templateStartInSource: number;
  sourceMap: SourceMapEntry[];
  headMap: HeadMap;
  /** 该模板对应的 IIFE 块在虚拟文档中的起始 offset */
  iifeStartInVirtual?: number;
  iifeCodeIndex?: number;
  errors: ParseError[];
};

export type AbsMap = {
  virtualStart: number;
  originStart: number;
  virtualOffset: number;
  originOffset: number;
  length: number;
};

export interface SourceMapEntry {
  /** 在模板字符串中的起始 offset（相对于模板内容开头，0-based）
   * 如果是 类解构的 originOffset 是相对整个文档的，它本身就不是映射在模板字符串上的
   */
  originOffset: number;
  /** 在生成的 bobeToTs code 字符串中的起始 offset */
  codeOffset: number;
  /** 表达式的字符长度 */
  length: number;
}

export type HeadMap = SourceMapEntry[] & {
  className?: string;
  /** 结构表达式相对 IIFE 的范围 */
  range?: [number, number];
}
