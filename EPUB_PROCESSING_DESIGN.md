# Version 2：EPUB 结构保真与精确回写设计

最后更新：2026-08-25

## 1. 当前结论

Version 2 之前已经写明“保留 OPF、spine、导航、插图、CSS、ruby 和脚注”。009 实现只读导入层；010 又完成已有双语普通中文段的草稿、稳定 DOM 路径与源摘要复核、原 XHTML 精确内容区间替换、未改资源核对、标准 `mimetype` 和真实样书校样往返。复杂 tokenized-block、正式纯中文/双语编排、EPUBCheck 和阅读引擎回归尚未实现，所以仍不能说 EPUB 输出已经达到成品标准。LinguaGacha 的 `epub-ast.ts` 和 `epub-writer.ts` 值得参考，其稳定定位与摘要校验思路应吸收；Version 2 不复制源码，并对复杂行内结构、静默降级和输出验证采用更严格策略。

## 2. 对参考实现的核验

LinguaGacha 当前实现中值得借鉴的部分：

- 从 `META-INF/container.xml` 找 OPF，再解析 manifest、spine、EPUB 3 nav、EPUB 2 NCX 和标题；
- 使用本地标签名和同级位置生成元素路径，不依赖命名空间前缀；
- 区分元素 `text` 与元素后的 `tail` 文本槽；
- 为源文本计算摘要，写回前重新定位并验证摘要，避免原项目变化后错位覆盖；
- 跳过 script、style、code、pre、rt 等不应进入普通翻译的子树；
- XML 优先解析，常见不规范 XHTML 才容错回退；
- 复制未修改资源，导航页不做普通双语正文插入；
- 写回前过滤 XML 非法码点。

需要避免照搬的部分：

- 含结构化 ruby 的块采用 `block_text` 后，目标块写回时会用单一文本节点替换全部 children。这样能避免把 `rt` 注音送进翻译，但目标侧可能丢失 ruby、强调、链接等行内结构。
- 缺少 AST metadata 时存在顺序写回 legacy 路径。它有兼容价值，但 Version 2 正式导出不能把这种不确定定位当成静默降级；定位失败必须阻止导出或要求用户明确选择恢复模式。
- 参考写回器整体使用 STORE 重新打包。Version 2 应保留每个原资源合理的压缩策略，同时强制 `mimetype` 位于第一项且不压缩，并进行标准校验。

参考源码：

- <https://github.com/neavo/LinguaGacha/blob/main/src/backend/file/formats/epub/epub-ast.ts>
- <https://github.com/neavo/LinguaGacha/blob/main/src/backend/file/formats/epub/epub-writer.ts>
- <https://www.w3.org/TR/epub-33/>

## 3. 导入流水线

### 3.1 安全打开

1. 检查文件大小、条目数量、单条解压大小和总解压倍率，拒绝 ZIP bomb。
2. 拒绝绝对路径、反斜杠路径、空路径段和 `..` 路径穿越。
3. 保存只读原包快照和整体摘要；所有写回都从该快照派生，不原地修改用户文件。
4. 识别加密、签名、字体混淆、脚本、远程资源、固定版式和媒体覆盖；不支持的高风险特性进入明确复核，不假装普通小说处理。

### 3.2 发现包结构

1. 校验根目录 `mimetype`。
2. 解析 `META-INF/container.xml` 的所有 rootfile。
3. 让用户选择或按明确规则选定 rendition，不猜测多 OPF。
4. 解析 OPF metadata、manifest、fallback、spine、guide、nav、NCX、page progression、固定/流式布局和媒体覆盖关系。
5. 建立资源图与源摘要清单，记录所有内部 `id`、`href`、`src` 和片段锚点。

### 3.3 XHTML/SVG 文本抽取

- XML 模式优先；容错 HTML 只能产生“已修复输入”警告，并保存修复前后差异。
- 普通块使用精确 `text`/`tail` 槽协议。
- script、style、code、pre、kbd、samp、var、noscript、SVG、MathML、`rt` 和 `rp` 默认是受保护子树。
- `alt`、`title`、ARIA 文本、目录标题、OPF 元数据是否翻译由独立范围设置控制，不与正文混在一起。
- 每个可翻译单元保存文档路径、块路径、节点路径、槽类型、源文本摘要、源顺序、行内骨架摘要和项目版本。

## 4. 复杂行内结构不能扁平化

普通段落可以逐槽翻译；包含 ruby、em、strong、链接、脚注锚、行内图片或特殊 span 的段落使用 `tokenized-block`：

