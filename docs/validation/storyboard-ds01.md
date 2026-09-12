# DS01 分镜与关键帧预览验收

日期：2026-09-12。版本：0.6.0。范围只到可编辑预览，不创建正式镜头卡，不调用 RunningHub。

## 已验证

- 内置分镜规则基于固定的 Drama Skills 提交适配，来源、哈希、删改边界和 MIT 许可见 [复用记录](../source-reuse.md)。
- 模型上下文只包含当前剧本与通过“拍摄资产”关系连接的人物、场景、道具文字。确认参考图只发送用途，不发送图片内容或本地路径；未关联资产不发送。
- 每镜要求连续原文依据、拍摄理由、景别构图、机位与摄影机、起点、动作、终点、声音、成片计划时长和静态起始关键帧。无效镜头逐项说明原因，其他有效镜头继续保留。
- 任务独立保存到 `影视项目/分镜设计/`，保存实际规则和完整输出协议快照。人工修改自动保存并使用 revision 冲突保护。
- 生成预览前后正式镜头数量不变。取消迟到响应不落新任务；完整重启后恢复原预览、人工修改和规则快照。
- 新面板加入后，资产整理 10 项和资产 Skill 选择 5 项隔离宿主回归继续通过。旧测试脚本显式指定要验证的通用剧情资产 Skill，避免被测试库遗留的项目默认值影响。

## 验证结果

```text
npm run typecheck
npm test
npm run build
npm run test:storyboard
node scripts/launch-test-obsidian.mjs --restart
npm run test:storyboard:reopen
npm run test:assets-ai
npm run test:skills
```

- 类型检查和构建通过。
- 53 项逻辑测试通过，其中 6 项覆盖分镜上下文、逐项校验、只预览不入卡、规则快照、编辑冲突和取消。
- 分镜隔离宿主 4 项操作通过，完整重启恢复 1 项通过。
- 资产整理 10 项、资产 Skill 选择 5 项宿主回归通过。
- `git diff --check` 通过。

宿主脚本使用本机模拟 Chat Completions 接口和新写的中性剧情，不连接真实模型，不产生外部生成费用。测试截图与结果保存在忽略提交的 `.local/storyboard.png`、`.local/storyboard-results.json` 和 `.local/storyboard-results-reopen.json`。

## 正式资料库安装

- 已将构建产物安装到当前使用资料库的 `.obsidian/plugins/obcanvas-creator/`，包括 `main.js`、`styles.css`、`manifest.json` 和两份 MIT 许可文件。
- 插件旧版备份位于 `.obsidian/obcanvas-backups/20260912-100726-0.5.0/plugin/`，不放在插件扫描目录中，避免重复插件 ID。
- 安装后完全退出并重新打开 Obsidian；界面显示“本地资料库 · 0.6.0”，剧本卡中出现“分镜与关键帧 · 试点”和“生成分镜预览”。
- 安装前后对当前项目的 11 份笔记、布局、媒体引用和既有任务文件核对 SHA-256，校验值保持一致。没有为了安装触发真实模型，也没有新建分镜任务。
- 正式安装文件与仓库构建文件的 SHA-256 一致：`main.js` 为 `d1f4d86125560708a0632d8984b163c16295e1b81e78b5f8f9cac8a98c57be3a`，`styles.css` 为 `b1bdb324caf5d05b42c9a4afe9b48343e44b5cbcba92cf8a258344d42aa0d7da`，`manifest.json` 为 `1966a9ab4df44d65bc8ae49eae3b0d7290121da6af89128c5debbd22a8a545b8`。

## 尚未验证

- 还没有使用同一真实文字模型，对“最低限度任务说明”和“Drama 适配规则”做四次小样对照。
- 当前结构检查不能证明景别选择恰当、交叉剪辑有张力或静态关键帧足够好画，这些需要按 [接入计划](../drama-skills-integration-plan.md) 第 7 节人工评分。
- 分镜阶段还不能选择或自定义 Skill，也不能把预览确认成正式镜头卡；两项都属于 DS02，必须等待真实质量门槛通过。
- 未验证 MiniMax H3、参考图顺序、视频提示词、生成时长或 RunningHub 工作流；这些属于 DS03–DS04。
