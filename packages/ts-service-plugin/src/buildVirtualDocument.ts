import * as ts from 'typescript/lib/tsserverlibrary';
import { Bobe2ts, BOBE_DOM_PROP_TRANSFER, IdGenerator } from './bobeToTs';
import { log } from './global';
import { getClassMembersInClass, isBobeIdentifier, isBobeTemplate, isClass, processHandlers, Range } from './util';
import { IClassNode, Template, VirtualDocumentResult } from './type';

type TemplatePreInfo = {
  raw: string;
  className: string;
  sf: ts.SourceFile;
  templateStart: number;
  uiName?: string;
  props?: string[];
  typeExp?: string;
};

export function findBobeTemplatesInClass(
  classNode: IClassNode,
  tss: typeof ts,
  sourceFile: ts.SourceFile,
  program?: ts.Program
) {
  const preInfos: TemplatePreInfo[] = [];
  const checker = program?.getTypeChecker();
  function visit(node: ts.Node) {
    if (isBobeTemplate(node, tss)) {
      const template = node.template;
      const typeArg = node.typeArguments?.[0];
      let props: string[] | undefined = undefined,
        parent = node.parent,
        uiName: string | undefined = undefined,
        typeExp: string | undefined = undefined;
      for (let i = 0; i < 5 && parent; i++) {
        const parentIsAssign = tss.isPropertyDeclaration(parent);
        if (parentIsAssign) {
          uiName = parent.name.getText();
          break;
        }
      }
      if (typeArg && checker && uiName) {
        typeExp = typeArg.getText();
        const typeNode = checker.getTypeAtLocation(typeArg);
        const propNodes = checker.getPropertiesOfType(typeNode);
        props = propNodes.map(prop => prop.name);
      }
      const raw = tss.isNoSubstitutionTemplateLiteral(template)
        ? (template.rawText ?? template.text)
        : template.getText().slice(1, -1);
      // 模板内容在源文件中的起始 offset（反引号后第一个字符）
      const templateStart = template.getStart() + 1; // +1 跳过反引号
      preInfos.push({
        raw,
        uiName,
        typeExp,
        props,
        className: classNode.name?.text || '',
        sf: sourceFile,
        templateStart
      });
    } else {
      tss.forEachChild(node, visit);
    }
  }
  visit(classNode);
  return preInfos;
}

let c: {
  tss: typeof ts;
  program?: ts.Program;
  currentClass?: ts.ClassDeclaration | ts.ClassExpression;
  builtHeadRange?: Range;
  baseVOffset: number;
  virtualCode: string;
  templates: Template[];
  idg?: IdGenerator;
} = {} as any;
export function buildVirtualDocument1(
  sourceFile: ts.SourceFile,
  tss: typeof ts,
  program?: ts.Program
): VirtualDocumentResult {
  const source = sourceFile.text;
  const virtualCode = source + '\nexport {};\n' + BOBE_DOM_PROP_TRANSFER;
  const baseVOffset = virtualCode.length;
  c = { tss, program, baseVOffset, virtualCode, templates: [] };
  function walk(node: ts.Node) {
    const skip = processHandlers([
      beginClass, 
      beginTemplate
    ], node);
    if (!skip) tss.forEachChild(node, walk);
    processHandlers([
      endClass, 
      endTemplate
    ], node);
  }
  walk(sourceFile);
  log('虚拟文件\n', c.virtualCode);
  const result = { code: c.virtualCode, templates: c.templates, sf: sourceFile };
  c = {} as any;
  return result;
}

function beginClass(node: ts.Node) {
  if (!isClass(node, c.tss)) return;
  c.currentClass = node;
  return 0;
}
function endClass(node: ts.Node) {
  if (!isClass(node, c.tss)) return;
  c.currentClass = undefined;
  if (c.builtHeadRange) {
    c.builtHeadRange = undefined;
    c.idg = undefined;
    c.virtualCode += `}\n`;
  }
  return;
}
function beginTemplate(node: ts.Node) {
  if (!c.tss.isTaggedTemplateExpression(node)) return;
  // 非 bobe 模板语法可以直接跳过
  if (!isBobeIdentifier(node, c.tss)) return 1;
  // bobe 模板语法需要为文件末尾添加东西
  // 1. 为 class 添加类型上下文
  const template = {} as any as Template;
  if (c.currentClass && !c.builtHeadRange) {
    c.idg = new IdGenerator();
    const { currentClass } = c;
    const className = currentClass.name!.getText();
    const start = c.virtualCode.length;
    const ranges: Range[] = [];
    c.virtualCode += `{\nconst {`;
    const members = getClassMembersInClass(currentClass, c.tss);
    for (const member of members) {
      const nameText = member.name!.getText();
      const itemStart = c.virtualCode.length;
      c.virtualCode += `${nameText}:${nameText},`;
      const itemEnd = c.virtualCode.length;
      ranges.push(new Range(itemStart, itemEnd));
    }
    c.virtualCode += `} = {} as any as ${className};\n`;
    const end = c.virtualCode.length;
    c.builtHeadRange = template.headClass = new Range(start, end);
    template.headClassRanges = ranges;
  }
  c.virtualCode += '{\n';
  // 2. 为泛型添加类型上下文
  if (node.typeArguments) {
    const typeArg = node.typeArguments[0];
    const checker = c.program?.getTypeChecker();
    if (checker) {
      const typeNode = checker.getTypeAtLocation(typeArg);
      const typeExp = typeArg.getText();
      const originOffset = typeArg.getFullStart();
      const propNodes = checker.getPropertiesOfType(typeNode);
      /*----------------- 增加类型解构 -----------------*/
      const start = c.virtualCode.length;
      const ranges: Range[] = [];
      c.virtualCode += `const {`;
      for (const { name } of propNodes) {
        const itemStart = c.virtualCode.length;
        c.virtualCode += `${name}:${name},`;
        const itemEnd = c.virtualCode.length;
        ranges.push(new Range(itemStart, itemEnd));
      }
      const end = c.virtualCode.length;
      c.virtualCode += `} = {} as any as `;
      const codeOffset = c.virtualCode.length;
      template.headTemplateRanges = ranges;
      /*----------------- 记录类型位置的映射 -----------------*/
      c.virtualCode += typeExp;
      template.headTemplate = new Range(start, end);
      template.typeMap = {
        originOffset,
        codeOffset,
        length: typeExp.length
      };
      c.virtualCode += `;\n`;
    }
  }

  // 3. 构建虚拟文档
  const templateStart = node.template.getFullStart() + 1;
  const virtualStart = c.virtualCode.length;
  const raw = node.template.getText().slice(1, -1);
  const { output, sourceMap, errors } = new Bobe2ts(c.idg || new IdGenerator(), templateStart, virtualStart, raw, c.program).process();
  c.virtualCode += output + `}\n`;
  template.sourceMap = sourceMap;
  template.errors = errors;
  template.templateStart = templateStart;
  template.virtualStart = virtualStart;
  c.templates.push(template);
  return 1;
}
function endTemplate(node: ts.Node) {
  if (!isBobeTemplate(node, c.tss)) return;
  return;
}
