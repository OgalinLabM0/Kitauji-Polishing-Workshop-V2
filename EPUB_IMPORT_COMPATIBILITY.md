# EPUB 导入兼容性与真实样书报告

最后更新：2026-08-26

## 1. 当前完成范围

作品入口现在接受 `.epub` 和 `.txt`。EPUB 导入保存完整原包，建立 package、阅读顺序、XHTML 文档和文本块索引，并识别日文原书或日中交替结构。导入本身仍是不可变源文层：不会执行书内脚本、不会加载外链、不会修改原文件。010 已在其上增加纯文本阅读、已有普通中文段校改和校样副本导出，详见 `EPUB_READER_AND_PROOF_EXPORT.md`；这不等同于自动翻译或正式成品导出。

## 2. 导入安全门

在 JSZip 解压前，程序直接读取 ZIP 中央目录并检查：

- 文件上限 512 MiB、最多 10,000 项、单项解压后最多 128 MiB、总解压最多 1 GiB；
- 单项和整包压缩比例不得超过 200；
- 拒绝路径穿越、绝对路径、反斜杠路径、大小写重复路径、加密项、分卷 ZIP、ZIP64 和不支持的压缩方法；
- `mimetype` 必须是第一个本地项、使用 STORE，并精确等于 `application/epub+zip`；
- 必须存在 `META-INF/container.xml`，CRC 必须通过。

XML 使用非执行型 DOM 解析。自定义实体和内部 DTD 被拒绝；普通 XHTML doctype 在解析副本中移除，原始 EPUB 字节不变。XHTML 中的 script 只计数并警告，外部 URL 只计数，不交给 Renderer 执行或联网读取。

## 3. 结构索引

程序通过 container 定位 OPF，解析 metadata、manifest、spine、EPUB 3 nav 和 EPUB 2 NCX。每个 spine XHTML 保存原文摘要、大小、标题、线性标记、脚本/ruby/图片统计，并抽取 p、标题、列表项等可见块。

每个文本块保存 spine 顺序、DOM 路径、源行、标签、语言、可见文本、序列化源 XML、SHA-256、样式提示和日中对应序号。ruby 以“基字《读音》”进入可供后续模型理解的文本，同时完整 ruby XML 和原包仍保留。当前双语识别覆盖：

- 中文块后紧跟显式 `lang="ja"` 的日文块；
- 中文块后紧跟包含日文假名且以低 opacity 显示的日文块。

这些判断只建立候选对应关系，不授权改写任何原文。

## 4. 四本真实样书

| 样书 | 结构 | 结果 | 阅读项 | 有效文本块 | Ruby | Script | 导入耗时 |
| --- | --- | --- | ---: | ---: | ---: | ---: | ---: |
| `JP-幼女戦記 14…epub` | EPUB 2、根目录 OPF、NCX、RTL | 日文原书 | 40 | 5,377 | 777 | 0 | 0.9 秒 |
| `病弱少女…epub` | EPUB 3、`item/standard.opf`、NAV+NCX、RTL | 日文原书 | 38 | 4,612 | 521 | 38 | 0.6 秒 |
| `SCJP-病弱少女…epub` | 与原书同 spine；中文后接 `opacity:0.4` 日文 | 日中双语，4,528 对 | 38 | 9,232 | 521 | 38 | 0.8 秒 |
| `Polished_SC&JP-幼女戦記-Web.epub` | EPUB 2、126 个正文文档；中文后接 `p lang=ja` | 日中双语，40,293 对 | 127 | 83,099 | 0 | 0 | 3.6 秒 |

四本同时写入一个 SQLite 项目库后共有 243 个阅读项和 102,320 个文本块，`PRAGMA integrity_check` 为 `ok`，数据库约 126 MiB。

病弱少女原书与 SCJP 版有 27 个 ZIP 项逐字节相同，48 项发生变化；图片保持不变，但 39 个 XHTML、5 个 CSS、OPF、NCX、container、JavaScript 等都被生成器改写，且删除了 `rights.xml`。因此 Version 2 以后从日文原书生成双语版时，只应在受控 AST 位置插入中文，不能照搬某个生成器“重写整包”的行为。

Web 双语版的 OPF 使用非标准语言代码 `jp`；当前按日文识别并显示警告，不静默修改原元数据。

## 5. SQLite 源文表（v2 建立，当前库为 v3）

`source_archives` 保存原 EPUB BLOB；`epub_documents` 保存 package 和安全报告；`epub_spine_items` 保存阅读顺序；`epub_text_blocks` 保存稳定 DOM 位置、原文、源 XML、摘要和日中对应。全部记录与当前项目状态在一个 `BEGIN IMMEDIATE` 事务中提交，失败回滚。当前 SQLite 为 v3：v1 TXT 项目依次迁移到 v2/v3，v2 EPUB 项目增加阅读位置和草稿表；迁移后经过外键与完整性检查。

## 6. 当前限制

- 不支持加密 EPUB、ZIP64、分卷 ZIP、非 UTF-8 文件名或超出当前安全阈值的包；这些情况明确阻断，不尝试猜读。
- 当前只从 spine 的 XML/XHTML 提取正文；非 spine 附件会保留在原包，但不会成为翻译块。
- 双语对应是结构化启发式结果，模型预读前仍需做数量、相邻关系和源文覆盖复核。
- 原始 CSS、竖排、图片和脚本作为资源保留，但当前总览不是 EPUB 阅读器，不渲染书页样式。
- 精确译文写回、tokenized inline、纯中文/日中双语编排、重新打包和 EPUBCheck 尚未实现。
