# 架构说明

> 详细设计见 [WSLPilot-设计书.md](../WSLPilot-设计书.md)。本文聚焦运行时结构。

## 进程分层

```
┌─────────────────────────────────────────┐
│  Renderer（Vue3 + Pinia + Naive UI）     │  只负责视图与交互
├─────────────────────────────────────────┤
│  Preload（contextBridge）                │  唯一内外边界
├─────────────────────────────────────────┤
│  Main（Node + Service 层）               │  业务与系统能力唯一实现地
├─────────────────────────────────────────┤
│  系统侧（wsl.exe / 注册表 / 文件）        │
└─────────────────────────────────────────┘
```

## 关键设计原则

1. **单一系统入口**：所有系统副作用只发生在 Service 层。
2. **命令白名单**：`ActionRunner` 只执行配置声明的模板。
3. **不可变数据流**：Service 返回冻结对象。
4. **失败可恢复**：长任务可取消、可回滚提示。
5. **契约先行**：IPC 通道名与类型在 `packages/shared` 统一定义。

## 配置管理

- 格式：JSONC（允许注释与尾逗号）
- 写盘：临时文件 → fsync → rename（原子替换）
- 冲突：单写者队列 + 写前重读 + chokidar 监听 + 备份轮转
- 迁移：`$schemaVersion` + 注册迁移链 + 迁移前自动备份

## 长任务（M4 备份迁移）

```
Renderer ── io:export/import/move ──▶ TaskRunner.start(lockKey=发行版名)
                                          │  spawn wsl.exe（流式日志）
                                          ├─ task:progress 事件（percent 可为 null）
                                          ├─ task:cancel → kill 子进程
                                          └─ 终态 → state.jsonc.lastTaskResult
```

- **TaskRunner**：任务生命周期、同发行版写任务串行锁、取消（含排队中任务）、日志上限 2000 行。
- **IoService**：`--export`（tar / `--vhd`）、`--import`（`--version` / `--vhd`）、`--import-in-place`、`--manage --move`；
  进度按「源体量 vs 目标文件增长」估算；迁移前自动备份（安全兜底）；归档导入失败自动回滚注册。

## 配置与动作（M5）

```
Renderer ── wslconf:read/write ──▶ WslConfService（cat / root tee + stdin）
         ── action:run ─────────▶ ActionRunner（白名单 + 变量替换）
         │                          ├─ headless → spawnWslTask（流式日志）
         │                          └─ terminal → PtyManager.createCommand（临时 PTY）
         └─ fs:readDir/read/write ─▶ FsBridge（\\wsl.localhost\<distro> 9p）
```

- **wsl.conf**：INI 行级模型（`shared/wslconf.ts`）逐键最小编辑，保留注释与未知键；写入前 LCS Diff 预览；
  写入走 `wsl -d <name> -u root -e tee /etc/wsl.conf`，内容经 stdin，绝不拼接进命令行。
  变更在发行版完全停止后约 8 秒生效（`wsl.autoShutdownAfterConfigChange` 可自动 terminate）。
- **ActionRunner**：只执行 `actions.jsonc` 声明的 id（执行白名单）；`${distroName}/${startupCwd}/${home}/${user}`
  主进程纯字符串替换（`${home}/${user}` 运行前以常量脚本探测）；等价命令与真实执行同源构建（`previewActionCommand`）。
  `terminal: true` 复用临时 PTY，`ptyId` 随 `TaskHandle` 返回并由渲染层终端仓 `adopt()` 收编为标签。
- **FsBridge**：UNC `\\wsl.localhost\<distro>\<linuxPath>`；路径解析拒绝控制字符、`..`、Windows 非法字符，
  并校验结果仍在发行版根内；文本读取 2MB 截断保护、写入 4MB 上限。
- **命令面板**：`shared/fuzzy.ts` 模糊打分 + `renderer/features/command/palette.ts` 前缀/分组/最近使用；
  最近使用持久化到 `ui-state.recentCommands`。

## 网络与设备（M6）

```
Renderer ── network:apply/applyAll/remove ─▶ NetworkService（netsh portproxy，串行锁）
         ── network:status ───────────────▶ 镜像模式检测 + 系统转发表 + Windows 代理
         ── network:proxyApply/Clear ─────▶ /etc/profile.d/wslpilot-proxy.sh（root tee + stdin）
         ── devices:list/bind/attach ─────▶ UsbipdService（usbipd.exe list/bind/unbind/attach/detach）
```

