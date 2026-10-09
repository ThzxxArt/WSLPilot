# Changelog

本项目遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，
版本号遵循 [Semantic Versioning](https://semver.org/lang/zh-CN/)。

## [Unreleased]

### Notes

- 配置冲突 UI 简化为「重载 / 覆盖」二选（设计书 §6.10 的「对比」在配置目录手工完成）；`ignore` 动作保留给 API。
- `wsl --manage --move` 需 WSL 2.0+；不支持时给出 `wsl --update` 建议。迁移前自动备份失败会中止迁移（安全兜底）。
- 就地导入（`--import-in-place`）失败时**不自动回滚**，避免误删用户源 vhdx；归档导入失败自动 `wsl --unregister` 回滚不完整注册。

### Added

- **M5 配置与动作**：wsl.conf 编辑、注册表详情、自定义动作、命令面板（配置中心化 + ⌘K）
  - **wsl.conf 编辑**：`/etc/wsl.conf` 可视化表单 + 原始文本双模式，逐键最小编辑保留注释
    - 表单覆盖 automount / network / interop / user / boot 全部常见键；未知键只展示不吞掉
    - 写入前 Diff 预览（LCS 行级差异）；写入走 `wsl -d <name> -u root -e tee /etc/wsl.conf` + stdin（内容不经 shell）
    - 8 秒规则提示；`wsl.autoShutdownAfterConfigChange` 开启时保存后自动 terminate 使配置生效
  - **注册表详情**：Lxss 完整信息（GUID / BasePath / DefaultUid / Flags / 原始键值），GUID 与安装位置一键复制
  - **自定义动作**（actions.jsonc 白名单执行）：
    - 动作卡片一键运行 + 等价命令展示；`confirm` 动作执行前二次确认（含等价命令）
    - 动作 CRUD（新建 / 编辑 / 删除）+ 删除 Toast「撤销」
    - 变量占位符 `${distroName} ${startupCwd} ${home} ${user}` 主进程安全替换（${home}/${user} 运行前探测）
    - `terminal: true` 动作复用临时 PTY（会话自动收编进终端工作区，可交互、可取消）；headless 动作流式日志进任务抽屉
  - **命令面板 ⌘K 全量升级**：模糊匹配（自研打分：连续/词首/前缀/缺口）、前缀模式（`> ` 命令 · `@ ` 发行版 · `# ` 设置）、
    分组（动作 / 发行版 / 导航 / 设置项）、快捷键提示（Kbd）、最近使用（持久化 ui-state.recentCommands）
  - **发行版内文件**：`\\wsl.localhost` 桥（readDir / read / write / revealInExplorer）+ 详情页「文件」标签
    （面包屑、目录列表、文本在线编辑保存、资源管理器定位）；路径校验拒绝 `..` 逃逸与非法字符
  - 发行版详情弹窗标签页化：概览（注册表详情）/ 配置 / 动作 / 文件
  - 全局快捷键补齐（§11.5）：`Ctrl/⌘+K` 面板 · `Ctrl/⌘+N` 新终端 · `Ctrl/⌘+,` 设置 · `Ctrl/⌘+R` 刷新 ·
    `Ctrl/⌘+Shift+P` 等价命令行开关 · `Ctrl/⌘+1…9` 切换终端标签；设置页新增「快捷键」一览
  - 设置 → WSL：默认 Shell、wsl.conf 变更后自动终止策略
  - UI 组件：CodeEditor（行号 + Tab 缩进）、Kbd（快捷键提示）
- **质量根治（全量 review 清零）**
  - 全站错误提示修复：统一 `describeError/errorLine`，AppError（纯对象）不再被 `instanceof Error` 误判吞掉
  - 配置安全：损坏 JSONC 拒绝写回、`patch({})` 不清空文件、嵌套 `__proto__` 拒绝、`z.record` 逐键清洗、版本戳不再"说谎"
  - 备份命名/轮转往返修复（全部非法字符替换 + 正则同源）
  - 长任务：无输出看门狗（10 分钟）、settle 幂等、取消与完成竞态修正（exit 0 优先成功）、记录限量
  - 生命周期：bootstrap 全局异常兜底、窗口防抖 timer 清理、config 监听器隔离、退出前 flush 落盘
  - **安装发行版向导**（`wsl --list --online` + `wsl --install`，进度/取消）
  - **全局命令面板 Ctrl/⌘+K**（导航 / 发行版 / 动作即输即搜）
  - 发行版详情弹窗（GUID/安装位置/元数据编辑/注销），「查看详情」不再是伪跳转
  - 驾驶舱快捷操作全部接通（安装 / 备份 / 清理旧备份 / 网络）
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

> 完整应用尚未完成（M6–M7 未交付），首个正式版本待功能完整后再打标签。
