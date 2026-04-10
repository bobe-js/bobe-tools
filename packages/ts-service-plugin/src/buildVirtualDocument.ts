import * as ts from 'typescript/lib/tsserverlibrary';
import { Bobe2ts, SourceMapEntry } from './bobeToTs';
import { log } from './global';

export interface VirtualDocumentResult {
  code: string;
  /** 每个 bobe 模板对应一条记录 */
  templates: Array<{
    /** 该模板字符串在原始源文件中的起始 offset（反引号后第一个字符） */
    templateStartInSource: number;
    sourceMap: SourceMapEntry[];
    /** 该模板对应的 IIFE 块在虚拟文档中的起始 offset */
    iifeStartInVirtual: number;
  }>;
}

export function buildVirtualDocument(source: string, tss: typeof ts): VirtualDocumentResult {
  const sourceFile = tss.createSourceFile('virtual.ts', source, tss.ScriptTarget.Latest, true);

  const iifes: string[] = [];
  const templateInfos: Array<{
    templateStartInSource: number;
    sourceMap: SourceMapEntry[];
    iifeCode: string;
  }> = [];

  function visit(node: ts.Node) {
    if (tss.isTaggedTemplateExpression(node) && tss.isIdentifier(node.tag) && node.tag.text === 'bobe') {
      const template = node.template;
      const raw = tss.isNoSubstitutionTemplateLiteral(template)
        ? (template.rawText ?? template.text)
        : (template.head.rawText ?? template.head.text);

      // 模板内容在源文件中的起始 offset（反引号后第一个字符）
      const templateStartInSource = template.getStart() + 1; // +1 跳过反引号

      const className = findPrecedingClassName(node, sourceFile, tss);
      const { iifeCode, sourceMap } = buildIife(raw, className, sourceFile, tss);

      templateInfos.push({ templateStartInSource, sourceMap, iifeCode });
      iifes.push(iifeCode);
    }
    tss.forEachChild(node, visit);
  }

  visit(sourceFile);

  if (iifes.length === 0) return { code: source, templates: [] };

  // 组装虚拟文档，同时计算每个 IIFE 的起始 offset
  let virtualCode = source + '\n';
  const templates: VirtualDocumentResult['templates'] = [];

  for (const info of templateInfos) {
    const iifeStartInVirtual = virtualCode.length;
    virtualCode += info.iifeCode + '\n';
    templates.push({
      templateStartInSource: info.templateStartInSource,
      sourceMap: info.sourceMap,
      iifeStartInVirtual,
    });
  }

  log('虚拟文件\n', virtualCode);
  return { code: virtualCode, templates };
}

function findPrecedingClassName(targetNode: ts.Node, sourceFile: ts.SourceFile, tss: typeof ts): string | undefined {
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

function getClassMemberNames(className: string, sourceFile: ts.SourceFile, tss: typeof ts): string[] {
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

function buildIife(
  templateRaw: string,
  className: string | undefined,
  sourceFile: ts.SourceFile,
  tss: typeof ts
): { iifeCode: string; sourceMap: SourceMapEntry[] } {
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

  const { output: astBody, sourceMap } = new Bobe2ts(templateRaw).process();

  // 将 bobeToTs 的 codeOffset（相对于 astBody 开头）转换为相对于 iifeCode 开头的 offset
  const iifeBodyStart = iifeHeader.length;
  for (const entry of sourceMap) {
    entry.codeOffset += iifeBodyStart;
  }
  const iifeCode = iifeHeader + astBody + '\n})();';
  return { iifeCode, sourceMap };
}
