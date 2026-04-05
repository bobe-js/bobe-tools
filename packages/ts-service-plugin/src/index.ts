import * as ts from 'typescript/lib/tsserverlibrary';
import { BobeTemplateService } from './template-service';
import { decorateWithTemplateLanguageService } from 'typescript-template-language-service-decorator';
import { G } from './global';
export default (modules: { typescript: typeof ts }) => {
  return {
    create(info: ts.server.PluginCreateInfo) {
      const logger = info.project.projectService.logger;
      logger.info('正在初始化我的模板插件...');
      G.log = logger;
      // 1. 实例化你的逻辑
      const templateService = new BobeTemplateService(modules.typescript, info.languageService);

      // 2. 调用装饰器
      // 它会返回一个增强版的 languageService，自动处理了匹配和坐标转换
      return decorateWithTemplateLanguageService(
        modules.typescript,
        info.languageService,
        info.project,
        templateService,
        {
          tags: ['bobe'], //
          enableForStringWithSubstitutions: true // 是否对普通字符串也生效
        }
      );
    }
  };
}