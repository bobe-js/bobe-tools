import * as ts from 'typescript/lib/tsserverlibrary';
import { BobeTemplateService } from './template-service';
import { decorateWithTemplateLanguageService } from 'typescript-template-language-service-decorator';
import { G } from './global';
import { getVirtualName, isVirtualFile, getRealName } from './util';
import { buildVirtualDocument, VirtualDocumentResult } from './buildVirtualDocument';

export default (modules: { typescript: typeof ts }) => {
  return {
    create(info: ts.server.PluginCreateInfo) {
      const logger = info.project.projectService.logger;
      logger.info('正在初始化我的模板插件...');
      G.log = logger;
      const host: ts.LanguageServiceHost = Object.create(info.languageServiceHost);
      const oldGetScriptSnapshot = host.getScriptSnapshot.bind(host);
      const getScriptFileNames = host.getScriptFileNames.bind(host);
      const getScriptVersion = host.getScriptVersion.bind(host);
      const fileExists = host.fileExists.bind(host);
      const readFile = host.readFile.bind(host);

      // 缓存每个虚拟文件最近一次的构建结果（含 sourceMap）
      const virtualDocCache = new Map<string, VirtualDocumentResult>();

      const getVirtualResult = (virtualFileName: string): VirtualDocumentResult => {
        const cached = virtualDocCache.get(virtualFileName);
        if (cached) return cached;
        const realFileName = getRealName(virtualFileName);
        const source = readFile(realFileName) ?? '';
        const result = buildVirtualDocument(source, modules.typescript);
        virtualDocCache.set(virtualFileName, result);
        return result;
      };

      // TS 每次拉取快照时刷新 cache，保证 sourceMap 与文件内容同步
      const getVirtualCode = (virtualFileName: string): string => {
        const realFileName = getRealName(virtualFileName);
        const source = readFile(realFileName) ?? '';
        const result = buildVirtualDocument(source, modules.typescript);
        virtualDocCache.set(virtualFileName, result);
        return result.code;
      };

      host.getScriptSnapshot = (fileName: string) => {
        if (isVirtualFile(fileName)) {
          logger.info(`hook -> getScriptSnapshot: ${fileName}`);
          return ts.ScriptSnapshot.fromString(getVirtualCode(fileName));
        }
        return oldGetScriptSnapshot(fileName);
      };

      host.readFile = (fileName: string) => {
        if (isVirtualFile(fileName)) {
          logger.info(`hook -> readFile: ${fileName}`);
          return getVirtualCode(fileName);
        }
        return readFile(fileName);
      };

      host.getScriptFileNames = () => {
        const fileNames = getScriptFileNames();
        const virtualFileNames = fileNames
          .filter(it => !it.match(/node_modules/) && !isVirtualFile(it))
          .map(getVirtualName);
        logger.info(`正在处理文件: ${JSON.stringify(virtualFileNames, undefined, 2)}`);
        return [...new Set([...fileNames, ...virtualFileNames])];
      };

      let version = 1;
      host.getScriptVersion = (fileName: string) => {
        if (isVirtualFile(fileName)) {
          logger.info(`正在处理版本号: ${fileName}`);
          return version + '';
        }
        return getScriptVersion(fileName);
      };

      host.fileExists = (fileName: string) => {
        if (isVirtualFile(fileName)) return true;
        return fileExists(fileName);
      };

      if (host.getScriptKind) {
        const oldGetScriptKind = host.getScriptKind.bind(host);
        host.getScriptKind = (fileName: string) => {
          if (isVirtualFile(fileName)) {
            return fileName.endsWith('.ts') ? ts.ScriptKind.TS : ts.ScriptKind.TSX;
          }
          return oldGetScriptKind(fileName);
        };
      }

      const wrappedLangService = ts.createLanguageService(host);

      const templateService = new BobeTemplateService(
        modules.typescript,
        wrappedLangService,
        info.project,
        getVirtualResult
      );

      return decorateWithTemplateLanguageService(
        modules.typescript,
        wrappedLangService,
        info.project,
        templateService,
        {
          tags: ['bobe'],
          enableForStringWithSubstitutions: true
        }
      );
    }
  };
};
