# WSLPilot

> **WSLPilot = WSL 的驾驶舱。** 像开飞机一样管理你的 Linux 发行版：一眼看清全局，一键完成操作，一切尽在掌握。

Windows Subsystem for Linux 的现代化图形控制中枢。技术栈：**TypeScript + Vue 3 + Electron**，持久化使用 **JSONC 配置文件**（无数据库）。

> **当前阶段：M1–M7 全部交付，版本 0.1.0。** 发行版管理、内置终端、备份迁移、安装向导、wsl.conf 编辑、自定义动作、命令面板、端口转发与镜像网络、代理配置、usbipd 设备管理、动效与空状态打磨、无障碍、诊断包、代码签名与自动更新均已可用。
>
> **版本号策略**：版本序列自 `0.1.0` 起步并保持 `0.x`，**永不发布 `1.0.0`**。

## 特性

**已交付**

- 一眼看清全部发行版状态（运行中 / 已停止 / 默认），真实资源采样（内存 / 磁盘 / CPU 差分）
- 一键启停、设默认、全部关机；发行版详情（注册表详情 / 元数据编辑 / 注销）
- 安装发行版向导（`wsl --list --online` + `wsl --install`，带进度与取消）
- 内置终端（node-pty + xterm.js）多标签工作区
- 备份迁移向导：导出 / 导入 / 迁移，环形进度 + 实时日志 + 可取消 + 备份轮转
- wsl.conf 可视化表单 + 原始文本双模式，写入前 Diff 预览（保留注释）
- 自定义动作（actions.jsonc 白名单）：变量占位符、等价命令展示、终端 / 无头两种执行
- 发行版内文件浏览与在线编辑（`\\wsl.localhost` 桥）
- 端口转发（`netsh interface portproxy`）：规则 CRUD、应用 / 全部应用 / 从系统移除、系统对照表
- 镜像网络模式引导（读取 `.wslconfig` 的 `networkingMode`，非 mirrored 时给配置片段）
- 代理配置：跟随 Windows 系统代理，或显式 HTTP/HTTPS，可一键写入发行版的 `profile.d`
- USB 设备（usbipd）：设备表、绑定 / 附加开关、状态徽章、未安装时的安装引导
- 全局命令面板（Ctrl/⌘ + K）：模糊匹配、前缀模式（`> ` 命令 / `@ ` 发行版 / `# ` 设置）、最近使用
- 全局快捷键全覆盖（新建终端 / 设置 / 刷新 / 等价命令行 / 切换标签）
- 人类可读的 JSONC 配置，可纳入 Git；外部修改冲突安全处理
- 浅色「极光」设计系统，精致动效

**M7 打磨发布**

- 动效完善：按钮涟漪与按压反馈、列表增删 FLIP、标签缩放淡出、强调色 300ms 平滑过渡、
  抽屉/模态背景模糊、Toast 右侧滑入、骨架屏流光；全部动效响应 `prefers-reduced-motion` 与「减弱动效」设置
- 空状态与骨架屏：插画 + 一句话 + 主 CTA；加载态用流光骨架而非转圈；搜索无结果带建议操作
- 无障碍：跳到主内容、焦点环与模态焦点归还、`aria-live` 任务播报、命令面板 combobox/listbox 语义、
  图标按钮 aria-label、危险操作图标 + 文字双编码
- 诊断包导出：近期日志 + 配置脱敏副本（主目录 → `%USERPROFILE%`、URL 凭据/密钥打码）+ 环境信息打包为 zip；
  一键打开日志目录（设置 → 关于）
- 提权助手（ElevationHelper）：主进程保持非提权，`netsh` / `usbipd bind` / `wsl --move` / `--install` 等白名单
  操作权限不足时经结构化请求拉起独立提权进程（一次 UAC 合并执行；取消则给出等价命令行）
- 代码签名：electron-builder 签名配置就绪（`CSC_LINK` / `CSC_KEY_PASSWORD`），未签名构建在
  「设置 → 关于」给出 SmartScreen 提示说明
