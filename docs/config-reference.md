# 配置文件参考

应用数据目录：`%APPDATA%\WSLPilot\`

## settings.jsonc — 应用偏好

| 字段                                 | 类型                              | 默认                        | 说明                                   |
| ------------------------------------ | --------------------------------- | --------------------------- | -------------------------------------- |
| `general.autoRefreshOnStart`         | boolean                           | `true`                      | 启动时自动刷新                         |
| `general.pollIntervalMs`             | number                            | `5000`                      | 轮询间隔（1000–60000）                 |
| `general.locale`                     | `system\|zh-CN\|en-US`            | `system`                    | 组件语言（界面文案暂仅中文）           |
| `general.accent`                     | `aurora\|sunset\|ocean\|forest`   | `aurora`                    | 强调色（浅色为唯一主题，不提供深色）   |
| `general.closeBehavior`              | `minimizeToTray\|quit`            | `minimizeToTray`            | 关闭行为                               |
| `general.launchAtLogin`              | boolean                           | `false`                     | 开机自启（与托盘菜单同步）             |
| `general.reduceMotion`               | boolean                           | `false`                     | 减弱动效                               |
| `wsl.defaultShell`                   | string                            | `""`                        | 默认 Shell（空 = `/bin/bash`）         |
| `wsl.autoShutdownAfterConfigChange`  | boolean                           | `false`                     | 配置变更后自动关机使生效               |
| `terminal.fontFamily`                | string                            | Cascadia Mono…              | 终端字体                               |
| `terminal.fontSize`                  | number                            | `14`                        | 字号（8–32）                           |
| `terminal.lineHeight`                | number                            | `1.2`                       | 行高（1–2.5）                          |
| `terminal.cursorStyle`               | `block\|underline\|bar`           | `block`                     | 光标样式                               |
| `terminal.cursorBlink`               | boolean                           | `true`                      | 光标闪烁                               |
| `terminal.scrollback`                | number                            | `5000`                      | 回滚缓冲行数                           |
| `terminal.copyOnSelect`              | boolean                           | `false`                     | 选中即复制                             |
| `terminal.theme`                     | `auto\|follow-app\|custom`        | `auto`                      | 终端配色                               |
| `backup.defaultDir`                  | string                            | `%USERPROFILE%\WSL-Backups` | 备份目录（支持环境变量）               |
| `backup.format`                      | `tar\|vhd`                        | `tar`                       | 备份格式                               |
| `backup.keepRecent`                  | number                            | `5`                         | 保留份数（1–50，自动轮转）             |
| `backup.autoBackupBeforeDestructive` | boolean                           | `true`                      | 迁移等破坏性操作前自动备份             |
| `advanced.showRawCommand`            | boolean                           | `false`                     | 显示等价命令                           |
| `advanced.confirmDestructive`        | boolean                           | `true`                      | 破坏性确认                             |
| `advanced.logLevel`                  | `trace\|debug\|info\|warn\|error` | `info`                      | 日志级别                               |
| `advanced.hardwareAcceleration`      | boolean                           | `true`                      | 硬件加速（重启应用生效）               |
| `advanced.autoUpdate`                | boolean                           | `true`                      | 启动时后台检查更新（M7，下次启动生效） |

## distros.jsonc — 发行版元数据

只保存「系统里没有、属于本工具」的信息。真实状态每次由 `wsl.exe` 实时查询。

| 字段           | 说明                 |
| -------------- | -------------------- |
| `name`         | 注册表名称（稳定键） |
| `alias`        | 显示别名             |
| `tags`         | 标签列表             |
| `color`        | 品牌色               |
| `icon`         | 图标名               |
| `note`         | 备注                 |
| `startupCwd`   | 终端启动目录         |
| `pinned`       | 是否置顶             |
| `quickActions` | 快捷动作 id 列表     |

## actions.jsonc — 自定义动作

**唯一允许用户注入命令的地方。** 参数以数组传递，不做字符串拼接。

| 字段          | 说明                 |
| ------------- | -------------------- |
| `id`          | 唯一标识             |
| `label`       | 显示名               |
| `description` | 描述（可选）         |
| `icon`        | 图标名（可选）       |
| `scope`       | `distro` \| `global` |
| `program`     | 可执行文件           |
| `args`        | 参数数组             |
| `user`        | 执行用户（可选）     |
| `cwd`         | 工作目录（可选）     |
| `terminal`    | 是否在终端运行       |
| `confirm`     | 是否需要确认         |

变量占位符：`${distroName}`、`${startupCwd}`、`${home}`、`${user}`

- `${distroName}` / `${startupCwd}`：来自当前目标发行版与 `distros.jsonc` 的 `startupCwd`
- `${home}` / `${user}`：动作运行前由主进程在发行版内探测（`printf "$HOME" "$USER"`），展示等价命令时保持占位符
- 变量替换是纯字符串拼接，结果以参数数组执行，**不经过 shell**；未知占位符原样保留
- 等价命令形态：`wsl.exe -d <distro> [-u user] [--cd cwd] -e <program> <args...]`
- `terminal: true` 在临时 PTY 中运行（会话出现在终端工作区，可交互）；`false` 为无头执行（日志进任务抽屉）
- `id` 禁止控制字符与 `\ / : * ? " < > |`；执行入口只接受声明过的 id（白名单）

