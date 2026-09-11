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
