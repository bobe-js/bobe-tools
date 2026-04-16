import * as ts from 'typescript/lib/tsserverlibrary';
import { BobeTemplateService } from './template-service';
import { G } from './global';
import { getVirtualName, isVirtualFile, getRealName, getPosTemplateCtx, getValidBobeTemplateNode, makeContext } from './util';
import { buildVirtualDocument } from './buildVirtualDocument';
import { VirtualDocumentResult } from './type';

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
          return { code: '', templates: [],  sf: sourceFile };
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

      // 代理原始 info.languageService，拦截模板相关方法
      // getProgram 不拦截 → 返回原始 program（不含虚拟文件）→ tsserver 不崩溃
      return new Proxy(info.languageService, {
        get(target: ts.LanguageService, prop, receiver) {
          if (prop === 'getCompletionsAtPosition') {
            return (fileName: string, position: number, options: any) => {
              const res = getPosTemplateCtx(info, tss, fileName, position);
              if (!res) {
                return target.getCompletionsAtPosition(fileName, position, options);
              }
              return templateService.getCompletionsAtPosition(res.ctx as any, res.relPos, position);
            };
          }
          if (prop === 'getQuickInfoAtPosition') {
            return (fileName: string, position: number, options: any) => {
              const res = getPosTemplateCtx(info, tss, fileName, position);
              if (!res) {
                return target.getQuickInfoAtPosition(fileName, position, options);
              }
              return templateService.getQuickInfoAtPosition(res.ctx as any, res.relPos, position);
            };
          }
          if (prop === 'getDefinitionAndBoundSpan') {
            return (fileName: string, position: number) => {
              const res = getPosTemplateCtx(info, tss, fileName, position);
              if (!res) {
                return target.getDefinitionAndBoundSpan(fileName, position);
              }
              return templateService.getDefinitionAndBoundSpan(res.ctx as any, res.relPos, position);
            };
          }

          if (prop === 'getSemanticDiagnostics') {
            return (fileName: string) => {
              const baseDiags = target.getSemanticDiagnostics(fileName);
              const sf = info.languageService.getProgram()?.getSourceFile(fileName);
              if (!sf) return baseDiags;
              const templateDiags: ts.Diagnostic[] = [];
              function visit(node: ts.Node) {
                const tmpl = getValidBobeTemplateNode(tss, node);
                if (tmpl) {
                  const baseOffset = tmpl.getStart() + 1;
                  const ctx = makeContext(tmpl, sf!, fileName, baseOffset);
                  const rawDiags = templateService.getSemanticDiagnostics(ctx as any);
                  for (const d of rawDiags) {
                    templateDiags.push({ ...d, start: baseOffset + (d.start || 0) });
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
                const tmpl = getValidBobeTemplateNode(tss, node);
                if (tmpl) {
                  const baseOffset = tmpl.getStart() + 1;
                  const ctx = makeContext(tmpl, sf!, fileName, baseOffset);
                  for (const d of templateService.getSyntacticDiagnostics(ctx as any)) {
                    templateDiags.push({ ...d, start: baseOffset + 1 + (d.start || 0) });
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

