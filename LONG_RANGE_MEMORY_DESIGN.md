# Version 2：长程语义记忆设计

最后更新：2026-08-27（1.1.4 / human-reading-v4）

## 1. 目标与原则

Version 2 由软件维护有时间、方向、证据和知识边界的作品记忆，不依赖一个无限增长的聊天历史。术语、人物状态、A→B 关系、称呼、声音、叙事层、事件、秘密、伏笔、双关和人工翻译决策使用不同数据类型。

核心原则：

- 原文证据优先于模型断言；
- 候选与事实分离；
- 当前读者知识、译者未来知识和每个角色的知识分离；
- 新状态替代旧状态但不删除历史；
- 相关性和时间规则优先于纯语义相似；
- 长期记忆只帮助理解，不能授权增译。

## 2. 字符级时态事实图

作品位置使用 `chapter + segment + UTF-16 offset`。evidence、alias、claim、event、character knowledge、context frame 和 world-state snapshot 都可保存字符起止位置。

同一段内发生变化时：

1. 段首查询只读取 offset 0 已生效的状态；
2. 后半段的新状态进入未来/变化通道，不覆盖段首；
3. 原文按所有变化点切成精确 slice；
4. 每个 slice 附带从该 offset 开始的 transition；
5. 重复短句没有唯一位置时标记 ambiguous，不猜 offset。

这使“剪发前是长发、剪发后是短发”即使出现在一个段落里也能用不同状态翻译。

## 3. 六类记忆与四级保留

记忆类别：

- `canon`：身份、世界规则、秘密、核心设定；
- `character`：人物声音、习惯和稳定人物模型；
- `relationship`：定向关系和称呼阶段；
- `event`：关键事件；
- `state`：年龄、外貌、伤势、身份阶段等时态状态；
- `episode-detail`：局部情节细节与摘要。

保留策略：

- `permanent`：系列级核心设定；
- `stable`：长期人物、关系、状态和关键事件；
- `episodic`：章节/若干章内有用；
- `working`：当前场景工作记忆。

类别和最大检索范围由确定性策略决定。模型不能把天气或普通动作擅自升级为系列设定；只允许在有限范围内建议重要度，或缩小检索范围以减少噪声。

## 4. 巩固、取代与归档

每章预读完成后执行一次巩固：

- confirmed/locked、置信度达标且 exact evidence 的记录进入 consolidated；
- 冲突进入 conflict，低置信度保留 candidate；
- 同轨的新人物/关系/状态记录用 `supersedes_memory_id` 指向旧记录；
- 旧记录成为 superseded 历史而非被删除；
- 过期 working 和低重要 episodic 记忆按策略 archived；
- 巩固运行保存 source signature，输入不变时不会重复改写。

全书预读结束后生成卷级档案，包含章节摘要和高价值稳定记忆。章节摘要只在章节末尾成为当前读者已知，卷档案只在全书末尾成为当前卷读者已知，防止整章/整卷摘要倒灌前文。

## 5. 三类知识通道

### 读者安全通道

只包含当前位置已向读者揭示的事实，可以参与当前译文表达，但仍不得添加原文没有的信息。

### 译者专用未来通道

后文真相可以帮助避免前文误解，但带 `maySurface=false`。模型只能选择不与未来冲突、同时保持当前含混的译法。

### 角色知识通道

按人物保存 knows/believes/suspects/denies 和有效位置。角色台词不得泄露其当时不知道的真相。

## 6. 跨卷系列记忆

系列关联默认不存在，且软件不根据标题自动猜测。用户必须明确填写系列名和卷序。

较早卷向较晚卷提供：

- confirmed/locked、原名和译名一致的系列实体；
- confirmed/locked、无冲突的术语；
- 高价值系列/卷级记忆；
- 有证据的角色或系列文风决策。

未来卷不能反向污染早期卷；冲突项不进入自动上下文。解除系列关联后，跨卷内容立即停止检索，但各项目自己的数据仍保留。

## 7. 文风决策与歧义

文风记忆保存 owner（系列、叙述者、人物、关系、场景）、decision kind、原文模式、目标策略、理由、证据和有效区间。它用于保持人称、称呼、句法节奏、标点、口癖、方言和脏话强度，不是一个全书统一的“风格字符串”。

歧义保存多个 interpretation，并与事实表隔离。处理策略包括 preserve、resolve、transliterate、annotate 和 review。只有人工或可靠后文证据才能裁定；preserve 会明确禁止翻译模型擅自选边。

## 8. 嵌套叙事与 A→B

context frame 支持 parent frame、nesting depth、worldline、story time、scene、viewpoint、narrator、direct/indirect/free-indirect/monologue、quote level、speaker 和 addressee。

事件和当前句语义角色分别保存 agent/patient/recipient。翻译前，本地日语形态证据检测使役、受身、使役受身、授受、格助词和引语边界；模型角色与强证据冲突时降置信度并进入复核。这个层是保守交叉检查，不冒充完整依存句法证明。

## 9. 检索与译文依赖

每批只取当前相关材料：实体命中、关系方向、场景/worldline、时间位置、重要度和近期性共同排序，并设置数量上限。译文版本记录实际使用的 entity/claim/event/frame/evidence/memory/style/ambiguity/syntax/series ID。

后文知识、术语、文风或歧义裁定变化时，系统找到依赖旧材料的译文，保留旧版本并转 `needs-human`，创建 blocking 复核；不会未经确认批量重写。

## 10. GraphRAG

GraphRAG 或向量检索可以在超大系列中帮助召回候选，但不是硬约束核心。候选必须回到 SQLite v9 的时态事实图验证证据、方向、位置、worldline 和知识边界后才能进入提示词。语义相似度不能覆盖明确的 A→B、有效区间或读者边界。

## 11. 质量边界

该架构显著缩小短上下文机翻与持续阅读的差距，但最终质量仍受模型日中能力、文学判断和作品难度限制。自动测试可以证明数据和流程行为，不能替代专业译者整本盲评；通过盲评前不能宣称任意作品已经等同优秀人类译者。
