import * as ts from 'typescript/lib/tsserverlibrary';
import { BobeTemplateService } from './template-service';
import { G } from './global';
import { getVirtualName, isVirtualFile, getRealName, isBobeTaggedTemplate } from './util';
import { buildVirtualDocument, VirtualDocumentResult } from './buildVirtualDocument';

export default (modules: { typescript: typeof ts }) => {
  return {
    create(info: ts.server.PluginCreateInfo) {
      const logger = info.project.projectService.logger;
      logger.info('正在初始化我的模板插件...');
      G.log = logger;

      const lsh = info.languageServiceHost;
      const tss = modules.typescript;

      // 缓存每个虚拟文件最近一次的构建结果（含 sourceMap）
      const virtualDocCache = new Map<string, { result: VirtualDocumentResult; version: string }>();

      const getVirtualResult = (virtualFileName: string): VirtualDocumentResult => {
        const cached = virtualDocCache.get(virtualFileName);
        const realFileName = getRealName(virtualFileName);
        const version = lsh.getScriptVersion(realFileName);
        if (cached && cached.version === version) return cached.result;
        const sourceFile = info.languageService.getProgram()?.getSourceFile(realFileName);
        if (!sourceFile) {
          return { code: '', templates: [] };
        }
        const result = buildVirtualDocument(sourceFile, tss);
        virtualDocCache.set(virtualFileName, { result, version });
        return result;
      };

      // 完全独立的 host，不基于 Object.create(Project)，避免原型链污染 Project 的 program
      const innerHost: ts.LanguageServiceHost = {
        getCompilationSettings: () => lsh.getCompilationSettings(),
        getCurrentDirectory: () => lsh.getCurrentDirectory(),
        getDefaultLibFileName: opts => lsh.getDefaultLibFileName(opts),

        getScriptFileNames: () => {
          const fileNames = lsh.getScriptFileNames();
          const virtualFileNames = fileNames
            .filter(it => !it.match(/node_modules/) && !isVirtualFile(it))
            .map(getVirtualName);
          logger.info(`正在处理文件: ${JSON.stringify(virtualFileNames, undefined, 2)}`);
          return [...new Set([...fileNames, ...virtualFileNames])];
        },

        getScriptVersion: fileName => {
          if (isVirtualFile(fileName)) return lsh.getScriptVersion(getRealName(fileName));
          return lsh.getScriptVersion(fileName);
        },

        getScriptSnapshot: fileName => {
          if (isVirtualFile(fileName)) {
            logger.info(`hook -> getScriptSnapshot: ${fileName}`);
            return tss.ScriptSnapshot.fromString(getVirtualResult(fileName).code);
          }
          return lsh.getScriptSnapshot(fileName);
        },

        fileExists: fileName => {
          if (isVirtualFile(fileName)) return true;
          return lsh.fileExists?.(fileName) ?? false;
        },

        readFile: (fileName, encoding) => {
          if (isVirtualFile(fileName)) {
            logger.info(`hook -> readFile: ${fileName}`);
            return getVirtualResult(fileName).code;
          }
          return lsh.readFile?.(fileName, encoding);
        },

        getScriptKind: fileName => {
          if (isVirtualFile(fileName)) return fileName.endsWith('.ts') ? tss.ScriptKind.TS : tss.ScriptKind.TSX;
          return lsh.getScriptKind?.(fileName) ?? tss.ScriptKind.Unknown;
        },

        directoryExists: lsh.directoryExists?.bind(lsh),
        getDirectories: lsh.getDirectories?.bind(lsh),
        realpath: lsh.realpath?.bind(lsh),
        useCaseSensitiveFileNames: lsh.useCaseSensitiveFileNames?.bind(lsh),
        getNewLine: lsh.getNewLine?.bind(lsh)
      };

      const wrappedLangService = tss.createLanguageService(innerHost);

      const templateService = new BobeTemplateService(tss, wrappedLangService, info.project, getVirtualResult);

      // ---- 自己实现 decorator 逻辑，不依赖 typescript-template-language-service-decorator ----

      // 在 AST 中找到 position 处最深的节点
      function findNodeAtPosition(sf: ts.SourceFile, position: number): ts.Node | undefined {
        function find(node: ts.Node): ts.Node | undefined {
          if (position >= node.getStart() && position < node.getEnd()) {
            return tss.forEachChild(node, find) || node;
          }
          return undefined;
        }
        return find(sf);
      }

      // 判断节点是否属于 bobe 标签模板，返回模板字面量节点
      function getValidBobeTemplateNode(node: ts.Node): ts.TemplateLiteral | undefined {
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
            return node.parent?.parent ? getValidBobeTemplateNode(node.parent.parent) : undefined;
          case tss.SyntaxKind.TemplateMiddle:
          case tss.SyntaxKind.TemplateTail:
            return node.parent?.parent?.parent ? getValidBobeTemplateNode(node.parent.parent.parent) : undefined;
          default:
            return undefined;
        }
      }

      // 将文件绝对 offset 转为模板相对 LineAndCharacter
      function getRelativePosition(
        templateNode: ts.TemplateLiteral,
        fileName: string,
        position: number
      ): ts.LineAndCharacter {
        const scriptInfo = info.project.getScriptInfo(fileName);
        if (!scriptInfo) return { line: 0, character: 0 };
        const baseOffset = templateNode.getStart() + 1;
        const baseLoc = scriptInfo.positionToLineOffset(baseOffset); // 1-based
        const cursorLoc = scriptInfo.positionToLineOffset(position);
        const bl = baseLoc.line - 1,
          bc = baseLoc.offset - 1;
        const cl = cursorLoc.line - 1,
          cc = cursorLoc.offset - 1;
        return { line: cl - bl, character: cl === bl ? cc - bc : cc };
      }

      // 构造最小 context 对象（BobeTemplateService 只用 node、fileName、text）
      function makeContext(templateNode: ts.TemplateLiteral, sf: ts.SourceFile, fileName: string) {
        return { node: templateNode, fileName, text: templateNode.getText().slice(1, -1), sf };
      }

      // 代理原始 info.languageService，拦截模板相关方法
      // getProgram 不拦截 → 返回原始 program（不含虚拟文件）→ tsserver 不崩溃
      return new Proxy(info.languageService, {
        get(target, prop, receiver) {
          if (prop === 'getCompletionsAtPosition') {
            return (fileName: string, position: number, options: any) => {
              const sf = info.languageService.getProgram()?.getSourceFile(fileName);
              if (!sf) return target.getCompletionsAtPosition(fileName, position, options);
              const node = findNodeAtPosition(sf, position);
              if (!node) return target.getCompletionsAtPosition(fileName, position, options);
              const templateNode = getValidBobeTemplateNode(node);
              if (!templateNode || position <= templateNode.pos)
                return target.getCompletionsAtPosition(fileName, position, options);
              const ctx = makeContext(templateNode, sf, fileName);
              const relPos = getRelativePosition(templateNode, fileName, position);
              return templateService.getCompletionsAtPosition(ctx as any, relPos);
            };
          }

          if (prop === 'getSemanticDiagnostics') {
            return (fileName: string) => {
              const baseDiags = target.getSemanticDiagnostics(fileName);
              const sf = info.languageService.getProgram()?.getSourceFile(fileName);
              if (!sf) return baseDiags;
              const templateDiags: ts.Diagnostic[] = [];
              function visit(node: ts.Node) {
                const tmpl = getValidBobeTemplateNode(node);
                if (tmpl) {
                  const ctx = makeContext(tmpl, sf!, fileName);
                  const rawDiags = templateService.getSemanticDiagnostics(ctx as any);
                  for (const d of rawDiags) {
                    templateDiags.push({ ...d, start: tmpl.getStart() + 1 + (d.start || 0) });
                  }
                  return;
                }
                tss.forEachChild(node, visit);
              }
              visit(sf);
              return [...baseDiags, ...templateDiags];
            };
          }

          if (prop === 'getSyntacticDiagnostics') {
            return (fileName: string) => {
              const baseDiags = target.getSyntacticDiagnostics(fileName);
              const sf = info.languageService.getProgram()?.getSourceFile(fileName);
              if (!sf) return baseDiags;
              const templateDiags: ts.Diagnostic[] = [];
              function visit(node: ts.Node) {
                const tmpl = getValidBobeTemplateNode(node);
                if (tmpl) {
                  const ctx = makeContext(tmpl, sf!, fileName);
                  for (const d of templateService.getSyntacticDiagnostics(ctx as any)) {
                    templateDiags.push({ ...d, start: tmpl.getStart() + 1 + (d.start || 0) });
                  }
                  return;
                }
                tss.forEachChild(node, visit);
              }
              visit(sf);
              return [...baseDiags, ...templateDiags];
            };
          }

          return Reflect.get(target, prop, receiver);
        }
      });
    }
  };
};
