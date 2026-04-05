import { TemplateLanguageService, TemplateContext } from 'typescript-template-language-service-decorator';
import * as ts from 'typescript/lib/tsserverlibrary';
import { G } from './global';

export class BobeTemplateService implements TemplateLanguageService {
  constructor(
    public tss: typeof ts,
    public _ls: ts.LanguageService
  ) {}
  // 这里的 position 是相对于模板内部的偏移量（0 是反引号后的第一个字符）
  getCompletionsAtPosition(context: TemplateContext, position: ts.LineAndCharacter): ts.CompletionInfo {
    const entries: ts.CompletionEntry[] = [];

    // 1. 计算光标在 context.text 中的索引
    // 注意：TemplateContext 处理了换行，我们需要将 LineAndCharacter 转为 character offset
    const lines = context.text.split(/\n/);
    let cursorOffset = 0;
    for (let i = 0; i < position.line; i++) {
      cursorOffset += lines[i].length + 1; // +1 是换行符
    }
    cursorOffset += position.character;

    // 2. 判断是否在 {} 内部
    if (!this.isInsideBraces(context.text, cursorOffset)) {
      G.log.info('内容'+ context.text);
      return { isGlobalCompletion: false, isMemberCompletion: false, isNewIdentifierLocation: false, entries: [] };
    }

    // 3. 只有在 {} 内才执行符号查找
    const program = this._ls.getProgram();
    const checker = program?.getTypeChecker();
    if (!checker)
      return { isGlobalCompletion: false, isMemberCompletion: false, isNewIdentifierLocation: false, entries: [] };

    const currentFileName = context.node.getSourceFile().fileName;
    const flags =
      this.tss.SymbolFlags.BlockScopedVariable |
      this.tss.SymbolFlags.FunctionScopedVariable |
      this.tss.SymbolFlags.Variable |
      this.tss.SymbolFlags.Function;

    const symbols = (checker as any).getSymbolsInScope(context.node, flags);

    symbols.forEach((symbol: ts.Symbol) => {
      const declarations = symbol.getDeclarations();
      if (!declarations) return;

      if (declarations.some(dec => dec.getSourceFile().fileName === currentFileName)) {
        entries.push({
          name: symbol.name,
          kind: this.tss.ScriptElementKind.variableElement,
          sortText: '0'
        });
      }
    });

    return {
      isGlobalCompletion: false,
      isMemberCompletion: false,
      isNewIdentifierLocation: false,
      entries
    };
  }

  /**
   * 辅助方法：简单判断光标是否在 {} 之间
   */
  private isInsideBraces(text: string, offset: number): boolean {
    const beforeText = text.slice(0, offset);
    const afterText = text.slice(offset);

    // 逻辑：向前找最近的 {，且确保这中间没有 }
    const lastOpen = beforeText.lastIndexOf('{');
    const lastClose = beforeText.lastIndexOf('}');

    // 如果没有 { 或者 最近的一个括号是 }，说明不在花括号内
    if (lastOpen === -1 || lastOpen < lastClose) {
      return false;
    }

    // 向后找最近的 }，且确保中间没有 {
    const nextClose = afterText.indexOf('}');
    const nextOpen = afterText.indexOf('{');

    if (nextClose === -1 || (nextOpen !== -1 && nextOpen < nextClose)) {
      return false;
    }

    return true;
  }

  // 辅助方法：根据符号标志返回对应的图标类型
  private getCompletionKind(symbol: ts.Symbol): ts.ScriptElementKind {
    const flags = symbol.getFlags();

    // 如果是函数
    if (flags & this.tss.SymbolFlags.Function) {
      return this.tss.ScriptElementKind.functionElement;
    }

    // 判断是否为 const
    const declarations = symbol.getDeclarations();
    if (declarations && declarations.length > 0) {
      const firstDeclaration = declarations[0];
      // 检查声明节点的父节点（VariableDeclarationList）是否有 NodeFlags.Const
      if (
        firstDeclaration.parent &&
        this.tss.getCombinedNodeFlags(firstDeclaration.parent) & this.tss.NodeFlags.Const
      ) {
        return this.tss.ScriptElementKind.constElement;
      }
    }

    return this.tss.ScriptElementKind.variableElement;
  }
}
