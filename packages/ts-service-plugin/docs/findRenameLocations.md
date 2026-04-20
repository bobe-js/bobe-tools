1. 不具有 bobe 模板语法的文件 执行 findRenameLocations 时
   1. 结果中  属于虚拟文档的 IIFE 部分的 location 应该映射回 templates 中
   2. 结果中 属于虚拟文档的真实部分，应该抛弃，避免重复引用
   3. 结果中 属于真实文档的，直接复用
2. 具有 bobe 模板语法的文件 执行 findRenameLocations 时
   1. 直接执行 `findRenameLocations(vFileName...) ` 
   2. 拿到的结果
      1. 不是虚拟文件中的直接复用
      2. 是虚拟文件中的
         1. 虚拟部分
            1. 修改 fileName
            2. 如果属于 header
               1. 执行 `findRenameLocations(vFileName, map.virtualStart+halfLen+1, ...)` 拿到内部的可重命名结果
               2. 修正 fileName 和 textSpan 添加到列表中
            3. 不属于 header
               1. 修正 textSpan 即可
         2. 真实部分 修改 fileName 并复用