- 自动更新：electron-updater（GitHub Releases 更新源），启动后台检查（可在高级设置关闭），
  「设置 → 关于」手动检查 / 下载 / 重启安装

## 开发

```bash
npm install   # 需要 Node 20+ 与 npm 12（corepack enable）
npm run dev
```

## 构建

```bash
npm run build              # 构建 + 打包（当前平台架构）
npm run package --workspace @wslpilot/desktop -- --x64    # 指定架构
```

**代码签名（可选）**：导出 `CSC_LINK`（pfx 路径或 base64）与 `CSC_KEY_PASSWORD` 后打包即自动签名；
未签名的安装包首次运行可能出现 Windows SmartScreen 提示（「更多信息 → 仍要运行」）。

**自动更新**：打包产物通过 GitHub Releases 分发，`electron-updater` 读取
`app-update.yml`（由 electron-builder `publish` 配置生成）检查与安装更新。

## 工程结构

monorepo（npm workspaces）包职责一览见 [CONTRIBUTING.md → 工程结构](./CONTRIBUTING.md#工程结构)。

## 测试

```bash
npm test                  # 单元 / 集成测试
npm run test:coverage     # 单元 + 覆盖率硬门禁（≥85%，不达标即失败）
npm run test:component    # 组件测试 + 覆盖率硬门禁（≥70%）
npm run test:e2e          # E2E + 视觉回归（需 Windows；先 npm run build --workspace @wslpilot/desktop）
```

分层策略与门禁细节见 [docs/testing.md](./docs/testing.md)。

## 故障排查

| 现象                                                        | 处理                                                                                                                                                                            |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 安装包首次运行弹出「Windows 已保护你的电脑」（SmartScreen） | 未签名构建的预期行为：点「更多信息 → 仍要运行」即可；正式签名的发布版本不会出现该提示。签名状态见「设置 → 关于 → 代码签名」                                                     |
| USB 设备页提示未检测到 usbipd                               | 可选能力，不影响其它功能；按页内引导安装：`winget install usbipd --source winget`，完成后回页点「我已安装，重新检测」。若提示「已安装但调用失败」，按错误详情排查，不要反复重装 |
| 提示「系统未启用 WSL」/「找不到 wsl.exe」                   | 在管理员终端运行 `wsl --install`，完成后重启应用；若已安装仍报找不到 `wsl.exe`，检查 PATH 是否包含 WSL 安装路径                                                                 |
| 反馈问题 / 排查异常                                         | 设置 → 关于 →「导出诊断包」：打包近期日志 + 配置脱敏副本（主目录替换为 `%USERPROFILE%`、URL 凭据打码）+ 环境信息；也可「打开日志目录」或设置 → 配置目录 → `logs/`               |

## 文档索引

| 文档                                                   | 内容                                                      |
| ------------------------------------------------------ | --------------------------------------------------------- |
| [docs/architecture.md](./docs/architecture.md)         | 运行时架构（进程分层 / 配置管理 / 长任务 / 安全）         |
| [docs/design-system.md](./docs/design-system.md)       | 设计系统（令牌 / 色彩 / 字体 / 动效）                     |
| [docs/config-reference.md](./docs/config-reference.md) | 配置文件参考（settings / distros / actions / network 等） |
| [docs/testing.md](./docs/testing.md)                   | 测试策略与覆盖率门禁                                      |
| [CONTRIBUTING.md](./CONTRIBUTING.md)                   | 贡献指南（环境 / 工程结构 / 提交规范 / 测试要求）         |
| [CHANGELOG.md](./CHANGELOG.md)                         | 变更日志                                                  |

总体设计见 [WSLPilot-设计书.md](./WSLPilot-设计书.md)。

## 配置文件

应用数据目录（`%APPDATA%\WSLPilot\`）：

| 文件             | 用途            |
| ---------------- | --------------- |
| `settings.jsonc` | 应用偏好        |
| `distros.jsonc`  | 发行版元数据    |
| `actions.jsonc`  | 自定义动作      |
| `network.jsonc`  | 端口转发 / 代理 |
| `ui-state.jsonc` | 界面状态        |
| `state.jsonc`    | 运行态缓存      |

## 许可

MIT
