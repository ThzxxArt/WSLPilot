# Changelog

本项目遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，
版本号遵循 [Semantic Versioning](https://semver.org/lang/zh-CN/)。

## [0.1.0] - 2026-10-09

### Added

- **M1 工程骨架**：npm workspaces monorepo（shared / kit / ui / desktop）
- 设计系统：设计令牌、Naive UI 主题适配、浅色「极光」主题、四种强调色
- ConfigService：JSONC 读写、原子替换、备份轮转、zod 校验、版本迁移链
- Electron 安全基线：contextIsolation、sandbox、IPC 白名单、禁止新窗口
- 可运行外壳：标题栏、可折叠侧栏、驾驶舱、设置页（强调色实时切换）
- 系统托盘菜单（显示/隐藏、设置、退出）
- 隐藏系统默认菜单栏，使用自绘无边框标题栏
- NSIS 安装包（支持自定义安装路径）与 portable 免安装版
- 单元测试（解析 / schema / 迁移 / 错误码）与 CI 工作流

[0.1.0]: https://github.com/ThzxxArt/WSLPilot/releases/tag/v0.1.0
