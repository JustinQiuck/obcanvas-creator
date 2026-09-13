# GS01b 全片镜头顺序工程验收

日期：2026-09-14。基于 `6c0b45e`。工程切片通过；开发构建仍沿用 0.8.0 标识，正式资料库未更新。GS01a 的 AI 质量门槛保持未通过，本轮使用已存在的手工镜头完成顺序工程准备，没有新增真实模型请求或 RunningHub 操作。

## 用户可见行为

项目“分镜”工作区增加全片镜头顺序区域。旧场次顺序先组成可编辑草案，用户确认后保存；可排列 A1 → B1 → A2。新镜头单列待排，需要明确加入。按场次查看时保留全片序号；画布中的场次列表来自全片顺序，旧排序按钮关闭，避免两处顺序相互覆盖。

删除镜头保留其 ID 和内部位置，原笔记恢复后回到相应位置。排序只写项目笔记，原镜头正文、媒体采用与旧场次顺序保留。过期顺序或成员变化拒绝覆盖；保存失败保留草案，可原地重试。正式镜头已经入卡但尚未安排顺序时显示待排，不需要重新入卡。

## 逻辑与构建

- `npm test`：82/82，通过。
- `npm run typecheck`、`npm run prepare:test-vault`：通过。
- 新逻辑覆盖初始化无写入、跨场次投影、新镜头待排、失败重试、缺失 ID 保留、镜头/项目删除恢复、并发顺序冲突、成员变化、跨项目和异常 ID 拒绝、虚拟项目初始化及已启用顺序下的 AI 入卡幂等。
- 页面相关改动位于 `src/ui/project-order-panel.tsx`、`src/ui/library-workspace.tsx`、`src/ui/workbench.tsx` 和样式；正式顺序字段及读写位于 `src/model.ts`、`src/project-order.ts` 和 `src/storage/vault-records.ts`。

## 隔离 Obsidian 验收

Browser plugin not available，按 frontend-testing-debugging 指南使用仓库已有 Playwright/CDP 框架。仅访问 `.local/test-vault`，Obsidian 1.13.7，URL `app://obsidian.md/index.html`，标题“影视画布 - test-vault - Obsidian 1.13.7”，桌面视口 1080×939。页面含有实际项目与镜头内容，无错误覆盖层，采集的页面错误为 0。截图已查看；首次截图发现筛选标签继承纵向表单样式而居中，改为靠左横向排列后重启复核。未进行移动端验收。

`node scripts/test-project-order.mjs` 的 4 项操作通过：

1. 整理旧顺序草案时项目仍无 `editOrder`；未确认切换被提示阻止；通过上移按钮排成 A1 → B1 → A2 后确认保存。
2. 新建 A3 明确待排；加入片尾再移动后，按场次 A 显示 A1/A3/A2，对应全片第 1/3/4 位；画布同场次投影一致，旧上移入口不存在。
3. 经实际 Vault 回收站操作删除 B1，列表忽略它并提示缺失；恢复同 ID 原笔记后位置重现。原场次和原镜头笔记逐字不变。
4. 受控地让项目笔记 `process` 抛出写入错误，保存提示失败且正式顺序保持原值；恢复写入后重试成功。测试临时替换在 finally 恢复，没有保留运行时补丁。

`node scripts/test-project-order.mjs --reopen`：完整重启后 1 项恢复检查通过，正式顺序、中文列表及原项目/镜头笔记一致。该轮最终保存 A1 → A3 → B1 → A2；前三镜 A1 → B1 → A2 的目标排列已在第 1 项独立验证，后续为验证插入、改序与恢复而调整。

受影响的原分镜工作区另执行 `node scripts/test-storyboard-apply.mjs`，5 项规则配置、入卡确认、保留旧文件及历史访问回归通过；完整重启后 `--reopen` 的 1 项恢复回归通过。这组使用隔离模拟接口，不代表 AI 创作质量通过。

证据保留在 Git 忽略目录：`.local/project-order-results.json`、`.local/project-order-results-reopen.json`、`.local/project-order-checkpoint.json`、`.local/project-order.png`、`.local/gs01a-results.json`、`.local/gs01a-results-reopen.json`。

## 范围与限制

- 已确认全片顺序是后续生成段的输入；本轮未实现段的拆分合并、执行先后或制作包，所以不将 G02 关于生成执行顺序的后续验收一并勾选。
- 顺序草案只有明确确认后持久化。离开工作区会提示保存/放弃；直接关闭插件不恢复未保存的顺序草案。
- `Vault.process` 保证项目笔记的顺序并发检查；它不是多笔记事务。外部同时移动/删除其他笔记时，通过保存前结构重查和目录错误报告处理，未验证操作系统断电或外部同步工具的全库事务。
- 已启用全片顺序的资料库不能依赖 0.8.0 旧插件继续维护同一成片顺序。正式升级和数据备份尚未执行，不能用单独回退插件包代替数据恢复。
