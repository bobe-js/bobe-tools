import { Compiler, Tokenizer, NodeType } from 'bobe/compiler';
import type {
  ElementNode,
  ComponentNode,
  LoopNode,
  ConditionalNode,
  Property,
  TemplateNode,
  DynamicValue,
  StaticValue,
  InterpolationNode
} from 'bobe';

export interface SourceMapEntry {
  /** 在模板字符串中的起始 offset（相对于模板内容开头，0-based） */
  templateOffset: number;
  /** 在生成的 bobeToTs code 字符串中的起始 offset */
  codeOffset: number;
  /** 表达式的字符长度 */
  length: number;
}

export interface BobeToTsResult {
  output: string;
  input: string;
  sourceMap: SourceMapEntry[];
}

class Dent {
  stack: number[];
  constructor(public base: number) {
    this.stack = [base];
  }
  get v() {
    const length = this.stack[this.stack.length - 1];
    return new Array(length).fill(' ').join('');
  }
  indent() {
    const length = this.stack[this.stack.length - 1];
    this.stack.push(length + 2);
  }
  dedent() {
    this.stack.pop();
  }
}

const BRACE_REG = /^\$\{|^\{|\}$/g;
const BOBE_PREFIX = '$Bobe';
export class Bobe2ts {
  tokenizer: Tokenizer;
  compiler: Compiler;
  res: BobeToTsResult = {
    output: '',
    input: '',
    sourceMap: []
  };
  map(
    /** 在模板字符串中的起始 offset（相对于模板内容开头，0-based） */
    templateOffset: number,
    /** 在生成的 bobeToTs code 字符串中的起始 offset */
    codeOffset: number,
    /** 表达式的字符长度 */
    length: number
  ) {
    this.res.sourceMap.push({ templateOffset, codeOffset: this.iiefHeadLength + codeOffset, length });
  }
  dent = new Dent(2);
  lines: string[] = [];
  id = Date.now().toString(36);
  i = 0;
  gdt = 0;
  get name() {
    return `a_${this.id}_${this.i}`;
  }
  get h() {
    return `h_${this.id}_${this.i}`;
  }
  get t() {
    return `t_${this.id}_${this.i}`;
  }
  output = `type ${BOBE_PREFIX}CreateTextOrComponent = {
${this.dent.v}(input: string): Text;
${this.dent.v}<T>(input: (...args: any[]) => T): T;
${this.dent.v}<T extends new (...args: any[]) => any>(input: T): T;
};
${this.dent.v}let ${this.h}!:<K extends keyof HTMLElementTagNameMap>(
${this.dent.v}tag: K, 
${this.dent.v}options?: ElementCreationOptions
) => Omit<HTMLElementTagNameMap[K], 'textContent'|'style'> & { text: string, style: string };
${this.dent.v}let t!: ${BOBE_PREFIX}CreateTextOrComponent;
`;

  constructor(
    public iiefHeadLength: number,
    public templateCode: string
  ) {
    const tokenizer = (this.tokenizer = new Tokenizer(() => undefined, false));
    tokenizer.setCode(templateCode);
    const compiler = (this.compiler = new Compiler(tokenizer, {
      parseElementNode: {
        propsAdded: node => {
          const _node = node!;
          this.output += `${this.dent.v}let ${this.name}=${this.h}('`;
          this.map(this.off(_node), this.output.length, _node.tagName.length);
          this.output += `${_node.tagName}');`;
          this.createSetPropsExp(_node.props);
          this.output += `\n`;
          this.i++;
        }
      },
      parseComponentNode: {
        propsAdded: node => {
          const _node = node!;
          const name = _node.componentName;
          const value = String(name.value);
          const isClass = value.match(/^\w+$/);
          const source = name.loc!.source!;
          const sourceName = source.replace(BRACE_REG, ' ');
          if (isClass) {
            this.output += `${this.dent.v}let ${this.name}=new `;
            this.map(this.off(_node), this.output.length, source.length);

            this.output += `${sourceName}()`;
          }
          // 文本节点表达式
          else {
            this.output += `${this.dent.v}let ${this.name}=${this.t}(`;
            this.map(this.off(_node), this.output.length, source.length);
            this.output += `${sourceName});`;
          }
          this.createSetPropsExp(_node.props);
          this.output += `\n`;
          this.i++;
        }
      },
      parseConditionalNode: {
        propsAdded: node => {
          const _node = node!;
          const cond = _node.condition;
          const condVal = cond.loc!.source;
          const ifHeadS = `${this.dent.v}if(`;
          this.output += ifHeadS;
          this.map(this.off(cond), this.output.length, condVal.length);
          this.output += condVal + `){\n`;
          this.dent.indent();
        },
        leave: node => {
          this.dent.dedent();
          this.output += `${this.dent.v}}\n`;
        }
      },
      parseLoopNode: {
        propsAdded: node => {
          const _node = node!;
          this.output += `${this.dent.v}`;
          const { collection: arr, item, index, key } = _node;
          this.map(this.off(arr), this.output.length, arr.loc!.source!.length);
          this.output += arr.loc!.source + '.forEach((';
          this.map(this.off(item), this.output.length, item.loc!.source!.length);
          this.output += item.loc!.source;
          if (index) {
            this.output += ',';
            this.map(this.off(index), this.output.length, index.loc!.source!.length);
            this.output += index.loc!.source;
          }
          this.output += ')=>{\n';
          this.dent.indent();
        },
        leave: node => {
          this.dent.dedent();
          this.output += `${this.dent.v}});\n`;
        }
      }
    }));
  }
  off(n: { loc?: any }) {
    return n.loc!.start.offset - 1;
  }
  createSetPropsExp = (props: Property[]) => {
    const { name } = this;
    const nameDot = `${name}.`;
    props.forEach(prop => {
      const loc = prop.key.loc!;
      const { source: key } = loc;
      this.map(this.off(prop.key), this.output.length + nameDot.length, key.length);
      const assignLeft = `${nameDot}${key}=`;
      this.output += assignLeft;
      if (!prop.value) {
        this.output += 'null;';
        return;
      }
      let { source: value } = prop.value.loc!;
      if (prop.value.type === NodeType.DynamicValue) {
        // 替换成空格
        value = value.replace(BRACE_REG, ' ');
      }

      this.map(this.off(prop.value), this.output.length, value.length);
      this.output += value + ';';
    });
  };

  process() {
    this.compiler.parseProgram();
    return {
      output: this.output,
      input: this.templateCode,
      sourceMap: this.res.sourceMap,
      errors: this.compiler.errors
    };
  }
}

// const p = new Bobe2ts(`
// h2 text="测试"
// input value={value} oninput={oninput} onkeyup={onkeyup}
// for arr; item i
//   div style="display: flex; align-items: center;"
//     h1 onclick={() => delItem(i)}
//       {item.value}
//     input type="text"  oninput={(e) => updateItem(i, e.target.value)}
// if show
//   div
//     {'哈哈哈'}
// `);

// const res = p.process();

// const { input, output, sourceMap } = res;
// let verify = sourceMap.map(({ templateOffset: inOffset, codeOffset: outOffset, length }) => {
//   return {
//     _in: input.slice(inOffset, inOffset + length),
//     out: output.slice(outOffset, outOffset + length)
//   };
// });
// verify = verify.filter(it => it._in !== it.out);
// console.log(verify);
