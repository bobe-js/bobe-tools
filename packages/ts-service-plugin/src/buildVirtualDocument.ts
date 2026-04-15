import * as ts from 'typescript/lib/tsserverlibrary';
import { Bobe2ts } from './bobeToTs';
import { log } from './global';
import { findPrecedingClassName, getClassMemberNames, isBobeTaggedTemplate } from './util';
import { ParseError } from 'bobe';
import { BobeTemplateInfo, SourceMapEntry, VirtualDocumentResult } from './type';

export function buildVirtualDocument(sourceFile: ts.SourceFile, tss: typeof ts): VirtualDocumentResult {
  const source = sourceFile.text;
  const iifes: string[] = [];
  const templateInfos: BobeTemplateInfo[] = [];

  function visit(node: ts.Node) {
    if (tss.isTaggedTemplateExpression(node) && isBobeTaggedTemplate(node, tss)) {
      const template = node.template;
      const raw = tss.isNoSubstitutionTemplateLiteral(template)
        ? (template.rawText ?? template.text)
        : template.getText().slice(1, -1);

      // 模板内容在源文件中的起始 offset（反引号后第一个字符）
      const templateStartInSource = template.getStart() + 1; // +1 跳过反引号

      const className = findPrecedingClassName(node, sourceFile, tss);
      const { iifeCode, sourceMap, headMap, errors } = buildIife(raw, className, sourceFile, tss);

      templateInfos.push({ templateStartInSource, sourceMap, headMap, iifeCode, errors });
      iifes.push(iifeCode);
    }
    tss.forEachChild(node, visit);
  }

  visit(sourceFile);

  if (iifes.length === 0) return { code: source, templates: [], sf: sourceFile };

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
      headMap: info.headMap,
      templateStartInSource: info.templateStartInSource,
      errors: info.errors
    });
  }

  log('虚拟文件\n', virtualCode);
  return { code: virtualCode, templates, sf: sourceFile };
}

function buildIife(
  templateRaw: string,
  className: string | undefined,
  sourceFile: ts.SourceFile,
  tss: typeof ts
): { iifeCode: string; headMap: SourceMapEntry[]; sourceMap: SourceMapEntry[]; errors: ParseError[] } {
  let header = '(() => {\n';
  const headMap: SourceMapEntry[] = [];
  if (className) {
    const members = getClassMemberNames(className, sourceFile, tss);
    if (members.length > 0) {
      header += `  const {`;

      for (const mem of members) {
        const nameText = mem.name!.getText();
        headMap.push({
          originOffset: mem.name!.pos,
          codeOffset: header.length,
          length: nameText.length
        });
        header += nameText + ',';
      }
      header += `} = {} as any as ${className};\n`;
    }
  }

  const { output: astBody, sourceMap, errors } = new Bobe2ts(header.length, templateRaw).process();

  const iifeCode = header + astBody + '\n})();';
  return { iifeCode, sourceMap: sourceMap, headMap, errors };
}
