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
  InterpolationNode,
  PropertyValue
} from 'bobe';
import { log } from './global';
import { BuildVDocCtx, SourceMapEntry } from './type';
import { Program } from 'typescript/lib/tsserverlibrary';

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

const BRACE_REG = /(^\$\{)|(^\{)|(\}$)/g;
export const BOBE_PREFIX = '$Bobe' + Date.now().toString(36);
export const BOBE_DOM_PROP_TRANSFER = `type ${BOBE_PREFIX}ToMap<K extends string, T> = {
  [P in K]?: T;
};
type ${BOBE_PREFIX}BooleanProps = ${BOBE_PREFIX}ToMap<
  'disabled' | 'checked' | 'selected' | 'readonly' | 'required' | 
  'multiple' | 'hidden' | 'autofocus' | 'novalidate' | 'ismap' | 
  'open' | 'reversed' | 'indeterminate', 
  boolean|string|undefined|null
>;
type ${BOBE_PREFIX}NumericProps = ${BOBE_PREFIX}ToMap<
  'style'|'value' | 'placeholder' | 'title' | 'alt' | 'width' | 'height' | 'columnCount' | 'tabIndex' | 'maxLength' | 
  'minLength' | 'size' | 'rows' | 'cols' | 'span' | 'start' | 
  'valueAsNumber' | 'max' | 'min' | 'step', 
  string|number|undefined|null
>;
type ${BOBE_PREFIX}NativeProperties = ${BOBE_PREFIX}BooleanProps & ${BOBE_PREFIX}NumericProps;
type ${BOBE_PREFIX}CreateTextOrComponent = {
  <T>(a: {defineProps?: T} & Record<any, any>): T;
  <T extends new (...args: any[]) =>any>(input: T): InstanceType<T>;
  (input: any): Text;
};
let ${BOBE_PREFIX}_h!:<K extends keyof HTMLElementTagNameMap>(
  tag: K, 
  options?: ElementCreationOptions
) => Omit<HTMLElementTagNameMap[K], keyof ${BOBE_PREFIX}NativeProperties |'textContent' > & { text: string|number|undefined|null } & ${BOBE_PREFIX}NativeProperties & Record<string, any>;
let ${BOBE_PREFIX}_t!: ${BOBE_PREFIX}CreateTextOrComponent;
`;

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
    this.res.sourceMap.push({
      originOffset: this.templateStart + templateOffset,
      codeOffset: this.virtualStart + codeOffset,
      length
    });
  }
  dent = new Dent(2);
  lines: string[] = [];
  output = ``;

  public idg: IdGenerator;
  public program?: Program;
  constructor(
    public c: BuildVDocCtx,
    public templateStart: number,
    public virtualStart: number,
    public templateCode: string
  ) {
    this.idg = c.idg || new IdGenerator();
    this.program = c.program;
    const tokenizer = (this.tokenizer = new Tokenizer(() => undefined, false));
    tokenizer.setCode(templateCode);
    const compiler = (this.compiler = new Compiler(tokenizer, {
      parsePropertyInlineFragment: {
        enter: node => {
          const prop = node!.parent! as Property & { inlineName: string };
          const component = prop.parent! as ComponentNode;
          const cmpInsName = (component.componentName as PropertyValue & { varName: string }).varName;
          const key = prop.key.key;
          const inlineName = this.idg.name;
          this.idg.i++;
          prop.inlineName = inlineName;
          this.output += `let ${inlineName}=(`;
          this.c.undoneDocPoint.push(this.output.length);
          this.output += `{}: NonNullable<NonNullable<(typeof ${cmpInsName})['${key}']>['defineProps']>) => {\n`;
        },
        leave: () => {
          this.output += `};\n`;
        }
      },
      parseElementNode: {
        propsAdded: node => {
          const _node = node!;
          const tagName = _node.tagName;
          const varName = this.idg.name;
          this.output += `${this.dent.v}let ${varName}=${BOBE_PREFIX}_h('`;
          this.map(this.off(_node), this.output.length, tagName.length);
          this.output += `${tagName}');`;
          this.createSetPropsExp(_node.props, varName);
          this.output += `\n`;
          this.idg.i++;
        }
      },
      parseName: {
        leave: node => {
          const varName = this.idg.name;
          this.idg.i++;
          const name = node! as PropertyValue & { varName: string };
          name.varName = varName;
          const source = name.loc!.source!;
          const sourceName = source.replace(BRACE_REG, match => {
            if (match.length === 1) return ' ';
            return '  ';
          });
          this.output += `${this.dent.v}let ${varName}=${BOBE_PREFIX}_t(`;
          this.map(this.off(name), this.output.length, source.length);
          this.output += `${sourceName});\n`;
        }
      },
      parseComponentNode: {
        propsAdded: node => {
          const _node = node!;
          const name = _node.componentName! as PropertyValue & { varName: string };
          this.createSetPropsExp(_node.props, name.varName);
          this.output += `\n`;
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
          this.output += `)=>{`;
          if (key) {
            this.output += `let ${this.idg.k}=`;
            this.map(this.off(key), this.output.length, key.loc!.source!.length);
            this.output += key.loc!.source + ';';
          }
          this.output += '\n';

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
  createSetPropsExp = (props: Property[], name: string) => {
    const nameDot = `${name}.`;
    props.forEach(_prop => {
      const prop = _prop as Property & { inlineName: string };
      const loc = prop.key.loc!;
      let { source: key } = loc;
      this.map(this.off(prop.key), this.output.length + nameDot.length, key.length);
      let replaceCount = 0;
      key = key.replace(/\-(\w)/g, (_, match) => {
        const res = match.toUpperCase();
        replaceCount++;
        return res;
      });
      key = key + new Array(replaceCount).fill(' ').join('');
      const assignLeft = `${nameDot}${key}=`;
      this.output += assignLeft;
      if (!prop.value) {
        this.output += 'null;';
        return;
      }
      // 是文档片段
      if (prop.inlineName) {
        this.output += `${prop.inlineName} as any;`;
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
    // log('output', this.output);
    // log('errors', this.compiler.errors.map(e => e.message).join('\n'));
    return {
      output: this.output,
      input: this.templateCode,
      sourceMap: this.res.sourceMap,
      errors: this.compiler.errors
    };
  }
}

export class IdGenerator {
  id = Date.now().toString(36);
  i = 0;
  get name() {
    return `a_${this.id}_${this.i}`;
  }
  get h() {
    return `h_${this.id}`;
  }
  get t() {
    return `t_${this.id}`;
  }
  get k() {
    return `k_${this.id}`;
  }
}

// const p = new Bobe2ts(
//   new IdGenerator(),
//   0,
//   `
//     input value={he} style='width: 100px;' onclick={Mes}
//     \${We} abc=1
// `
// );

// const res = p.process();

// const { input, output, sourceMap } = res;
// let verify = sourceMap.map(({ originOffset: inOffset, codeOffset: outOffset, length }) => {
//   return {
//     _in: input.slice(inOffset, inOffset + length),
//     out: output.slice(outOffset, outOffset + length)
//   };
// });
// verify = verify.filter(it => it._in !== it.out);
// console.log(verify);