- **端口转发**：声明式规则只来自 `network.jsonc`（执行白名单），渲染层只传 `id`；
  `netsh interface portproxy add|delete v4tov4 …` 一律参数数组，绝不拼接 shell。
  netsh 提权失败时改由提权助手执行（M7 ElevationHelper）；仍失败则映射 `PERMISSION_DENIED` 并附等价命令行。
  `udp` 规则只记录意图（netsh portproxy 仅支持 TCP），应用时显式跳过。
- **镜像引导**：解析 `%UserProfile%\.wslconfig` 的 `[wsl2] networkingMode`；非 `mirrored` 时给
  「推荐」提示卡 + 可复制配置片段 + 打开所在目录（`app:openPath` 仅允许目录）。
- **代理**：`network.jsonc.proxy` 为真相源；`useWindowsProxy` 时读取 HKCU `Internet Settings`
  （ProxyEnable / ProxyServer）作兜底，本地显式值优先。生效代理落成
  `/etc/profile.d/wslpilot-proxy.sh`（可查看原文、可清除），绝不改发行版业务数据。
- **usbipd（可选）**：`usbipd list` 解析 BUSID / VID:PID / STATE；bind / unbind 需管理员 → 长任务；
  `attach --wsl`（usbipd 2.0+）无需提权。未安装时给 `winget install usbipd` 安装引导，不阻断其它功能。
- **输出解码**：`kit/tool-output.ts` 先探测 UTF-16LE（NUL 结构）→ 严格 UTF-8 → GBK 回退，
  否则中文报错变乱码、错误映射全部失效。

## 打磨发布（M7）

```
Renderer ── app:exportDiagnostics/openLogsDir ─▶ DiagnosticsService（zip：日志+配置脱敏副本）
         ── app:signatureStatus ──────────────▶ SignatureService（Get-AuthenticodeSignature）
         ── update:check/download/install ────▶ UpdateService（electron-updater）
         （服务层内部）netsh/usbipd/wsl 权限不足 ─▶ ElevationClient ─▶ 提权 Helper（UAC）
```

- **诊断包**（§15.3）：近期日志（限量限体积）+ 配置脱敏副本 + 环境信息 manifest → 一个 zip。
  脱敏唯一事实源在 `shared/diagnostics`（主目录 → `%USERPROFILE%`、URL 凭据 / 密钥赋值打码、
  路径边界防前缀碰撞）；打包用 `kit/zip` 自研极简 ZIP 写入器（DEFLATE + CRC32，零新依赖）。
- **ElevationHelper**（§14.3）：主进程保持非提权；`netsh` / `usbipd bind|unbind` / `wsl --move|install|set-version`
  在直接执行被拒时改由独立提权进程执行。请求是**结构化载荷**（op 白名单 + 参数数组，`shared/elevation`
  唯一映射 op→program/argv）；PowerShell Helper 脚本二次校验 op/program（纵深防御），参数数组 splat 调用。
  批量操作合并为一次 UAC 会话；用户取消 → `PERMISSION_DENIED` + 等价命令行。
- **自动更新**（§17）：electron-updater（`publish: github` 生成 app-update.yml）。`autoDownload=false`
  （由用户在「设置 → 关于」决定下载）、`autoInstallOnAppQuit=true`；状态经 `update:changed` 推送。
  `advanced.autoUpdate` 控制启动后台检查。
- **代码签名**（§17）：`electron-builder` 的 `signtoolOptions`（sha256）+ `verifyUpdateCodeSignature`；
  证书经 `CSC_LINK` / `CSC_KEY_PASSWORD` 注入。`app:signatureStatus` 检测当前可执行文件签名，
  未签名时界面展示 SmartScreen 说明。

## 安全

| 层       | 措施                                                                                                                                                                      |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 渲染进程 | `contextIsolation` + `sandbox` + 零 Node 权限                                                                                                                             |
| IPC      | 通道白名单 + zod 入参校验（全部带参通道强制登记 schema，契约测试守护）                                                                                                    |
| 命令执行 | 参数数组化 + `-e` 分界 + 动作白名单                                                                                                                                       |
| 路径     | 控制字符 / `..` / Windows 非法字符（`parseLinuxPath`）拒绝，结果必须在发行版根内；备份路径拒绝控制字符并展开 `%USERPROFILE%`；`app:openPath` 仅允许目录（防文件关联执行） |
| 提权     | 独立 ElevationHelper 进程 + 结构化请求（**M7 已实现**：op 白名单 + 参数数组、Helper 二次校验 op/program、批量合并一次 UAC、取消给等价命令行）                             |
