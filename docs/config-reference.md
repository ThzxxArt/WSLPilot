# 配置文件参考

应用数据目录：`%APPDATA%\WSLPilot\`

## settings.jsonc — 应用偏好

| 字段                                 | 类型                                     | 默认                        | 说明                                         |
| ------------------------------------ | ---------------------------------------- | --------------------------- | -------------------------------------------- |
| `general.autoRefreshOnStart`         | boolean                                  | `true`                      | 启动时自动刷新                               |
| `general.pollIntervalMs`             | number                                   | `5000`                      | 轮询间隔（1000–60000）                       |
| `general.locale`                     | `system\|zh-CN\|en-US`                   | `system`                    | 组件语言（界面文案暂仅中文）                 |
| `general.accent`                     | `aurora\|sunset\|ocean\|forest`          | `aurora`                    | 强调色（浅色为唯一主题，不提供深色）         |
| `general.closeBehavior`              | `minimizeToTray\|quit`                   | `minimizeToTray`            | 关闭行为                                     |
| `general.launchAtLogin`              | boolean                                  | `false`                     | 开机自启（与托盘菜单同步）                   |
| `general.reduceMotion`               | boolean                                  | `false`                     | 减弱动效                                     |
| `wsl.defaultShell`                   | string                                   | `""`                        | 默认 Shell（空 = `/bin/bash`）               |
| `wsl.autoShutdownAfterConfigChange`  | boolean                                  | `false`                     | 配置变更后自动关机使生效                     |
| `terminal.fontFamily`                | string                                   | Cascadia Mono…              | 终端字体                                     |
| `terminal.fontSize`                  | number                                   | `14`                        | 字号（8–32）                                 |
| `terminal.lineHeight`                | number                                   | `1.25`                      | 行高（1–2.5）                                |
| `terminal.cursorStyle`               | `block\|underline\|bar`                  | `bar`                       | 光标样式                                     |
| `terminal.cursorBlink`               | boolean                                  | `true`                      | 光标闪烁                                     |
| `terminal.scrollback`                | number                                   | `10000`                     | 回滚缓冲行数（100–100000）                   |
| `terminal.copyOnSelect`              | boolean                                  | `false`                     | 选中即复制                                   |
| `terminal.letterSpacing`             | number                                   | `0`                         | 字距（-2–4）                                 |
| `terminal.theme`                     | `light\|dark\|follow-app\|high-contrast` | `light`                     | 终端配色（应用仍浅色，终端可独立深色）       |
| `terminal.rightClickBehavior`        | `contextMenu\|paste\|selectWord`         | `contextMenu`               | 右键行为                                     |
| `terminal.pasteWarning`              | `always\|multiline\|never`               | `multiline`                 | 多行粘贴确认                                 |
| `terminal.bell`                      | `none\|visual\|sound`                    | `none`                      | 响铃行为                                     |
| `terminal.webgl`                     | `auto\|on\|off`                          | `auto`                      | WebGL 渲染（失败自动回退 DOM）               |
| `terminal.shellIntegration`          | `off\|prompt\|on`                        | `off`                       | Shell 集成（显式安装）                       |
| `terminal.profiles`                  | array                                    | `[]`                        | 终端启动 Profile（distro/container/command） |
| `workbench.defaultRoute`             | `dashboard\|terminal\|last`              | `dashboard`                 | 启动默认页面                                 |
| `workbench.autoCollapseSidebar`      | boolean                                  | `true`                      | 终端页自动收起导航轨                         |
| `workbench.tabPosition`              | `top\|left`                              | `top`                       | 标签栏位置                                   |
| `workbench.density`                  | `comfortable\|compact`                   | `comfortable`               | 工作台密度                                   |
| `workbench.showStatusLine`           | boolean                                  | `true`                      | 显示 20px 终端状态行                         |
| `workbench.showPaneHeaders`          | `auto\|always\|never`                    | `auto`                      | 分屏面板标题                                 |
| `workbench.sessionRailWidth`         | number                                   | `240`                       | 会话侧栏宽度（180–360）                      |
| `workbench.confirmClosePane`         | boolean                                  | `true`                      | 关闭运行中面板确认                           |
| `containers.pollIntervalMs`          | number                                   | `3000`                      | 容器列表轮询间隔                             |
| `containers.statsIntervalMs`         | number                                   | `1000`                      | 容器统计采样间隔                             |
| `containers.confirmPrune`            | boolean                                  | `true`                      | 清理前确认                                   |
| `containers.confirmRemoveRunning`    | boolean                                  | `true`                      | 删除运行中容器确认                           |
| `containers.defaultStopTimeoutSec`   | number                                   | `10`                        | 停止容器默认超时                             |
| `containers.maskEnvValues`           | boolean                                  | `true`                      | 详情页遮挡环境变量值                         |
| `containers.lastImage`               | string                                   | `ubuntu:latest`             | 运行向导默认镜像                             |
| `backup.defaultDir`                  | string                                   | `%USERPROFILE%\WSL-Backups` | 备份目录（支持环境变量）                     |
| `backup.format`                      | `tar\|tar.gz\|vhd`                       | `tar`                       | 备份格式（tar.gz 需 WSL 2.4.4+）             |
| `backup.keepRecent`                  | number                                   | `5`                         | 保留份数（1–50，自动轮转）                   |
| `backup.autoBackupBeforeDestructive` | boolean                                  | `true`                      | 迁移等破坏性操作前自动备份                   |
| `advanced.showRawCommand`            | boolean                                  | `false`                     | 显示等价命令                                 |
| `advanced.confirmDestructive`        | boolean                                  | `true`                      | 破坏性确认                                   |
| `advanced.logLevel`                  | `trace\|debug\|info\|warn\|error`        | `info`                      | 日志级别                                     |
| `advanced.hardwareAcceleration`      | boolean                                  | `true`                      | 硬件加速（重启应用生效）                     |
| `advanced.autoUpdate`                | boolean                                  | `true`                      | 启动时后台检查更新（M7，下次启动生效）       |

## distros.jsonc — 发行版元数据

只保存「系统里没有、属于本工具」的信息。真实状态每次由 `wsl.exe` 实时查询。

| 字段                | 说明                                      |
| ------------------- | ----------------------------------------- |
| `name`              | 注册表名称（稳定键）                      |
| `alias`             | 显示别名                                  |
| `tags`              | 标签列表                                  |
| `color`             | 品牌色                                    |
| `icon`              | 图标名                                    |
| `note`              | 备注                                      |
| `startupCwd`        | 终端启动目录                              |
| `pinned`            | 是否置顶                                  |
| `quickActions`      | 快捷动作 id 列表                          |
| `terminalProfileId` | 终端 Profile id（空 = 默认启动方式）      |
| `hidden`            | 从驾驶舱/终端/列表默认隐藏（内部发行版）  |
| `defaultShell`      | 发行版级默认 Shell（覆盖全局，空 = 跟随） |

`distros.jsonc` 当前为 v3：新增 `terminalProfileId` / `hidden` / `defaultShell`。`tags` 最多 20 个、
每个 ≤64 字符；`quickActions` 最多 20 个、每个动作 id ≤100 字符。v1/v2 超限数据在迁移时截断
或补默认值（不交给 sanitize 静默丢弃）。

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

- 表单覆盖 `[automount]`（含 `ldconfig` / `cgroups`）`[network]` `[interop]` `[user]`
  `[boot]`（含 `protectBinfmt`）`[gpu]` `[time]` 常见键；其余键在「其他设置」中原样保留
- 逐键最小编辑：只替换 `=` 右侧值，保留行内注释、键写法与等号旁空白；重复段/键取
  **第一处**（WSL configfile.cpp first-wins），删除时清全部；双引号 + `\\`/`\"` 转义可逆，
  `#` 是唯一行内注释符（`;` 是字面值）
