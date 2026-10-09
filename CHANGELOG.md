# Changelog

本项目遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，
版本号遵循 [Semantic Versioning](https://semver.org/lang/zh-CN/)。

## [Unreleased]

### Notes

- 配置冲突 UI 简化为「重载 / 覆盖」二选（设计书 §6.10 的「对比」在配置目录手工完成）；`ignore` 动作保留给 API。

### Added

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
