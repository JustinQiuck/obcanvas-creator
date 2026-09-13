# 原画布源码复用记录

复制日期：2026-09-11。来源仓库：https://github.com/basketikun/infinite-canvas.git ，本机来源目录 `/Users/aliceboy/项目文件/画布`，来源 HEAD `b66936d891b82c2b51c1ed05e1a6eae3e31d4ca3`。选中文件复制／提取后，修改只发生在本仓库；运行和构建不引用来源目录。

| 来源路径 | 实际源文件 SHA-256 | 本仓库目标 | 来源状态与适配 |
| --- | --- | --- | --- |
| `web/src/components/canvas/infinite-canvas.tsx` | `804aaf5c270b5b5c2106953f0d10894556dadd0f18c3a7da2a4649d62ce7415e` | `src/canvas/infinite-canvas.tsx` | 已提交内容；复制后保留鼠标中心缩放公式、48 单位网格、视口变换与平移方式，删除网页 store、弹层和 Tailwind 依赖；键盘限制在画布焦点，指针捕获归属容器，不再设置 body 光标；主题读取所属文档，卸载移除监听和观察器 |
| `web/src/lib/canvas-theme.ts` | `21c1bfc160058cce9489817e44d2f044ce29a3ac647b4e02b2950e2b4a3c21a3` | `src/canvas/theme.ts` | 已提交内容，完整复制明暗主题色值 |
| `web/src/types/canvas.ts` | `512d95850e79b2c59f1d7d21111d49cf8d48d0bd6c44be2e1dc59af6ac218505` | `src/canvas/types.ts` | **有未提交修改的工作区快照**；仅提取前 10 行的 Position 与 ViewportTransform，不导入生成节点／业务记录类型 |
| `LICENSE` | `4a3ea42531a7fc18b11471baa1676b11ef6c8badee4e02711392d9fdc8f59d58` | `licenses/infinite-canvas-MIT.txt` | 原样保留 MIT 许可和 Copyright (c) 2026 basketikun |

`shot-card.tsx` 是针对镜头笔记新写的最小卡片，未复制原 `canvas-node.tsx`。原卡片的大量生成、插件宿主和素材库依赖不属于此切片。未引入连线、网页入口、RunningHub 服务或浏览器整库持久化。

安装文件的 `main.js` 包含完整上游 MIT 声明，打包同时携带独立许可文本。来源文件校验值记录的是**适配前**的实际内容，不是本仓库改造后的校验值。

## 0.3.0 自由画布接入

本轮未再复制原网页文件。继续适配已经引入的 `infinite-canvas.tsx`（空白处直接平移、总览、按需关闭详情），沿用已记录的主题和 MIT 许可。新增 `graph.ts`、`board-card.tsx` 和按需详情由本仓库独立实现，针对 Vault 记录与素材投影，不依赖原网页的浏览器数据库或生成服务。旧镜头的布局键继续使用原 ID。

## 0.4.0 AI 助手与资产准备

本次在本仓库独立编写模型适配器、任务执行与确认流程、资产引用和内置 `production-asset-extractor` Skill。仅借鉴按任务加载 Skill 与受控项目读写的结构，没有复制 huobao-drama 的 Skill 正文、Agent 框架或业务实现，也没有新增对原画布目录的运行依赖。既有画布来源与 MIT 署名继续保留。

0.5.0 的 `mv-asset-extractor` 及可选 Skill 的配置、导入导出与执行逻辑均在本仓库独立编写。未复制外部 MV／导演 Skill，不导入全局技能目录；保留既有画布 MIT 署名。

## 0.6.0 Drama Skills 分镜方法适配

来源仓库：https://github.com/zenstory-ai/drama-skills.git 。固定提交 `4c40ca6101648579b2455d0c0d890ce701f05173`，MIT License。运行时不读取上游目录、不执行 Python、命令或网页工具；只打包已审阅并改写为当前文字接口的规则。原文文件及适配前 SHA-256：

| 上游文件 | 上游 SHA-256 | 本地用途 |
| --- | --- | --- |
| `skills/short-drama-storyboard/SKILL.md` | `f893fb81cb45f02affd985fcb225cfa7a261f3020c33c4de4ce48c5669299944` | 阶段边界、来源回查、分镜与关键帧职责 |
| `skills/short-drama-storyboard/references/shot-craft.md` | `19f33418eb236fc9a2c0c650fcce1d46b2682ce49b03e7e4891a3f1c740bfe55` | 镜头目的、景别尺度、机位动机、起止状态与切镜依据 |
| `skills/short-drama-storyboard/references/keyframe-craft.md` | `02c095439f73211817a3f75ae2af264459356060755eecaf51ce11c1512ce2ca` | 静态起始关键帧、空间朝向、手部持物和动作结果排除 |
| `skills/short-drama-storyboard/references/scene-visual-plan.md` | `404b7634d0947335d69f0ee93b7df11aab530865c66c97d9510f58d5423377c6` | 观众立场、空间压力、揭示时机和声音策略 |
| `LICENSE` | `840bdb5ba503ca4397f5a6049e6e8da182330f83bb70006d5656d7dd00674e9b` | 原样保存到 `licenses/drama-skills-MIT.txt` |

本地 `skills/drama-storyboard/SKILL.md` 是 6,511 字节的中文适配包，SHA-256 为 `03fe97b444fbd46cf47df7571e2c155ef48649d8050f0549792d8079a439806c`。它删除上游文件路径、ID、Agent 工具和多文件交付假设，补入当前产品的 JSON 输入、独立预览、交叉剪辑、成年亲密叙事的画外克制表达及 `TBD` 规则；宿主在 `src/ai/storyboard-skill.ts` 追加固定输出协议。构建产物同时内嵌 Drama Skills MIT 文本，并随安装包复制独立许可文件。

2026-09-14 开发候选版本为 `upstream-4c40ca-adapt-2`，本地增加逐镜决策、未知光线、静态构图与持物连续性核对；来源上游提交不变。这是本项目的规则修正，真实质量仍未通过，见 [GS01a 验证](validation/storyboard-gs01a.md)。