1. 程序把不可改的行内元素转换为带唯一 ID 的不透明开闭标记；
2. 模型翻译整块可见正文，可以按中文需要调整语序，但必须完整回传所有标记；
3. 程序验证标记集合唯一、无丢失、无新增、嵌套合法；
4. 以原 DOM 节点为模板重建目标块，只写可翻译文本，不允许模型改属性；
5. 标记丢失、重复、嵌套破坏或无法投影时阻止写回，不能退化成纯文本覆盖。

默认 ruby 策略是保留 ruby 元素和 `rt` 原始读音，只翻译 ruby base 的可见文字。后续界面可以允许用户选择“纯中文侧移除读音、双语原文侧保留”，但这必须是显式导出选项并接受结构测试，不能在后台自行决定。

## 5. 精确写回契约

每一次写回必须同时满足：

- 文档路径安全且仍存在；
- 稳定节点路径仍能解析；
- 当前源文本摘要等于导入时摘要；
- 目标片段数量等于源槽数量；
- 不接触受保护子树；
- 不修改 `id`、`href`、`src`、`srcset`、`epub:type`、`role` 等结构属性；
- 不透明行内标记全部返回且嵌套有效；
- 目标文本不含 XML 非法码点；
- 同一源节点只能被一个已批准译文版本写回。

任何条件失败都生成可定位问题并阻止正式导出。Version 2 可以另设“恢复工具”帮助旧项目重新绑定节点，但恢复结果必须人工确认后生成新的稳定映射。

## 6. 纯中文与日中双语输出

### 6.1 纯中文

在原结构骨架内替换已批准的可翻译文本槽。未翻译、失败或未审校正文节点存在时阻止成品导出；用户可以导出带明确“未完成”标记的调试副本，但不能与最终成品混淆。

### 6.2 日中双语

不能简单给整块原文加透明度后复制。Version 2 使用独立容器包裹一对稳定映射块，提供日上中下、中文优先或 CSS 切换样式。导航、NCX、OPF metadata 和脚注目标不重复插入正文块；脚注和返回链接按输出模式重建并校验。

### 6.3 术语注释

戏称、双关和称号注释使用稳定源节点锚定。EPUB 3 优先 `noteref`/`footnote`，兼容模式回退为章末注；正文锚、注释 ID、返回链接和读者知识边界全部验证。注释是辅助层，不得向正文添加日文没有的信息。

## 7. 打包与验收

输出前必须：

1. 保证 `mimetype` 是 ZIP 第一项、内容精确为 `application/epub+zip` 且不压缩；
2. 保持未修改二进制资源字节一致，修改过的 XML/CSS 有差异清单；
3. 重新解析 container、OPF、manifest、spine、nav/NCX 和所有内部链接；
4. 比较导入/导出的资源图、阅读顺序、ID 和锚点，拒绝丢资源、断链和重复 ID；
5. 运行 EPUBCheck；
6. 在至少两个阅读引擎做自动打开与目录/脚注跳转测试；
7. 对 ruby、强调、图片、脚注、多层目录、竖排、固定版式和异常 XHTML 使用回归样本截图比对。

W3C EPUB 3.3 明确要求 `mimetype` 为 ZIP 第一项且不得压缩；OPF manifest 描述出版资源，spine 定义默认阅读顺序，因此 EPUB 不能被当作若干 HTML 文件随意重建。

## 8. 当前代码与未完成项

本次新增：

- `src/core/epub/epubStructurePolicy.ts`：正式导出的结构策略与单次写回验证器；
- `src/core/epub/epubStructurePolicy.test.ts`：摘要错位、片段错位、路径穿越、受保护节点/属性、行内标记和非法 XML 字符测试。

已完成：ZIP 中央目录和 mimetype 预检、container/OPF parser、NAV/NCX、XHTML DOM 只读提取、稳定路径和源摘要、原 EPUB BLOB、spine/文本块 SQLite v2 映射、script/外链隔离，以及四本真实 EPUB 回归。

010 新增：纯文本隔离阅读器、阅读位置、双语普通中文段草稿、源摘要/DOM/节点 XML 三重复核、原 XHTML 词法区间替换、原编码/BOM 保留、资源集合和未改资源内容核对、校样导出 UI，以及两种真实双语 EPUB 往返。详见 `EPUB_READER_AND_PROOF_EXPORT.md`。

尚未完成：tokenized-block 编解码、复杂行内结构的真实译文替换、新增中文节点与正式版式编排、EPUBCheck、多个阅读引擎回归和最终成品导出。只有这些完成并再次通过真实 EPUB 往返测试后，才能说 EPUB 处理已经达到成品标准。
