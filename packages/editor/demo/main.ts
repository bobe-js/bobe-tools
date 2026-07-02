// 从 editor 的 full 入口拿到创建函数，并引入虚拟文件类型。
import { createBobeEditor, type EditorFile } from '../src/full';

// 记录 fixture 目录前缀，用于把 Vite 返回的文件路径裁剪成相对路径。
const FIXTURE_ROOT = './fixtures/local-folder/';
// 通过 Vite 在开发和构建阶段静态收集 fixture 目录中的可编辑文件。
const fixtureModules = import.meta.glob<string>('./fixtures/local-folder/**/*.{ts,tsx,js,jsx,css,json}', {
  // eager 让 glob 结果立即变成内容对象，而不是异步 import 函数。
  eager: true,
  // ?raw 让 Vite 以纯文本读取文件内容。
  query: '?raw',
  // 读取 raw 模块的默认导出，也就是文件文本。
  import: 'default'
// 完成 fixture 文件收集配置。
});

// 将 Vite glob 得到的路径和内容转换成 editor 可消费的虚拟文件列表。
const files: EditorFile[] = Object.entries(fixtureModules).map(([path, content]) => ({
  // 去掉 fixture 根目录前缀，让路径相对于本地文件夹根目录。
  path: path.startsWith(FIXTURE_ROOT) ? path.slice(FIXTURE_ROOT.length) : path,
  // 保留 raw 读取到的源文件文本。
  content
// 完成单个文件到 EditorFile 的转换。
}));

// 把 editor 挂载到 demo 页面中的 #app 节点。
createBobeEditor(document.getElementById('app')!, {
  // 指定虚拟初始目录，用来验证相对文件会被挂载到该目录下。
  initialDirectory: '/demo/local-folder',
  // 使用相对路径声明入口文件，实际会解析到 initialDirectory 下。
  entry: 'src/main.ts',
  // 默认打开入口文件，验证初始化时的选中文件路径也会被解析。
  initialPath: 'src/main.ts',
  // 将从本地 fixture 文件夹读取出的文件交给 editor 初始化。
  files,
  // demo 打开后自动运行 preview，方便验证入口、相对 import 和 CSS。
  autoRun: true
});