- 字符串清空 / 清除按钮 = 删除该键
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

## `.wslconfig`（全局配置 — 0.2.0）

路径 `%UserProfile%\.wslconfig`（**Windows 宿主文件**，非发行版内；影响所有发行版与 WSL 虚拟机）。
「网络」页的「WSL 全局配置（.wslconfig）」面板提供**可视化表单 + 原始文本 + Diff 预览**：

- 表单覆盖：`[wsl2]` 的 `memory` / `processors` / `swap` / `swapFile` / `networkingMode`
  （`nat`/`mirrored`/`none`/`consomme`/`bridged`，允许自定义）/ `dnsTunneling` / `firewall` /
  `autoProxy` / `localhostForwarding` / `safeMode` / `guiApplications` / `nestedVirtualization` /
  `vmIdleTimeout` / `dnsProxy` / `defaultVhdSize` / `gpuSupport` / `maxCrashDumpCount` /
  `kernel` / `kernelCommandLine` / `kernelModules` / `systemDistro` / `virtiofs` / `virtio` /
  `hostFileSystemAccess` / `telemetry` / `kernelBootTimeout` / `distributionStartTimeout` /
  `mountDeviceTimeout` / `crashDumpFolder` / `loadDefaultKernelModules` / `loadKernelModules` /
  `isolateDistroCgroup`；`[general]` 的 `instanceIdleTimeout` / `distributionInstallPath`；
  `[experimental]` 的 `autoMemoryReclaim`（读兼容 `dropcache`；仅用户修改时写规范
  `dropCache`，加载不置 dirty；允许自定义）/
  `sparseVhd` / `bestEffortDnsParsing` / `ignoredPorts` / `hostAddressLoopback`