## wsl.conf（发行版内配置）

路径 `/etc/wsl.conf`（发行版级，非 `%UserProfile%\.wslconfig`）。应用内「发行版详情 → 配置」提供
**可视化表单 + 原始文本**双模式，写入前展示行级 Diff 预览：

- 表单覆盖 `[automount]` `[network]` `[interop]` `[user]` `[boot]` 常见键；其余键在「其他设置」中原样保留
- 逐键最小编辑（保留注释）；字符串清空 / 清除按钮 = 删除该键
- 保存需要发行版内 root（`wsl -d <name> -u root -e tee /etc/wsl.conf`，内容经 stdin）
- **8 秒规则**：变更在发行版完全停止后约 8 秒才生效。开启
  `settings.wsl.autoShutdownAfterConfigChange` 后，保存时自动 `wsl --terminate <name>`

## network.jsonc — 端口转发与代理

> **M6 已生效**：端口转发规则可一键应用到系统（`netsh interface portproxy`），代理配置可写入
> 发行版内 `/etc/profile.d/wslpilot-proxy.sh`。规则本身仍是声明式意图——应用前不产生系统效果。

端口转发应用时生成 `netsh interface portproxy add v4tov4 …` 参数数组并执行（**需管理员权限**；
权限不足时给出等价命令行，可在管理员终端中手动执行）。

| 字段                                   | 说明                                                             |
| -------------------------------------- | ---------------------------------------------------------------- |
| `portForwarding[].id`                  | 规则 id（执行白名单键；禁止 `\ / : * ? " < > \|` 与控制字符）    |
| `portForwarding[].distro`              | 目标发行版（记录意图，便于对照与查找）                           |
| `portForwarding[].listenAddress`       | 监听地址（默认 `0.0.0.0`）                                       |
| `portForwarding[].listenPort`          | 监听端口（1–65535）                                              |
| `portForwarding[].connectAddress`      | 转发地址（默认 `127.0.0.1`）                                     |
| `portForwarding[].connectPort`         | 转发端口                                                         |
| `portForwarding[].enabled`             | 是否启用（「全部应用」只应用启用中的规则）                       |
| `portForwarding[].protocol`            | `tcp` \| `udp`（**udp 仅记录意图**：netsh portproxy 只支持 TCP） |
| `proxy.useWindowsProxy`                | 跟随系统代理（读取 HKCU `Internet Settings` 的 ProxyServer）     |
| `proxy.httpProxy` / `proxy.httpsProxy` | 代理地址（本地显式值优先于系统代理）                             |
| `proxy.noProxy`                        | 不代理列表（默认 `localhost,127.0.0.1`）                         |

- 规则条数上限 **100**；`id` 唯一。
- **应用**（`network:apply` / `network:applyAll`）写入系统转发表；**从系统移除**（`network:remove`）
  只删系统条目，配置里的规则保留；**删除规则**只改配置。
- 系统侧对照：面板读取 `netsh interface portproxy show all`，逐条标注「已生效 / 指向不同 / 未生效 / 仅记录」。
- **镜像网络模式**：面板读取 `%UserProfile%\.wslconfig` 的 `[wsl2] networkingMode`；非 `mirrored`
  时展示引导（复制配置片段 → `wsl --shutdown` → 重启发行版，完全停止约 8 秒后生效）。
  镜像模式下 Windows 与 WSL 共用网络栈，端口转发通常不再需要。
- **代理落点**：`/etc/profile.d/wslpilot-proxy.sh`（写入走 `wsl -d <name> -u root -e tee` + stdin，
  内容不经 shell）。脚本仅导出 `http_proxy/https_proxy/no_proxy` 等环境变量，可随时「清除」或手工编辑。

## ui-state.jsonc / state.jsonc

界面状态与运行态缓存，一般不手工编辑。`state.jsonc` 的 `lastTaskResult` 记录最近一次长任务（导出/导入/迁移等）的结果。
