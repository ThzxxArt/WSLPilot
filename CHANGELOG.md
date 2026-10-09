# Changelog

本项目遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，
版本号遵循 [Semantic Versioning](https://semver.org/lang/zh-CN/)。

## [Unreleased]

### Notes

- 配置冲突 UI 简化为「重载 / 覆盖」二选（设计书 §6.10 的「对比」在配置目录手工完成）；`ignore` 动作保留给 API。
- `wsl --manage --move` 需 WSL 2.0+；不支持时给出 `wsl --update` 建议。迁移前自动备份失败会中止迁移（安全兜底）。
- 就地导入（`--import-in-place`）失败时**不自动回滚**，避免误删用户源 vhdx；归档导入失败自动 `wsl --unregister` 回滚不完整注册。

### Added

- **M4 备份迁移**：导出 / 导入 / 迁移完整 IO 能力，长任务带进度、日志与取消
- TaskRunner：任务生命周期、进度事件（`task:progress`）、取消（kill 子进程）、同发行版写任务串行锁、`state.jsonc.lastTaskResult` 落盘
- IoService：`wsl --export`（tar / `--vhd`）、`wsl --import`（`--version` / `--vhd`）、`wsl --import-in-place`、`wsl --manage --move`
  - 进度估算：源体量（ext4.vhdx / 目录统计）对比目标文件增长；无法估算时 `percent = null`
  - 备份命名 `<name>_<YYYYMMDD-HHmmss>.<ext>` + 按 `backup.keepRecent` 自动轮转
  - 破坏性操作（迁移）前自动备份（`backup.autoBackupBeforeDestructive`）
  - 路径校验：控制字符 / 空路径拒绝；`%USERPROFILE%` 环境变量展开
- 备份迁移向导 UI（BackupView）：三模式（导出 / 导入 / 迁移）× 四步（选择 → 位置格式 → 确认 → 进度）
  - 大号渐变环形进度（ProgressRing）+ 实时日志抽屉 + 一键取消
  - 确认步骤展示等价命令行（`advanced.showRawCommand`）；迁移需勾选「我已知晓」（`advanced.confirmDestructive`）
  - 最近备份列表（体积 / 格式 / 时间）
- 设置 → 备份：默认目录、默认格式、保留份数、破坏性前自动备份
- 原生文件对话框通道（`app:pickDirectory / pickSaveFile / pickOpenFile / openPath`）
- 驾驶舱快捷操作「📦 备份」直达备份迁移页

- **M3 终端**：node-pty + xterm.js 多标签终端工作区
- PtyManager：会话池（上限 10）、`wsl.exe -d … -e shell` 参数数组、ConPTY、退出统一 kill
- 终端 UI：标签栏（新建/重命名/拖拽排序/中键关闭）、工具栏（清屏/搜索/字号/复制/导出）、状态栏（光标/UTF-8/会话时长）
- 明亮终端主题，与浅色应用协调
- 设置 → 终端：字体/字号/光标样式/闪烁/回滚缓冲
- 驾驶舱与发行版卡片「终端」按钮直达指定发行版会话

- **M2 驾驶舱**：`wsl --list --verbose` 解析、发行版列表（卡片/表格）、指标卡、启停、设默认
- WslService：list / start / terminate / shutdown / setDefault / getVersion / sampleMetrics
- MetricsService：Running 发行版并发采样、驾驶舱全局概览
- RegistryService：Lxss 注册表只读（GUID / BasePath / DefaultUid），失败降级
- 发行版元数据 meta:get / meta:set（distros.jsonc）
- UI 组件：DistroCard、MetricCard、StatusDot、Sparkline
- 驾驶舱真实数据 + 快捷「全部关机」+ 轮询（失焦暂停）
- 发行版中心：搜索 / 标签筛选 / 卡片网格 / 紧凑表格

### Added (M1)

- **M1 工程骨架**：npm workspaces monorepo（shared / kit / ui / desktop）
- 设计系统：设计令牌、Naive UI 主题适配、浅色「极光」主题、四种强调色
- ConfigService：JSONC 读写、原子替换、备份轮转、zod 校验、版本迁移链
- Electron 安全基线：contextIsolation、sandbox、IPC 白名单、禁止新窗口
- 可运行外壳：标题栏、可折叠侧栏、驾驶舱、设置页（强调色实时切换）
- 系统托盘菜单（显示/隐藏、设置、退出）
- 隐藏系统默认菜单栏，使用自绘无边框标题栏
- NSIS 安装包（支持自定义安装路径）与 portable 免安装版
- 单元测试（解析 / schema / 迁移 / 错误码）与 CI 工作流

> 完整应用尚未完成（M2–M7 未交付），首个正式版本待功能完整后再打标签。
