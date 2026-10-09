# 配置文件参考

应用数据目录：`%APPDATA%\WSLPilot\`

## settings.jsonc — 应用偏好

| 字段 | 类型 | 默认 | 说明 |
|---|---|---|---|
| `general.autoRefreshOnStart` | boolean | `true` | 启动时自动刷新 |
| `general.pollIntervalMs` | number | `5000` | 轮询间隔 |
| `general.locale` | `system\|zh-CN\|en-US` | `system` | 界面语言 |
| `general.theme` | `light` | `light` | 固定浅色 |
| `general.accent` | `aurora\|sunset\|ocean\|forest\|custom` | `aurora` | 强调色 |
| `general.closeBehavior` | `minimizeToTray\|quit` | `minimizeToTray` | 关闭行为 |
| `general.launchAtLogin` | boolean | `false` | 开机自启 |
| `general.reduceMotion` | boolean | `false` | 减弱动效 |
| `wsl.defaultShell` | string | `""` | 默认 Shell |
| `wsl.installSource` | `store\|web` | `store` | 安装源 |
| `terminal.fontFamily` | string | Cascadia Mono… | 终端字体 |
| `terminal.fontSize` | number | `14` | 字号 |
| `backup.defaultDir` | string | `%USERPROFILE%\WSL-Backups` | 备份目录 |
| `backup.format` | `tar\|vhd` | `tar` | 备份格式 |
| `backup.keepRecent` | number | `5` | 保留份数 |
| `advanced.showRawCommand` | boolean | `false` | 显示等价命令 |
| `advanced.confirmDestructive` | boolean | `true` | 破坏性确认 |
| `advanced.logLevel` | `trace\|debug\|info\|warn\|error` | `info` | 日志级别 |

## distros.jsonc — 发行版元数据

只保存「系统里没有、属于本工具」的信息。真实状态每次由 `wsl.exe` 实时查询。

| 字段 | 说明 |
|---|---|
| `name` | 注册表名称（稳定键） |
| `alias` | 显示别名 |
| `tags` | 标签列表 |
| `color` | 品牌色 |
| `icon` | 图标名 |
| `note` | 备注 |
| `startupCwd` | 终端启动目录 |
| `pinned` | 是否置顶 |
| `quickActions` | 快捷动作 id 列表 |

## actions.jsonc — 自定义动作

**唯一允许用户注入命令的地方。** 参数以数组传递，不做字符串拼接。

| 字段 | 说明 |
|---|---|
| `id` | 唯一标识 |
| `label` | 显示名 |
| `scope` | `distro` \| `global` |
| `program` | 可执行文件 |
| `args` | 参数数组 |
| `terminal` | 是否在终端运行 |
| `confirm` | 是否需要确认 |

变量占位符：`${distroName}`、`${startupCwd}`、`${home}`、`${user}`

## network.jsonc — 端口转发与代理

端口转发应用时生成 `netsh interface portproxy` 命令并需用户确认（提权）。

## ui-state.jsonc / state.jsonc

界面状态与运行态缓存，一般不手工编辑。
