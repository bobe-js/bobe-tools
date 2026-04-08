import * as ts from 'typescript/lib/tsserverlibrary';
import { BobeTemplateService } from './template-service';
import { decorateWithTemplateLanguageService } from 'typescript-template-language-service-decorator';
import { G, Virtual_File_Exp, Virtual_File_Suffix } from './global';
import { getVirtualName, isVirtualFile } from './util';
const testCode = 'new Mess'
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

      host.getScriptSnapshot = (fileName: string) => {
        if (isVirtualFile(fileName)) {
          logger.info(`hook -> getScriptSnapshot: ${fileName}`);
          return ts.ScriptSnapshot.fromString(testCode);
        }
        const snap = oldGetScriptSnapshot(fileName);
        return snap;
      };
       host.readFile = (fileName: string) => {
        if (isVirtualFile(fileName)) {
          logger.info(`hook -> readFile: ${fileName}`);
          return testCode;
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
        if (isVirtualFile(fileName)) {
          return true;
        }
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

      // 1. 实例化你的逻辑
      const templateService = new BobeTemplateService(modules.typescript, wrappedLangService, info.project);

      // 2. 调用装饰器
      // 它会返回一个增强版的 languageService，自动处理了匹配和坐标转换
      return decorateWithTemplateLanguageService(
        modules.typescript,
        wrappedLangService,
        info.project,
        templateService,
        {
          tags: ['bobe'], //
          enableForStringWithSubstitutions: true // 是否对普通字符串也生效
        }
      );
    }
  };
};