- 逐键最小编辑（保留行内注释、键写法、等号旁空白与未知键）；容量字段校验 WSL
  `ParseMemorySize` 语法（整数 + `B|K|KB|M|MB|G|GB|T|TB`，大小写敏感、无小数）
- 未知 enum 值**不阻塞保存**（WSL 对其有回退语义），面板标注“当前值不在推荐列表”
- WSL 3 依赖提示：`virtiofs` 需同时开启 `virtio` 与 `hostFileSystemAccess`；`systemDistro` 必须是
  绝对 Windows 路径且为 `.img/.vhd`；`isolateDistroCgroup` 需 cgroup v2（面板给出警告，不阻塞保存）
- 保存：语法守卫 → 备份轮转（保留 3 份）→ 原子写；**无需 UAC**（纯宿主文件）
- 生效：执行面板内「立即重启 WSL（`wsl --shutdown`）」，或完全停止所有发行版后约 8 秒
- 镜像模式（`[wsl2] networkingMode`）的读取与面板编辑共用同一解析器

## containers.jsonc — 容器配方（v1）

只保存「用户意图」，不保存实时状态。容器列表/统计每次从 `wslc` 查询。

| 字段           | 说明                                                                                                       |
| -------------- | ---------------------------------------------------------------------------------------------------------- |
| `recipes`      | 容器运行配方数组（`id/label/image/name/command/ports/mounts/env/network/detach/rm/stopTimeoutSec/health`） |
| `recentImages` | 最近使用的镜像引用（最多 30）                                                                              |

安全约束：镜像引用、容器名、主机/容器挂载路径、端口、环境变量名均由
`packages/shared/src/containers.ts` 统一校验；不符合的配方在加载清洗时丢弃，运行前再次校验。

## ui-state.jsonc / state.jsonc

界面状态与运行态缓存，一般不手工编辑。`state.jsonc` 的 `lastTaskResult` 记录最近一次长任务
（导出/导入/迁移/安装/更新/磁盘管理/克隆/注销/容器等）的结果；`ui-state.jsonc` v2 的
`workbench` 保存工作台标签/分屏布局，旧 `terminalLayout` 仅迁移期读取（不跨重启恢复旧会话）。
