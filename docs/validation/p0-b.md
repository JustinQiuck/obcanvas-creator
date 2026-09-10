# P0-B 画布接入验收

日期：2026-09-11。宿主为 macOS 上实际运行的 Obsidian **1.13.7**，测试库和独立应用配置均位于本仓库 `.local/`。原画布和个人资料库未修改。

## 结果

D04 已完成：复用的网格、鼠标中心缩放、平移及原明暗配色已接入插件；新增的镜头卡按稳定 ID 关联笔记；布局单独写入资料库。源码 SHA-256 与 MIT 归属见 [复用记录](../source-reuse.md)。

- 真实鼠标拖动镜头卡，读取磁盘布局，验证坐标从 `(0,0)` 变为 `(75,45)`。
- 滚轮缩放，再平移 `(30,15)`，验证比例与视口写入；镜头 Markdown 逐字保持不变。
- 完整退出并重启专用 Obsidian 后，选中的镜头、卡片坐标和视口恢复。
- 打开第二个标签页并缩放，确认第一个标签页的视口不跳动。
- 在旁边原生笔记中输入含空格的文本正常；画布操作不设置 body 光标。
- 切换宿主明暗 class 后，画布配色跟随；样式限定于 `.obcanvas-root`。窄分栏按容器宽度上下排列。
- 关闭视图后画布 DOM 移除，播放器暂停并清除 src；代码核对确认 wheel／窗口 blur 监听和主题观察器由 effect cleanup 释放。
- 逻辑检查覆盖布局写入失败重试、合并最新文件里的其他卡片、未知版本布局拒绝覆盖、各视图视口恢复。失败布局仅保留在当前插件实例内存；应重试成功后再退出应用。

## 可复现步骤与证据

```bash
npm run typecheck
npm test
npm run prepare:test-vault
npm run prepare:test-media
npm run launch:test-vault
npm run test:canvas-media
npm run launch:test-vault -- --restart
npm run test:canvas-media:reopen
npm run test:host
npm run stop:test-vault
```

`prepare:test-media` 依赖本机 FFmpeg。宿主测试使用 Playwright CDP 连接独立 Obsidian，并在任何写入前校验资料库的绝对路径。

本地证据：`.local/p0-bc-host-report.json`、`.local/p0-bc-reopen-report.json`、`.local/p0-a-host-report.json` 和对应截图。逻辑检查共 17 项通过；本批原有笔记宿主回归 8 项通过。媒体相关结果见 [P0-C](p0-c.md)。本地报告与二进制夹具不进入 Git。

测试中修正了两项检查问题：异步“载入笔记”需等待完成再断言；浮点视口坐标采用 0.001 像素容差。窄分栏检查发现原全窗口断点不适合 Obsidian 分栏，增加了容器断点。重启后的图片断言需先滚动到延迟加载图片所在位置；视频本身已成功读取。

## 边界

卡片坐标只用于整理，不是成片顺序。资料库中的场次视口用于新视图默认值，已打开的各标签页视口随 Obsidian 工作区保存。未验证独立弹出窗口、多设备同时改同一布局或异常断电恢复；没有接入原生 `.canvas` 格式、连线和旧画布批量迁移。
