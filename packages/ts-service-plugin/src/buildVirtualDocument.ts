import * as ts from 'typescript/lib/tsserverlibrary';
import { Bobe2ts, SourceMapEntry } from './bobeToTs';
import { log } from './global';
import { findPrecedingClassName, getClassMemberNames, isBobeTaggedTemplate } from './util';
import { ParseError } from 'bobe';

export interface VirtualDocumentResult {
  code: string;
  /** 每个 bobe 模板对应一条记录 */
  templates: BobeTemplateInfo[];
}

export type BobeTemplateInfo = {
  /** 该模板字符串在原始源文件中的起始 offset（反引号后第一个字符） */
  templateStartInSource: number;
  sourceMap: SourceMapEntry[];
  /** 该模板对应的 IIFE 块在虚拟文档中的起始 offset */
  iifeStartInVirtual?: number;
  iifeCode?: string;
  errors: ParseError[];
};

export function buildVirtualDocument(sourceFile: ts.SourceFile, tss: typeof ts): VirtualDocumentResult {
  const source = sourceFile.text;
  const iifes: string[] = [];
  const templateInfos: BobeTemplateInfo[] = [];

  function visit(node: ts.Node) {
    if (tss.isTaggedTemplateExpression(node) && isBobeTaggedTemplate(node, tss)) {
      const template = node.template;
      const raw = tss.isNoSubstitutionTemplateLiteral(template)
        ? (template.rawText ?? template.text)
        : (template.getText().slice(1, -1));

      // 模板内容在源文件中的起始 offset（反引号后第一个字符）
      const templateStartInSource = template.getStart() + 1; // +1 跳过反引号

      const className = findPrecedingClassName(node, sourceFile, tss);
      const { iifeCode, sourceMap, errors } = buildIife(raw, className, sourceFile, tss);

      templateInfos.push({ templateStartInSource, sourceMap, iifeCode, errors });
      iifes.push(iifeCode);
    }
    tss.forEachChild(node, visit);
  }

  visit(sourceFile);

  if (iifes.length === 0) return { code: source, templates: [] };

  // 组装虚拟文档，同时计算每个 IIFE 的起始 offset
  // export {} 使虚拟文件成为独立模块，避免与原始文件的顶层声明冲突
  let virtualCode = source + '\nexport {};\n';
  const templates: VirtualDocumentResult['templates'] = [];

  for (const info of templateInfos) {
    const iifeStartInVirtual = virtualCode.length;
    virtualCode += info.iifeCode + '\n';
    templates.push({
      iifeStartInVirtual,
      sourceMap: info.sourceMap,
      templateStartInSource: info.templateStartInSource,
      errors: info.errors
    });
  }

  log('虚拟文件\n', virtualCode);
  return { code: virtualCode, templates };
}

function buildIife(
  templateRaw: string,
  className: string | undefined,
  sourceFile: ts.SourceFile,
  tss: typeof ts
): { iifeCode: string; sourceMap: SourceMapEntry[]; errors: ParseError[] } {
  const headerLines: string[] = [];
  headerLines.push('(() => {');

  if (className) {
    const members = getClassMemberNames(className, sourceFile, tss);
    headerLines.push(`  const _self: ${className} = null as any;`);
    if (members.length > 0) {
      headerLines.push(`  const { ${members.join(', ')} } = _self;`);
    }
  }

  const iifeHeader = headerLines.join('\n') + '\n';

  const { output: astBody, sourceMap, errors } = new Bobe2ts(iifeHeader.length, templateRaw).process();

  const iifeCode = iifeHeader + astBody + '\n})();';
  return { iifeCode, sourceMap, errors };
}
