import * as ts from 'typescript/lib/tsserverlibrary';
import { Bobe2ts, BOBE_DOM_PROP_TRANSFER, BOBE_PREFIX, IdGenerator } from './bobeToTs';
import { log } from './global';
import { findPrecedingClassName, getClassMemberNames, isBobeTaggedTemplate } from './util';
import { ParseError } from 'bobe';
import { BobeTemplateInfo, HeadMap, SourceMapEntry, VirtualDocumentResult } from './type';

type TemplatePreInfo = {
  raw: string;
  className: string;
  sf: ts.SourceFile;
  templateStart: number;
};

export function findBobeTemplatesInClass(
  classNode: ts.ClassDeclaration | ts.ClassExpression,
  tss: typeof ts,
  sourceFile: ts.SourceFile
) {
  const templates: TemplatePreInfo[] = [];
  function visit(node: ts.Node) {
    if (tss.isTaggedTemplateExpression(node) && isBobeTaggedTemplate(node, tss)) {
      const template = node.template;
      const raw = tss.isNoSubstitutionTemplateLiteral(template)
        ? (template.rawText ?? template.text)
        : template.getText().slice(1, -1);
      // 模板内容在源文件中的起始 offset（反引号后第一个字符）
      const templateStart = template.getStart() + 1; // +1 跳过反引号
      templates.push({ raw, className: classNode.name?.text || '', sf: sourceFile, templateStart });
    } else {
      tss.forEachChild(node, visit);
    }
  }
  visit(classNode);
  return templates;
}

export function buildVirtualDocument(sourceFile: ts.SourceFile, tss: typeof ts): VirtualDocumentResult {
  const source = sourceFile.text;
  const iifes: string[] = [];
  const templateInfos: BobeTemplateInfo[] = [];

  function visit(node: ts.Node) {
    if ((tss.isClassDeclaration(node) || tss.isClassExpression(node)) && node.name) {
      const templates = findBobeTemplatesInClass(node, tss, sourceFile);
      if (templates.length > 0) {
        const { iifeCode, headMap, sourceMapsAndErrors } = buildIife(templates, node.name.text, sourceFile, tss);
        sourceMapsAndErrors.forEach(({ sourceMap, errors }, i) => {
          const { templateStart } = templates[i];
          templateInfos.push({
            templateStartInSource: templateStart,
            sourceMap,
            headMap,
            iifeCodeIndex: iifes.length,
            errors
          });
        });
        iifes.push(iifeCode);
      }
    } else {
      tss.forEachChild(node, visit);
    }
  }

  visit(sourceFile);
  if (iifes.length === 0) return { code: source, templates: [], sf: sourceFile };

  // 组装虚拟文档，同时计算每个 IIFE 的起始 offset
  // export {} 使虚拟文件成为独立模块，避免与原始文件的顶层声明冲突
  let virtualCode = source + '\nexport {};\n' + BOBE_DOM_PROP_TRANSFER;
  const templates: VirtualDocumentResult['templates'] = [];
  let iifeIdx = 0;
  for (const info of templateInfos) {
    if (info.iifeCodeIndex! > iifeIdx) {
      virtualCode += iifes[iifeIdx] + '\n';
      iifeIdx++;
    }
    const iifeStartInVirtual = virtualCode.length;
    templates.push({
      iifeStartInVirtual,
      sourceMap: info.sourceMap,
      headMap: info.headMap,
      templateStartInSource: info.templateStartInSource,
      errors: info.errors
    });
  }
  // 完成遍历后把最后一个 iife 代码加入
  virtualCode += iifes[iifeIdx];
  log('虚拟文件\n', virtualCode);
  return { code: virtualCode, templates, sf: sourceFile };
}

function buildIife(
  templatePreInfos: TemplatePreInfo[],
  className: string,
  sourceFile: ts.SourceFile,
  tss: typeof ts
): {
  iifeCode: string;
  headMap: HeadMap;
  sourceMapsAndErrors: { sourceMap: SourceMapEntry[]; errors: ParseError[] }[];
} {
  let header = '(() => {\n';
  const headMap: HeadMap = [];
  headMap.className = className;
  const members = getClassMemberNames(className, sourceFile, tss);
  if (members.length > 0) {
    header += `const {`;

    for (const mem of members) {
      const nameText = mem.name!.getText();
      const aliasText = `${nameText}:${nameText}`
      headMap.push({
        originOffset: mem.name!.pos,
        codeOffset: header.length,
        length: aliasText.length
      });
      header += aliasText + ',';
    }
    header += `} = {} as any as ${className};\n`;
  }
  const lastItem = headMap[headMap.length - 1];
  const end = lastItem ? lastItem.codeOffset + lastItem.length : 0;
  headMap.range = [headMap[0].codeOffset || 0, end];
  const idGenerator = new IdGenerator();
  header += `let ${idGenerator.h}!:<K extends keyof HTMLElementTagNameMap>(
  tag: K, 
  options?: ElementCreationOptions
) => Omit<HTMLElementTagNameMap[K], keyof ${BOBE_PREFIX}NativeProperties |'textContent' > & { text: string|number|undefined|null } & ${BOBE_PREFIX}NativeProperties & Record<string, any>;
let ${idGenerator.t}!: ${BOBE_PREFIX}CreateTextOrComponent;
`;

  const sourceMapsAndErrors = [];

  for (const preInfo of templatePreInfos) {
    const { output: astBody, sourceMap, errors } = new Bobe2ts(idGenerator, header.length, preInfo.raw).process();
    sourceMapsAndErrors.push({
      sourceMap,
      errors
    });
    header += astBody;
  }

  const iifeCode = header + '\n})();';
  return { iifeCode, headMap, sourceMapsAndErrors };
}
