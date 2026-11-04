# WSLPilot 0.2.0 迭代方案

> **主题：终端优先（Terminal-first）× WSL 3 容器工作台（wslc）× 架构与依赖 2.0**
>
> 状态：proposal / 待评审
> 基线：`0.1.4`（`a9767eb`）
> 日期：2026-11-03
> 原则：这是重大版本，允许破坏性变更；但**用户数据不丢**、**系统副作用仍只有一个入口**、**旧 WSL 必须 fail-soft**。

---

## 0. 结论摘要

0.1.4 的功能面已经完整，但有三处结构性瓶颈：

1. **终端不是“工作台”，而是“内容页里的一张卡片”**。
   `TerminalView` 有 16/20px 外内边距、`max-width: 1400px` 居中、页面标题、独立标签栏、独立工具栏、独立状态栏和 4 段 10px 间距；`XtermPane` 还有 6/8px 内边距、边框和圆角。按现有 CSS 估算，1920×1080 下终端实际绘图区只占内容区约 **63%–66%**，在 1180×760 默认窗口下也仅约 **65%**。用户说的“周围很多留白”不是错觉，是布局模型造成的。
2. **WSL 3 的新能力（wslc 容器、virtiofs、consomme、系统发行版、内核模块）完全未接入**。0.1.4 只探测了 `wslc version`，没有容器生命周期、镜像、网络、卷、事件、统计或 `settings.yaml`。
3. **工程底座停留在 2024–2025 年的版本**：Electron 33、Vite 5、Pinia 2、Zod 3、Vitest 2、ESLint 8。继续在此底座上叠功能，升级成本会指数上升。

0.2.0 的三条主线：

- **A. 终端 2.0**：独立 `WorkbenchLayout`，终端路由全出血；标题栏与标签栏合并；工具栏退化为按需浮层；侧栏在终端页自动收成 56px 图标轨；默认窗口从 1180×760 提升到 1440×900；新增专注模式、会话侧栏、命令块、容器终端、流控与输出批处理。目标：**1920×1080 下终端绘图区 ≥ 窗口面积 90%**（含 56px 导航轨）。
- **B. WSL 3 容器工作台**：新增「容器」一级页面，覆盖 `wslc` 的容器 / 镜像 / 构建 / 网络 / 卷 / 系统会话 / `settings.yaml`；容器 shell 直接成为终端标签；`wslc events` + `stats --format json` 驱动实时状态。**不做 Docker Desktop 替代品**，只做 WSL 原生容器轻管理。
- **C. 架构与依赖 2.0**：Electron 45、Vite 8、electron-vite 6、Vue Router 5、Pinia 4、Zod 4、TypeScript 6、Vitest 5、ESLint 10；main 进程转 ESM、preload 保持 CJS；IPC 从“四处对账”升级为**契约单一事实源**；配置升级到 v3 + 新增 `containers.jsonc`；终端会话模型从“pty 管理器”升级为“会话管理器 + 流控”。

**不建议**在 0.2.0 做的：i18n、插件市场、Docker/Compose 兼容层、云同步、深色应用主题（终端独立深色可以）、TypeScript 7（工具链未跟上）。

---

## 1. 现状诊断（基于全量源码与文档）

### 1.1 工程与运行时

| 维度       | 现状                                                                         | 判断                                                    |
| ---------- | ---------------------------------------------------------------------------- | ------------------------------------------------------- |
| 进程模型   | Electron main / preload / renderer 三层，`contextIsolation + sandbox`        | 健康，保留                                              |
| 主进程装配 | `main/index.ts` 工厂函数手工装配 20+ Service                                 | 可维护，但 0.2.0 需要拆出 `Workbench/Containers` 两个域 |
| IPC        | `channels.ts` + `ipc-schema.ts` + `preload/index.ts` + `handlers/*` 四处对账 | **最大架构债**：新增 40 个容器通道会放大漂移风险        |
| 配置       | JSONC + zod + 迁移链 + chokidar + 原子写 + 冲突三选一                        | 设计优秀，保留；需要 v3                                 |
| 长任务     | `TaskRunner` + `KeyedLock` + `spawnWslTask` + 取消/看门狗/日志限额           | 可复用；需要泛化为“任意工具流”                          |
| 终端       | node-pty 会话池 + xterm 6 + 分屏树 + KeepAlive                               | 功能全，但 UI 布局与数据通道需要重做                    |
| 测试       | 单测 1252、组件 374、E2E 4；覆盖率硬门禁                                     | 健康；升级后需要重建基线                                |
| 文档       | README / 设计书 / 架构 / 配置 / 测试 / 变更日志齐全                          | 0.2.0 需同步重写终端与容器章节                          |

### 1.2 终端界面占比：按现有 CSS 的定量估算

以 1920×1080 窗口、侧栏展开 232px 为例：

| 项目                    |              0.1.4 占用 | 说明                                                                            |
| ----------------------- | ----------------------: | ------------------------------------------------------------------------------- |
| 标题栏                  |                    40px | `TitleBar.vue`                                                                  |
| 全局状态栏              |                    28px | `StatusBar.vue`                                                                 |
| 内容区可用              |               1688×1012 | 1920−232，1080−40−28                                                            |
| `TerminalView` 最大宽度 |                  1400px | 居中后左右各留 144px                                                            |
| `TerminalView` 内边距   | 上 16 / 左右 20 / 下 12 | `.terminal-view`                                                                |
| 页面标题                |                   ≈44px | `h1 22px` + `.sub`                                                              |
| 标签栏                  |                   ≈40px | `TerminalTabs` 28px 高 + 6px 上下内边距 + 边框                                  |
| 工具栏                  |                   ≈30px | `TerminalToolbar` 独立一行，可换行                                              |
| 终端状态栏              |                   ≈20px | 行/列、UTF-8、时长                                                              |
| 四段 10px 间距          |                    40px | `.terminal-view { gap:10px }`（header/tabs/toolbar/panes/status 之间 4 个间隙） |
| `XtermPane` 内边距/边框 | 6/8px + 1px 边框 + 圆角 | 卡片式观感                                                                      |
| **终端绘图区估算**      |           **≈1360×793** | 约占内容区 **63%**、约占整窗 **52%**                                            |

在 1180×760 默认窗口下，侧栏 232px 后内容区仅 948px 宽；终端页仍保留标题、标签、工具栏、状态栏和 28px 上下内边距，垂直方向被切掉约 219px，终端绘图区只剩约 **473px 高**。这就是“终端看着占比太小”的直接原因。

**结论**：不是终端组件本身小，而是**页面壳层把终端当成了普通内容页**。0.2.0 必须把终端路由从 `DefaultLayout` 的内容页模型中拿出来。

### 1.3 终端能力缺口

已有：多标签、分屏（最多 4）、拖拽比例、KeepAlive、WebGL、搜索高亮、复制/粘贴、右键菜单、布局持久化、启动目录/Shell。

缺口：

- 没有**全出血/专注模式**，没有“终端优先”的布局。
- 工具栏是常驻横条，按钮多、占高、窄窗换行。
- 没有**会话侧栏**（运行中发行版、容器、最近会话、Profile）。
- 没有**命令块**（OSC 133/633 的 prompt/command/output 边界），无法“复制上一条输出/重跑上一条命令/跳转命令”。
- 没有**Shell 集成安装/修复**，OSC 7 cwd、exit code、git 分支拿不到。
- 没有**输出流控**：主进程逐 chunk `webContents.send`，`yes`/大日志会 IPC 风暴；没有 pause/resume + ACK。
- 没有**终端独立深色配色**（只有浅色/高对比）。
- 没有**容器终端**（`wslc exec -it`）。
- 没有**Quake/下拉终端**、多窗口、通知、链接文件路径处理。
- 搜索是 popover，不是覆盖层；没有“当前块/全部块”范围。
- 导出使用自建 buffer，未使用 xterm 序列化，复杂 TUI 回放不保真。

### 1.4 WSL 3 能力缺口

当前 `wsl-capabilities.ts` 只做了：

- `wsl --help` 逐 flag 探测；
- `wsl --version` / `wsl --status`；
- `wslc version --format json` 只取版本号。

未接入的 WSL 3 能力：

- **WSL 容器（wslc）**：容器、镜像、构建、网络、卷、统计、事件、健康检查、`container cp`、`restart`、`system info`、`system session terminate`、`--stop-timeout`、`--mount`。
- **virtiofs**：`wsl2.virtiofs`（实验，依赖 `virtio` + `hostFileSystemAccess`），官方称 Windows 文件访问最多 2×。
- **consomme 网络模式**：容器默认网络模式，Linux 流量经 Windows 转发，兼容 VPN/代理/企业网络。
- **新 `.wslconfig` 键**：`virtiofs`、`virtio`、`hostFileSystemAccess`、`systemDistro`、`kernelModules`、`kernelDebugPort`、`telemetry`、`debugConsoleLogFile`、`kernelBootTimeout`、`distributionStartTimeout`、`mountDeviceTimeout`、`crashDumpFolder`、`loadDefaultKernelModules`、`loadKernelModules`、`isolateDistroCgroup`。
- **WSL 3 内核 6.18 / 系统发行版**：没有环境卡展示，也没有“系统发行版路径/自定义 systemDistro”入口。
- **容器会话资源**：`%LOCALAPPDATA%\wslc\settings.yaml` 的 CPU / memory / storage / binding / credentialStore 完全不可见。

### 1.5 依赖债

当前实际安装版本（`npm ls`）与 2026-11 最新稳定版：

| 包                 |   0.1.4 | 最新稳定 | 备注                                                              |
| ------------------ | ------: | -------: | ----------------------------------------------------------------- |
| Electron           | 33.4.11 |   45.2.1 | Node 24 运行时；原生模块 ABI 需验证                               |
| electron-vite      |   2.3.0 |    6.0.0 | 支持 Vite 8                                                       |
| Vite               |  5.4.21 |    8.3.5 | 大版本跨 3 级                                                     |
| Vue                |  3.5.43 |   3.5.44 | 3.6 仍 RC，不上                                                   |
| Vue Router         |   4.5.0 |    5.4.0 | peer 要求 Vite 7/8、Pinia 3/4                                     |
| Pinia              |   2.3.1 |    4.1.0 | 大版本                                                            |
| Naive UI           |  2.45.3 |   2.45.3 | 已最新                                                            |
| Zod                | 3.25.76 |    4.6.7 | `.default()` 语义变化，需逐 schema 迁移                           |
| TypeScript         |   5.9.3 |    7.0.2 | **建议 6.0.3**：`@typescript-eslint` peer `<6.1`，TS 7 生态未跟上 |
| vue-tsc            |  2.1.10 |   3.3.14 | 需与 TS 6 验证                                                    |
| Vitest             |   2.1.8 |    5.1.0 | 配置/池/覆盖率 API 变化                                           |
| Playwright         |  1.49.1 |   1.64.1 | Electron 45 兼容需验证                                            |
| happy-dom          | 15.11.7 |   21.0.4 | 组件测试环境                                                      |
| ESLint             |  8.57.1 |  10.14.0 | 必须迁移 flat config                                              |
| @typescript-eslint |  8.18.0 |   8.72.1 | 支持 ESLint 10                                                    |
| eslint-plugin-vue  |  9.32.0 |  10.12.0 | flat config                                                       |
| Stylelint          | 16.12.0 |   18.0.0 | 配置升级                                                          |
| electron-builder   |  25.1.8 |  26.18.0 | 打包                                                              |
| electron-updater   |   6.8.9 |   6.8.11 | 小版本                                                            |
| chokidar           |   4.0.3 |    6.0.0 | **ESM-only，Node ≥22.22**；决定 main 转 ESM                       |
| node-pty           |   1.1.0 |    1.1.0 | 已最新，N-API 预编译                                              |
| @xterm/xterm       |   6.0.0 |    6.0.0 | 已最新                                                            |
| @types/node        |   22.10 |  24.19.2 | 对齐 Electron 45                                                  |

### 1.6 契约与配置债

- `channels.ts`、`ipc-schema.ts`、`preload/index.ts`、`handlers/*` 四处对账；新增容器域会再加约 30–40 个通道，靠人肉同步不可接受。
- `ConfigMap` 是手工接口 + zod schema 双份定义；新增 `containers` 配置会再次放大。
- `ui-state.terminalLayout` 是 0.1.3 的分屏树模型，0.2.0 终端工作台需要新模型（tabs、panes、sessions、profiles）。
- `TerminalView.vue` 承担了布局、命令、搜索、右键菜单、导出、分屏拖拽、状态栏，718 行；继续加功能会失控。
- `SettingsView.vue` 1030 行；新增终端/容器设置必须走“设置目录 + 通用表单”，否则会继续膨胀。

---

## 2. 0.2.0 目标与非目标

### 2.1 目标

1. **终端优先**：终端页成为独立工作台，默认全出血；在 1920×1080 下终端绘图区 ≥ 窗口面积 **90%**；在 1180×760 下 ≥ **85%**。
2. **终端能力跃迁**：会话侧栏、专注模式、命令块、Shell 集成、输出流控、容器终端、独立配色、通知、链接处理。
3. **WSL 3 容器工作台**：容器/镜像/构建/网络/卷/系统会话/设置完整闭环；实时事件与统计；与终端、网络、驾驶舱联动。
4. **WSL 3 平台对齐**：virtiofs、consomme、新 `.wslconfig` 键、systemDistro、内核模块、容器会话资源。
5. **架构 2.0**：IPC 契约单一事实源；main ESM；任务/事件/流控抽象；配置 v3 + 迁移。
6. **依赖全面升级**：Electron 45 / Vite 8 / Vue Router 5 / Pinia 4 / Zod 4 / TS 6 / Vitest 5 / ESLint 10。
7. **质量可交付**：新功能都有单测/组件测试/E2E/真机证据；视觉基线重建；发布门禁通过。

### 2.2 非目标

- 不做 Docker Desktop 替代：不实现 Compose、Swarm、Kubernetes、Registry 前端、任意 Docker CLI 透传。
- 不做应用级深色主题；**仅终端**可独立深色。
- 不做 i18n（界面仍以简体中文为主）。
- 不做插件市场、云同步、多用户。
- 不发布 `1.0.0`；版本继续 `0.x`。
- 不承诺 0.1.4 配置/通道/快捷键完全兼容；提供一次性迁移与迁移说明。
- 不在 0.2.0 引入数据库；容器实时状态来自 `wslc`，不落盘。

### 2.3 成功指标

| 指标                 | 目标                                                               |
| -------------------- | ------------------------------------------------------------------ |
| 终端绘图区占窗口面积 | 1920×1080 ≥ 90%；1180×760 ≥ 85%                                    |
| 终端首屏可交互       | 冷启动进入终端 ≤ 800ms（不含 WSL 启动）                            |
| 输入回显             | 本机键入到 xterm 显示 ≤ 16ms（P95，非高负载）                      |
| 大输出               | `yes` 持续 10s 不崩、不丢尾、可随时 Ctrl+C；内存增长 ≤ 50MB        |
| 容器列表刷新         | 事件驱动 ≤ 500ms；轮询回退 ≤ 3s                                    |
| 旧 WSL 降级          | WSL < 2.9.3 时容器页明确“需要更新”，不崩、不空转                   |
| 质量门禁             | 单测/组件/E2E/视觉/typecheck/lint/format/tokens 全绿               |
| 真机矩阵             | WSL 3.0.3 + wslc 3.0.3（完整）；2.9.3（容器最小）；2.7.x（无容器） |

---

## 3. 架构 2.0

### 3.1 进程与模块

```text
┌──────────────────────────────────────────────────────────────┐
│ Renderer（Vue 3 + Pinia 4 + Naive UI）                       │
│  ├─ layouts/WorkbenchLayout.vue      终端专属壳               │
│  ├─ features/terminal/*              终端工作台               │
│  ├─ features/containers/*            容器工作台               │
│  └─ features/content/*               原有内容页               │
├──────────────────────────────────────────────────────────────┤
│ Preload（contextBridge，CJS，sandbox）                         │
│  └─ 由 contracts 生成的窄接口；不含业务逻辑                    │
├──────────────────────────────────────────────────────────────┤
│ Main（Node 24 / ESM）                                         │
│  ├─ ipc/contracts.ts                 契约注册 + zod 校验       │
│  ├─ services/terminal-session.ts     会话/PTY/流控             │
│  ├─ services/wslc/*                  容器域                  │
│  ├─ services/wsl/*                   发行版本体               │
│  ├─ services/config/*                JSONC v3                │
│  ├─ services/operations/*            任务/锁/事件/流           │
│  └─ platform/*                       window/tray/updater/提权  │
├──────────────────────────────────────────────────────────────┤
│ System：wsl.exe / wslc.exe / netsh / usbipd / 文件系统         │
└──────────────────────────────────────────────────────────────┘
```

新增/重命名模块：

| 模块                                      | 职责                                                                    |
| ----------------------------------------- | ----------------------------------------------------------------------- |
| `main/services/terminal-session.ts`       | 由 `pty-manager.ts` 演化：会话 spec、PTY、流控、批处理、ACK、恢复       |
| `main/services/wslc/capabilities.ts`      | `wslc` 版本/子命令/JSON 能力探测                                        |
| `main/services/wslc/service.ts`           | 容器/镜像/网络/卷/系统会话/settings 的统一门面                          |
| `main/services/wslc/parsers.ts`           | NDJSON / OCI JSON / 表格回退解析（纯函数，可测）                        |
| `main/services/wslc/argv.ts`（shared 内） | 结构化 spec → argv 唯一事实源                                           |
| `main/services/operations/runner.ts`      | 由 `task-runner.ts` 泛化：任意流式工具、NDJSON、进度、取消、锁          |
| `main/services/operations/events.ts`      | 主→渲染事件总线，批处理与背压                                           |
| `shared/contracts/*`                      | 通道 + 入参 schema + 返回类型 + 事件类型                                |
| `shared/terminal/*`                       | 终端会话 spec、布局树、profile、快捷键元数据                            |
| `shared/containers/*`                     | 容器领域模型、校验、argv、解析器                                        |
| `kit/spawn-tool.ts`                       | 任意 Windows 工具的 spawn 封装（wslc/netsh/usbipd），行解码/取消/看门狗 |
| `kit/ndjson.ts`                           | NDJSON 流式解析（容器列表/统计）                                        |

### 3.2 IPC 2.0：契约单一事实源

**问题**：当前新增一个通道要改 4 处，漏一处测试才能发现。0.2.0 改成“定义一次，四处派生”：

```ts
// packages/shared/src/contracts/define.ts
export interface InvokeContract<In, Out> {
  channel: `wslpilot:${string}`
  input: z.ZodType<In>
  __out?: Out
}

export function invoke<In, Out>(channel: `wslpilot:${string}`, input: z.ZodType<In>): InvokeContract<In, Out> {
  return { channel, input }
}

// packages/shared/src/contracts/terminal.ts
export const terminalContracts = {
  create: invoke<TerminalCreateInput, TerminalSessionInfo>('wslpilot:terminal:create', terminalCreateSchema),
  input: invoke<TerminalInput, void>('wslpilot:terminal:input', terminalInputSchema),
  resize: invoke<TerminalResize, void>('wslpilot:terminal:resize', terminalResizeSchema),
  kill: invoke<TerminalId, void>('wslpilot:terminal:kill', terminalIdSchema),
  list: invoke<void, TerminalSessionInfo[]>('wslpilot:terminal:list', z.void()),
  ack: invoke<TerminalAck, void>('wslpilot:terminal:ack', terminalAckSchema),
  // ...
} as const
```

派生规则：

- `ipc/router.ts` 遍历 contracts，自动注册 handler；handler 返回类型与 `Out` 编译期对齐。
- `preload/index.ts` 由 contracts 生成/校验方法名与参数形状。
- `channels.ts` 只保留 `contracts` 的扁平导出，供测试与诊断使用；不再手写 `CH` 大表。
- 事件通道单独定义 `event<Payload>()`，preload 统一 `on/off`。
- 契约测试：**每个 contract 必须有 handler、有 preload 方法、有通过/拒绝用例**；新增通道漏注册直接红。

兼容策略：通道名统一加 `wslpilot:` 前缀（破坏性变更）；旧 `CH` 常量删除；迁移期只保留一个版本，不做双栈。

### 3.3 命令执行与提权

- 新增 `CommandExecutor`：`wsl` / `wslc` / `tool` 三类，统一：
  - 参数数组，禁止 shell 拼接；
  - 超时、取消、`maxBuffer`、截断标记；
  - 输出编码探测（wsl.exe UTF-16LE/UTF-8；wslc/netsh UTF-8/GBK）；
  - 结构化错误映射（`WSL_NOT_FOUND` / `PERMISSION_DENIED` / `TASK_FAILED` / `WSL_FEATURE_UNSUPPORTED`）。
- `wslc` **不进入提权白名单**：容器操作按当前用户运行，不需要 UAC；只有 `wsl --update`、`--install`、`--move`、`netsh`、`usbipd bind` 保持提权。
- 终端会话 spec 只允许三种：
  ```ts
  type TerminalLaunch =
    | { kind: 'distro'; distro: string; shell?: string; cwd?: string; user?: string; env?: Record<string, string> }
    | { kind: 'container'; containerId: string; shell?: string; user?: string; env?: Record<string, string> }
    | { kind: 'command'; distro: string; program: string; args: string[]; user?: string; cwd?: string }
  ```
  主进程按 kind 生成 `wsl.exe` / `wslc.exe` 参数；渲染层永远不能传任意 executable。

### 3.4 任务、事件与流

`OperationRunner`（TaskRunner 2.0）：

```ts
interface OperationSpec {
  type: OperationType
  title: string
  lockKey?: string
  run: (ctx: OperationContext) => Promise<void>
}

interface OperationContext {
  report(percent: number | null, message?: string): void
  log(line: string): void
  event<T>(name: string, payload: T): void
  isCanceled(): boolean
  onCancel(fn: () => void): void
  ndjson<T>(schema: z.ZodType<T>): AsyncIterable<T> // wslc --format json
}
```

- 新增 `OperationType`：`container-run` / `container-build` / `container-pull` / `container-prune` / `wslc-session` 等。
- 同步扩展三处：`TaskType` 联合、`stateFileSchema.lastTaskResult.type` 枚举、`useTaskProgress.TASK_TYPE_LABELS`（`satisfies Record<TaskType,…>` 编译期兜底）。
- 锁键规范：
  - `wslc:session`：会话级（terminate / settings 变更）
  - `wslc:container:<id>`：单容器生命周期
  - `wslc:image:<ref>`：镜像 pull/build/remove
  - `<distro>`：原有发行版级
  - `wsl:global`：WSL 本体
- 事件批量：`containers:changed` 以 300ms 合并；`stats` 以 1s 推送；`logs` 以 8–16ms 合并。
- 取消：`AbortController` 统一；`wslc events` / `logs -f` 必须真正 kill 子进程，不能只置标记。

### 3.5 配置 2.0

- 保留 JSONC + 原子写 + 冲突三选一 + chokidar。
- `ConfigMap` 由 zod schema 推导，删除手写重复接口（`z.infer` 为唯一事实源）。
- 新增 `containers` 配置键与 `containers.jsonc`。
- 新增 `settings.workbench` / 扩展 `settings.terminal` / 新增 `settings.containers`。
- 迁移链 v3；迁移前备份到 `backups/v0.1.4/`。
- 配置读取仍 fail-soft；但**未知字段不再静默剥离**：保留在 raw 视图，保存时只改已知叶子。

### 3.6 目录结构变更（节选）

```text
packages/shared/src/
├─ contracts/
│  ├─ define.ts
│  ├─ terminal.ts
│  ├─ containers.ts
│  ├─ wslc.ts
│  └─ index.ts
├─ terminal/
│  ├─ layout.ts          # 工作台布局树/几何/恢复
│  ├─ profiles.ts        # 终端 profile
│  └─ shell-integration.ts
├─ containers/
│  ├─ types.ts
│  ├─ schema.ts
│  ├─ argv.ts
│  └─ parsers.ts
├─ wslc.ts               # 能力/版本/特性元数据
├─ config-schema.ts      # v3
├─ config-migrations.ts  # v3
└─ tokens.ts             # 2.0 令牌

apps/desktop/src/main/
├─ services/terminal-session.ts
├─ services/wslc/
│  ├─ capabilities.ts
│  ├─ service.ts
│  ├─ parsers.ts
│  └─ events.ts
├─ services/operations/
│  ├─ runner.ts
│  └─ events.ts
├─ ipc/contracts.ts
└─ platform/...

apps/desktop/src/renderer/
├─ layouts/WorkbenchLayout.vue
├─ features/terminal/
│  ├─ TerminalWorkbench.vue
│  ├─ TerminalTopBar.vue
│  ├─ TerminalTabStrip.vue
│  ├─ TerminalSessionRail.vue
│  ├─ TerminalPane.vue
│  ├─ TerminalPaneHeader.vue
│  ├─ TerminalStatusLine.vue
│  ├─ TerminalSearchOverlay.vue
│  ├─ TerminalCommandBar.vue
│  └─ TerminalStartCenter.vue
├─ features/containers/
│  ├─ ContainersView.vue
│  ├─ ContainerTable.vue
│  ├─ ContainerDetailDrawer.vue
│  ├─ ContainerLogsPanel.vue
│  ├─ ContainerStatsCard.vue
│  ├─ RunContainerModal.vue
│  ├─ ImageList.vue
│  ├─ ImagePullModal.vue
│  ├─ BuildImageModal.vue
│  ├─ NetworkList.vue
│  ├─ VolumeList.vue
│  └─ WslcSettingsPanel.vue
├─ stores/workbench.ts
├─ stores/terminal.ts        # 拆分：sessions / layout / preferences
├─ stores/containers.ts
└─ stores/wslc-env.ts
```

---

## 4. 依赖与工具链全面升级

### 4.1 版本矩阵

| 包                             |   0.1.4 |              0.2.0 目标 | 说明                                |
| ------------------------------ | ------: | ----------------------: | ----------------------------------- |
| Node                           |     ≥20 | **≥22.22**，推荐 24 LTS | chokidar 6 / Vitest 5 / Electron 45 |
| npm                            |      12 |                  12.0.2 | 保持 workspaces                     |
| Electron                       | 33.4.11 |              **45.2.1** | Node 24；ESM main                   |
| electron-vite                  |   2.3.0 |               **6.0.0** | Vite 8                              |
| Vite                           |  5.4.21 |               **8.3.5** | Rolldown 生态需验证                 |
| @vitejs/plugin-vue             |   5.2.1 |              **6.0.10** |                                     |
| Vue                            |  3.5.43 |              **3.5.44** | 3.6 仍 RC，不上                     |
| Vue Router                     |   4.5.0 |               **5.4.0** | 破坏性大版本                        |
| Pinia                          |   2.3.1 |               **4.1.0** | 破坏性大版本                        |
| Naive UI                       |  2.45.3 |              **2.45.3** | 已最新                              |
| Zod                            | 3.25.76 |               **4.6.7** | `.default()` → `.prefault()` 等     |
| TypeScript                     |   5.9.3 |               **6.0.3** | 不上 7.0.2（eslint peer <6.1）      |
| vue-tsc                        |  2.1.10 |              **3.3.14** | 需与 TS 6 验证                      |
| Vitest                         |   2.1.8 |               **5.1.0** |                                     |
| @vitest/coverage-v8            |   2.1.8 |               **5.1.0** |                                     |
| @playwright/test               |  1.49.1 |              **1.64.1** |                                     |
| happy-dom                      | 15.11.7 |              **21.0.4** |                                     |
| @vue/test-utils                |   2.4.6 |               **2.5.1** |                                     |
| ESLint                         |  8.57.1 |             **10.14.0** | flat config                         |
| @typescript-eslint             |  8.18.0 |              **8.72.1** | 支持 ESLint 10                      |
| eslint-plugin-vue              |  9.32.0 |             **10.12.0** |                                     |
| Stylelint                      | 16.12.0 |              **18.0.0** |                                     |
| stylelint-config-standard-scss |      14 |              **17.0.0** |                                     |
| Prettier                       |   3.4.2 |              **3.9.10** |                                     |
| tsx                            |  4.19.2 |             **4.23.15** |                                     |
| sass                           |  1.83.0 |             **1.107.1** |                                     |
| chokidar                       |   4.0.3 |               **6.0.0** | ESM-only，Node ≥22.22               |
| electron-builder               |  25.1.8 |             **26.18.0** |                                     |
| electron-updater               |   6.8.9 |              **6.8.11** |                                     |
| node-pty                       |   1.1.0 |               **1.1.0** | 保持，N-API 预编译                  |
| @xterm/xterm                   |   6.0.0 |               **6.0.0** | 保持                                |
| @xterm/addon-fit               |  0.11.0 |              **0.11.0** |                                     |
| @xterm/addon-search            |  0.16.0 |              **0.16.0** |                                     |
| @xterm/addon-unicode11         |   0.9.0 |               **0.9.0** |                                     |
| @xterm/addon-web-links         |  0.12.0 |              **0.12.0** |                                     |
| @xterm/addon-webgl             |  0.19.0 |              **0.19.0** |                                     |
| @xterm/addon-clipboard         |       — |               **0.2.0** | OSC 52                              |
| @xterm/addon-serialize         |       — |              **0.14.0** | 会话导出/快照                       |
| @xterm/addon-ligatures         |       — |      **0.10.0**（可选） | 需验证 xterm 6                      |
| @types/node                    |   22.10 |             **24.19.2** | 对齐 Electron 45                    |
| yaml                           |       — |               **2.9.1** | 解析 `wslc settings.yaml`           |

### 4.2 升级顺序（每一步都必须全绿）

1. **工具链 Spike（1–2 天）**
   - 在独立分支验证 Electron 45 + node-pty 1.1.0 预编译；启动、终端、打包冒烟。
   - 验证 electron-vite 6 + Vite 8 + Vue 3.5.44 + plugin-vue 6。
   - 验证 TS 6.0.3 + vue-tsc 3.3.14 + @typescript-eslint 8.72。
   - 失败则记录回退点，不把不确定版本合入主线。
2. **运行时升级**：Electron 45 → electron-vite 6 → Vite 8 → ESM main / CJS preload。保持旧代码可启动。
3. **框架升级**：Vue Router 5 → Pinia 4。路由/状态测试先行。
4. **校验层升级**：Zod 4 逐 schema 迁移；先改 `shared`，再改 `main`/`renderer`。
5. **测试链升级**：Vitest 5 → happy-dom 21 → Playwright 1.64；重建覆盖率配置与视觉基线。
6. **Lint/格式**：ESLint 10 flat config → Stylelint 17（config-standard-scss@17 peer）→ Prettier 3.9。
7. **清理债务**：删除旧 `.eslintrc.cjs`、旧 `CH` 常量、旧 `SplitPane` 残留、旧终端组件。
8. **打包验证**：electron-builder 26 + NSIS + portable + `verify:release`。

### 4.3 关键迁移点

#### ESM main

- `chokidar@6` 是 ESM-only，main 必须 ESM（或动态 `import()`）。
- 方案：`apps/desktop/package.json` 增加 `"type": "module"`；main 输出 `out/main/index.mjs`；preload 强制 CJS `out/preload/index.cjs`（sandbox preload 不支持 ESM）。
- `__dirname` → `import.meta.dirname`；`createRequire(import.meta.url)` 加载 `node-pty`。
- `electron-updater` 等 CJS 依赖用默认导入 + 互操作验证。
- 风险：Electron 45 ESM main 与 `app.whenReady()` 时序、`process.env.VITE_DEV_SERVER_URL` 不变；需要启动冒烟。

#### Zod 4

- `z.object({...}).default({})` 在 Zod 4 中按**输出类型**要求默认值，且默认值会短路解析；当前大量“空对象补默认值”的语义要改为 `.prefault({})` 或显式 `defaultConfig`。
- `z.record()` 需要 key schema；`z.custom()` 错误消息 API 变化；`ZodTypeAny` 逐步替换为 `z.ZodType`。
- `safeParse` 的 `issues` 结构基本不变；`error.format()` 已移除，改用 `z.treeifyError()`（如使用）。
- 迁移策略：为每个配置文件补“空对象/缺字段/非法字段”三组测试，确保默认值不回归。

#### Vue Router 5 / Pinia 4

- 路由 API 基本保持；重点是 `router.push` 返回值、`afterEach`、`meta` 类型、`KeepAlive` 行为。
- Pinia 4 的 devtools peer 变化；options store 仍可用；把 `terminal` store 拆成 `sessions/layout/preferences` 三个 store，降低单 store 复杂度。
- 删除 `pinia` 旧持久化插件（当前未用）。

#### Vitest 5

- `test.coverage.thresholds` 的 per-glob 语法保持；`pool` 默认值变化，需显式 `pool: 'forks'` 或 `threads` 以稳定 Electron/原生模块测试。
- `happy-dom` 21 对 `ResizeObserver`、`matchMedia` 行为有变化；组件测试补齐 polyfill。
- Playwright 1.64 的 `toHaveScreenshot` 选项保持；`animations: 'disabled'` 仍可用。

#### ESLint 10

- `.eslintrc.cjs` → `eslint.config.mjs`（flat config）。
- 使用 `typescript-eslint` 统一包；Vue 用 `eslint-plugin-vue` 的 flat config。
- 保留现有规则精神：`no-control-regex` 例外、Vue 多词组件名等；不要为了升级放宽规则。
- Stylelint 17 配置迁移；`stylelint-config-standard-scss@17`。

### 4.4 暂缓项

| 项                         | 原因                                             | 计划         |
| -------------------------- | ------------------------------------------------ | ------------ |
| TypeScript 7.0.2           | `@typescript-eslint` peer `<6.1`；vue-tsc 未验证 | 0.3.0 spike  |
| Vue 3.6                    | 仍 RC                                            | 等稳定       |
| Vite 9 / Electron 46 alpha | 无稳定必要                                       | 跟随下个版本 |
| pnpm / Turborepo           | 当前 npm workspaces 足够                         | 不引入       |
| 深色应用主题               | 产品策略                                         | 仅终端深色   |

---

## 5. 终端 2.0（重点）

### 5.1 设计目标：从“内容页里的卡片”到“工作台”

终端不是“一个页面”，而是“应用的主工作区”。0.2.0 的终端路由使用独立的 `WorkbenchLayout`，不再套 `DefaultLayout` 的内容区内边距、标题、状态栏。

**三条硬规则**：

1. 终端绘图区之外，只允许存在：顶部 34px 工作台栏、底部 20px 状态行、左侧 56px 导航轨（可收）、可选 240px 会话侧栏。
2. 不允许 `max-width`、不允许页面标题、不允许常驻工具栏、不允许 10px 段间距。
3. 所有“操作”优先进快捷键/右键菜单/命令栏；只有搜索、分屏、新建保留在顶栏。

### 5.2 布局与像素预算

```text
┌──────────────────────────────────────────────────────────────┐
│ WorkbenchTopBar 34px                                         │
│ [logo/nav] [tab][tab][+]        [search][palette][win][win]  │
├──────┬───────────────────────────────────────────────────────┤
│ Rail │ Pane area（100% 剩余宽高）                            │
│ 56   │ ┌──────────────────┬──────────────────┐              │
│      │ │ PaneHeader 22px  │ PaneHeader 22px  │              │
│      │ │ xterm            │ xterm            │              │
│      │ │                  │                  │              │
│      │ └──────────────────┴──────────────────┘              │
├──────┴───────────────────────────────────────────────────────┤
│ TerminalStatusLine 20px  distro · user@host · cwd · branch   │
└──────────────────────────────────────────────────────────────┘
```

| 项目         |             0.1.4 |                        0.2.0 |
| ------------ | ----------------: | ---------------------------: |
| 标题栏       |                40 |         合并进 34px 工作台栏 |
| 页面标题     |               ≈44 |                            0 |
| 标签栏       |               ≈40 |                    0（合并） |
| 工具栏       |               ≈30 |             0（浮层/命令栏） |
| 终端状态栏   |               ≈20 |                           20 |
| 外层内边距   |        16+12 / 20 |                            0 |
| 最大宽度     |              1400 |                           无 |
| xterm 内边距 | 6+8 + 边框 + 圆角 |             4px，无边框/圆角 |
| 分屏间隙     |                 0 |                          1px |
| 侧栏         |               232 | 56（终端页自动收轨；可展开） |

**估算结果**（非实测）：

- 1920×1080：终端绘图区约 **1864×1026 = 1.91M px²**，占整窗 **92%**；占内容区 **~100%**。
- 1180×760：终端绘图区约 **1124×706 = 0.79M px²**，占整窗 **88.5%**；开启专注模式（隐藏状态行）可到 **91%**。
- 对比 0.1.4 的 **63%–66%**，提升约 **26–29 个百分点**。

> 验收时用 Playwright 读取 `boundingBox()`，不是只看截图。

### 5.3 组件拆分

| 组件                         | 职责                                              | 关键约束                                              |
| ---------------------------- | ------------------------------------------------- | ----------------------------------------------------- |
| `WorkbenchLayout.vue`        | 终端路由专用壳；顶栏/侧轨/状态行/内容             | 不引入内容页 padding；路由 meta `layout: 'workbench'` |
| `TerminalWorkbench.vue`      | 会话/标签/分屏编排；替代 718 行 `TerminalView`    | 只做编排，不写 DOM 细节                               |
| `TerminalTopBar.vue`         | 拖拽区、logo/返回、标签、搜索、命令面板、窗口控制 | 34px；`-webkit-app-region: drag`；按钮 `no-drag`      |
| `TerminalTabStrip.vue`       | 标签渲染、拖拽排序、重命名、溢出菜单、`+`         | 30px 标签；水平滚动；垂直模式可选                     |
| `TerminalSessionRail.vue`    | 会话侧栏：打开的面板、运行中发行版、容器、Profile | 180–360px 可拖；默认收起                              |
| `TerminalPane.vue`           | xterm 实例、fit、主题、流控 ACK、命令块           | 以 sessionId 为 key；不随分屏重建                     |
| `TerminalPaneHeader.vue`     | 发行版/容器、shell、cwd、状态、最大化/关闭        | 22px；单面板自动隐藏                                  |
| `TerminalStatusLine.vue`     | cwd、git 分支、行列、编码、时长、退出码           | 20px；`aria-live` 仅关键变化                          |
| `TerminalSearchOverlay.vue`  | 搜索覆盖层、大小写/正则/全词、N/M                 | 覆盖在终端右上，不占布局                              |
| `TerminalCommandBar.vue`     | 命令栏：分屏、清屏、导出、通知、主题、快捷键      | 默认隐藏；`Ctrl+Shift+P` 打开                         |
| `TerminalStartCenter.vue`    | 无会话时的启动中心（发行版/容器/Profile/最近）    | 全宽卡片，不用居中空态                                |
| `ShellIntegrationBanner.vue` | 提示安装/修复 Shell 集成                          | 可关闭；不自动改用户 rc                               |

### 5.4 交互与快捷键

| 快捷键                         | 动作                                   | 说明                                              |
| ------------------------------ | -------------------------------------- | ------------------------------------------------- |
| `Ctrl+K`                       | 全局命令面板                           | 保留                                              |
| `Ctrl+Shift+P`                 | 终端命令栏 / 命令面板终端模式          | 原“显示等价命令”移到设置；`useHotkeys` 需同步迁移 |
| `Ctrl+Shift+T`                 | 新建标签                               | 保留                                              |
| `Ctrl+Shift+W`                 | 关闭当前面板                           | 最后一个面板关闭标签                              |
| `Ctrl+Shift+5` / `6`           | 左右/上下分屏                          | 保留                                              |
| `Ctrl+Shift+M`                 | 最大化/还原当前面板                    | 新增                                              |
| `Ctrl+Shift+B`                 | 显示/隐藏会话侧栏                      | 新增                                              |
| `Ctrl+Shift+Enter`             | 专注模式（隐藏导航轨/状态行/顶栏精简） | 新增                                              |
| `F11`                          | 全屏                                   | 新增                                              |
| `Ctrl+`` `                     | 下拉终端（Quake，可选）                | 新增，P1                                          |
| `Ctrl+Tab` / `Ctrl+Shift+Tab`  | 循环标签                               | 保留                                              |
| `Ctrl+1…9`                     | 切换标签                               | 保留                                              |
| `Ctrl+Shift+F`                 | 搜索覆盖层                             | 保留                                              |
| `Ctrl+Shift+C/V`               | 复制/粘贴                              | 保留                                              |
| `Ctrl+=` / `Ctrl+-` / `Ctrl+0` | 字号 +/-/重置                          | 新增                                              |
| `Alt+↑/↓`                      | 上一条/下一条命令块                    | 新增（需 Shell 集成）                             |
| `Ctrl+Shift+↑/↓/←/→`           | 面板焦点移动                           | 新增                                              |

右键菜单精简为：复制 / 粘贴 / 全选 / 查找 / 清屏 / 分屏 / 最大化 / 关闭面板 / 复制上一条输出（有命令块时）。

### 5.5 终端引擎增强

- **xterm 6** 保持；新增 addon：
  - `@xterm/addon-clipboard`：OSC 52 写剪贴板；读需用户确认（安全）。
  - `@xterm/addon-serialize`：导出/快照，替代手写 buffer 导出。
  - `@xterm/addon-ligatures`：可选，默认关闭；字体不支持时自动跳过。
- **WebLinksAddon 自定义 handler**：链接不调用 `window.open`，统一走 `app:openExternal`（http/https 白名单）；文件路径链接走“在资源管理器中显示/在编辑器中打开”。
- **主题**：`terminal.theme: 'light' | 'dark' | 'follow-app' | 'high-contrast'`；应用仍浅色，终端可独立深色。深色主题进 `shared/tokens.ts` 或独立 `terminal-theme.ts`，不污染 Naive 主题。
- **字体**：字体族、字号、行高、字距、光标样式/闪烁、`minimumContrastRatio`、`drawBoldTextInBrightColors`、`customGlyphs`、`rescaleOverlappingGlyphs`。
- **输入**：IME 组合、CJK 宽字符、bracketed paste、多行粘贴确认、拖拽文件插入路径（Windows ↔ WSL 路径转换用 `wslpath`，失败给原文）。
- **搜索**：覆盖层、增量、大小写/正则/全词、全部高亮、当前命中强调、N/M、滚动条标记。
- **通知**：bell / OSC 9 / OSC 777 → 系统通知（可关）；窗口失焦时任务完成通知。
- **无障碍**：`screenReaderMode` 可选；面板/tab `role` 语义；焦点环；高对比主题；`prefers-reduced-motion` 下无过渡。

### 5.6 Shell 集成与命令块

**目标**：不靠正则猜 prompt，拿到真实的命令边界、exit code、cwd、耗时。

- 解析 `OSC 133`（prompt start / command start / output start / command finished）与 `OSC 7`（cwd）；兼容 `OSC 633`（VS Code）。
- `TerminalPane` 注册 OSC handler，维护 `CommandBlock[]`：
  ```ts
  interface CommandBlock {
    id: string
    promptLine: number
    commandLine?: number
    outputStart?: number
    endLine?: number
    exitCode?: number
    cwd?: string
    startedAt?: number
    durationMs?: number
  }
  ```
- UI：
  - 左侧 gutter 状态点（成功绿/失败红/运行中脉冲）。
  - 悬浮块操作：复制命令、复制输出、重跑、在命令历史中定位。
  - `Alt+↑/↓` 跳转块；命令面板“复制上一条命令输出 / 重跑上一条命令”。
  - 状态行显示当前块 exit code / 耗时。
- **Shell 集成安装（显式、可逆）**：
  - 每个发行版一个“安装 Shell 集成”按钮；文件固定写到 `~/.wslpilot/shell-integration/`。
  - bash：`--rcfile ~/.wslpilot/shell-integration/bashrc`，脚本先 source 用户 `~/.bashrc`，再注入 `PROMPT_COMMAND`/`trap DEBUG`。
  - zsh：`ZDOTDIR=~/.wslpilot/shell-integration/zsh`，`.zshrc` source 原 `ZDOTDIR`/`~/.zshrc`。
  - fish：0.2.0 仅检测，不自动安装（P2）。
  - **绝不修改** `~/.bashrc` / `~/.zshrc`；移除只需删目录。
  - 写入走 `wsl -d X -e tee`（用户权限，不需要 root），内容来自 `shared/terminal/shell-integration.ts` 固定模板，不拼接用户输入。
  - 状态：`shell:status` 返回 `installed/partial/unsupported`；终端启动时若 profile 开启但未安装，显示横幅而不是静默失败。

### 5.7 会话模型与持久化

**主进程**（`terminal-session.ts`）：

```ts
interface TerminalSessionInfo {
  sessionId: string
  launch: TerminalLaunch
  title: string
  createdAt: number
  lastActivityAt: number
  alive: boolean
  exitCode?: number
  bytesIn: number
  bytesOut: number
}
```

- 会话上限从 10 提升到 **24**（可配置），但默认仍 12，避免误开。
- 会话 spec 持久化到 `ui-state`：仅保存“标签/分屏/标题/profile”，不保存 pty 进程；app 重启后会话不存在，进入 Start Center。
- Renderer 重载：`terminal:list` 找回仍存活的会话，按保存的布局恢复；死面板剪枝、单子 split 折叠。
- 输出流：
  - main 侧按 8–16ms / 64KB 合并 chunk；消息带 `seq`。
  - renderer 每帧 ACK 已消费字节；未 ACK > 1MB 时 `pty.pause()`，ACK 后 `pty.resume()`；不支持 pause 的平台退化为丢弃“渲染层已关闭”的会话输出（绝不丢活跃会话）。
  - 保留 `MAX_PTY_SESSIONS` 双保险；会话关闭时清理 buffer/ACK 状态。
- 导出：`SerializeAddon.serialize()` + 元数据（标题、发行版、时间、shell）生成 `.log`；不再用手写 200KB buffer 作为唯一来源。

### 5.8 容器终端

- `TerminalLaunch` 的 `kind: 'container'` 由主进程生成：
  ```text
  wslc.exe exec -it <containerId> <shell>
  ```
- 默认 shell 探测顺序：`/bin/bash` → `/bin/sh`；用户可在 Profile 指定。
- 容器未运行：禁用“打开终端”，提示先启动。
- 容器停止/删除：对应终端会话收到退出事件，状态行显示“容器已停止”，标签保留（可重启或关闭）。
- 容器终端标签标题：`容器名 · 镜像短名`；图标用容器徽标，不用发行版 emoji。

### 5.9 专注模式 / Quake 模式 / 多窗口

- **专注模式**：`Ctrl+Shift+Enter`。隐藏导航轨、状态行、顶栏多余按钮；保留 28px 浮动退出条；终端绘图区接近 100%。`Esc` 或再次快捷键退出。
- **Quake 下拉终端（P1）**：全局快捷键（默认 `Ctrl+``，可配置）显示/隐藏一个 frameless、always-on-top、贴屏幕顶部的终端窗口；复用主进程会话池；`Esc`隐藏。需要`globalShortcut` 注册/冲突检测/注销。
- **多窗口（P2）**：`window:openTerminal` 创建第二个 `BrowserWindow`，加载 `#/terminal?window=2`；共享主进程 PtyManager；关闭窗口只关该窗口会话。0.2.0 先预留契约，不承诺完整实现。

### 5.10 性能与无障碍

- **WebGL**：默认 `auto`；上下文丢失回退 DOM；设置可强制 `on/off`。
- **渲染**：非活动标签 `display:none`，xterm 不重绘；激活时 `fit()`。
- **输出**：流控 + 批处理；`scrollback` 默认 10k，上限 100k；buffer 上限按会话计算。
- **启动**：终端页懒加载；xterm 实例按需创建；字体预加载 `document.fonts.ready` 后 fit。
- **无障碍**：所有图标按钮 `aria-label`；tablist/tab 语义；面板 `role=group`；状态行 `role=status`；搜索 `aria-live=polite`；焦点陷阱只在覆盖层；高对比主题；`screenReaderMode` 可选。
- **窗口**：默认 1440×900；最小 960×600；窄窗自动收起会话侧栏/导航轨；1024×720 下仍可用。

### 5.11 终端验收标准

- [ ] 1920×1080 下，终端 pane 的 `boundingBox` 面积 ≥ 窗口面积 90%。
- [ ] 1180×760 下 ≥ 85%；1024×720 下 ≥ 82%。
- [ ] 分屏/关闭/拖拽比例不重建 xterm，scrollback 与 TUI 现场不丢。
- [ ] `yes` 持续 10s 可中断；内存增长 ≤ 50MB；不丢尾行。
- [ ] 切换路由再回，vim/htop 现场不变。
- [ ] 搜索 N/M、大小写/正则、全部高亮可用。
- [ ] 命令块：bash/zsh 安装后，prompt/command/output 边界、exit code、cwd 正确；卸载后恢复原状。
- [ ] 容器终端可打开、可交互、容器停止后状态正确。
- [ ] 专注模式无布局跳动；退出后恢复原布局。
- [ ] 终端深色/浅色/高对比切换即时生效且持久化。
- [ ] 所有快捷键在设置页可查；冲突有提示。

---

## 6. WSL 3 新特性与容器工作台

### 6.1 WSL 3 能力清单（0.2.0 要用的）

| 能力                                            | 说明                                         | 0.2.0 用法             |
| ----------------------------------------------- | -------------------------------------------- | ---------------------- |
| `wslc` 容器 CLI                                 | WSL 3 GA 内置 `wslc.exe`                     | 容器工作台全部功能     |
| 容器生命周期                                    | `run/create/start/stop/restart/remove/prune` | 容器表/详情/操作       |
| `container cp`                                  | tar 归档进出容器                             | 文件导入/导出          |
| 健康检查                                        | `--health-cmd` 等                            | 容器状态徽章/详情      |
| `--stop-timeout` / `--mount`                    | 停止超时 / 挂载                              | 运行向导高级选项       |
| `container logs -f`                             | 实时日志                                     | 日志面板/任务抽屉      |
| `exec -it`                                      | 容器内交互                                   | 终端标签               |
| `stats --format json`                           | CPU/内存/网络/块 I/O                         | 统计卡/仪表盘          |
| `events`                                        | 实时事件流                                   | 列表刷新/通知          |
| `system info` / `system session list/terminate` | 容器环境/会话                                | 系统页/资源卡          |
| `settings.yaml`                                 | CPU/内存/存储/绑定/凭据                      | 设置编辑器/表单        |
| `virtiofs`                                      | 实验性文件共享，2× 速度                      | `.wslconfig` 字段/体检 |
| `consomme`                                      | 容器默认网络模式                             | 网络模式枚举/说明      |
| 新 `.wslconfig` 键                              | 内核模块/系统发行版/超时/崩溃转储            | 配置编辑器扩展         |
| WSL 3 内核 6.18                                 | 环境信息                                     | 环境卡展示             |

> 来源：Microsoft Learn `wsl-container`、`wsl-container-settings`、`wsl-config`；WSL Containers GA（2026-09-29）。详见附录 A。
>
> **为什么用 `wslc.exe` 而不是 `Microsoft.WSL.Containers` API**：本项目是 Electron/Node，没有 C#/WinRT 投影；`wslc --format json` 已覆盖列表/统计/检查，且所有调用可继续走「参数数组 + 结构化校验」的既有安全边界。原生 API 可作为 0.3.0 的性能/事件增强选项，不进入 0.2.0 关键路径。

### 6.2 `wslc` 能力探测

新增 `WslcCapabilities`：

```ts
interface WslcCapabilities {
  installed: boolean
  version: string
  jsonLists: boolean // list --format json
  jsonStats: boolean // stats --format json
  events: boolean // wslc events
  health: boolean
  copy: boolean // container cp
  restart: boolean // container restart
  systemInfo: boolean // system info
  session: boolean // system session list/terminate
  mount: boolean // --mount
  gpu: boolean // --gpus
  networks: boolean
  volumes: boolean
  settingsFile: boolean // %LOCALAPPDATA%\wslc\settings.yaml
}
```

探测方式：

1. `wslc version --format json` → 版本。
2. `wslc --help` / `wslc container --help` / `wslc image --help` / `wslc system --help` → 子命令与 flag。
3. `%LOCALAPPDATA%\wslc\settings.yaml` 是否存在（不创建）。
4. 缓存 60s；`wsl --update` / `wslc` 版本变化后失效。
5. 失败 fail-soft：`installed:false`，容器页显示“更新 WSL”而不是报错白屏。

`WslCapabilities` 扩展：

```ts
interface WslCapabilities {
  // ...existing
  wslc: WslcCapabilities | null
  virtiofs: boolean
  consomme: boolean
  systemDistro: boolean
  containerSession: boolean
}
```

`WSL_FEATURE_META` 增加：

- `containers: { label: 'WSL 容器', minVersion: '2.9.3' }`
- `virtiofs: { label: 'VirtioFS 文件共享', minVersion: '3.0' }`
- `consomme: { label: 'Consomme 网络模式', minVersion: '3.0' }`
- `wslcEvents`, `wslcHealth`, `wslcSystem` 等按能力表补充。

> `WslEnvironmentCard.vue` 目前把 11 个能力行硬编码在 `capabilityRows`；0.2.0 要改为从 `WSL_FEATURE_META` 自动生成，否则新增能力不会出现在设置页。

### 6.3 容器页面信息架构

侧栏新增一级「容器」（位于「终端」与「网络」之间）。页面顶部：

- 环境条：WSL 版本 / wslc 版本 / 容器会话状态 / 存储路径 / 磁盘占用。
- 四个摘要卡：运行中容器、镜像数、网络数、会话 CPU/内存。
- 主 Tab：**容器 / 镜像 / 网络 / 卷 / 系统**。
- 全局动作：运行容器、拉取镜像、构建镜像、清理（按 Tab 上下文）。

**容器 Tab**

| 列       | 内容                                                  |
| -------- | ----------------------------------------------------- |
| 名称/ID  | 名称 + 短 ID，点击详情                                |
| 镜像     | 镜像引用（可复制）                                    |
| 状态     | running / exited / created / paused + 健康徽章        |
| 端口     | `host → container` 列表                               |
| 资源     | CPU% / 内存（来自 stats，1s 刷新）                    |
| 创建时间 | 相对时间                                              |
| 操作     | 终端、日志、停止/启动/重启、更多（inspect/cp/remove） |

空态：三个启动卡片（`alpine` 快速体验、`ubuntu` 交互 shell、`nginx` Web 服务）+ “从 Containerfile 构建”。

**镜像 Tab**

- 列表：仓库/标签、ID、大小、创建时间、使用中的容器数。
- 动作：拉取（进度）、inspect、删除、prune（确认）。
- 构建：选择 Windows 目录（Containerfile 所在）、tag、build args、`--no-cache`（如支持）；流式日志 + 取消；完成后刷新镜像列表。

**网络 Tab / 卷 Tab**

- 列表 + 创建/删除/prune/connect/disconnect；显示关联容器；删除前确认。
- 网络驱动默认 bridge；支持 subnet/gateway/internal/opt（按 `wslc` 能力）。

**系统 Tab**

- `wslc system info` 摘要；`system session list`；终止会话（会停止所有容器，强确认）。
- `settings.yaml`：表单 + 原始 YAML；字段：`session.cpuCount` / `memorySize` / `maxStorageSize` / `storagePath` / `defaultBindingAddress` / `hostLoopback` / `idleTimeout` / `credentialStore`；未知键保留；保存前 YAML 解析 + schema 校验 + 备份 + 原子写；“重置为默认”调用 `wslc settings reset`（确认）。
- 存储：显示 `storage.vhdx` 路径/大小；提供“打开目录”和“清理未使用镜像/容器”（prune）。

### 6.4 容器生命周期（任务化）

| 操作 | 命令                                     | 任务类型            | 锁                      | 说明                                    |
| ---- | ---------------------------------------- | ------------------- | ----------------------- | --------------------------------------- |
| 运行 | `wslc run -d …`                          | `container-run`     | `wslc:container:<name>` | 可先 pull；失败回滚？容器名冲突直接拒绝 |
| 启动 | `wslc start <id>`                        | `container-start`   | 同上                    | 幂等                                    |
| 停止 | `wslc stop [-t N] <id>`                  | `container-stop`    | 同上                    | 默认 10s，可配                          |
| 重启 | `wslc container restart <id>`            | `container-restart` | 同上                    | 能力不足则 stop→start                   |
| 删除 | `wslc container remove [-f] <id>`        | `container-remove`  | 同上                    | 运行中需确认强制                        |
| 清理 | `wslc container prune`                   | `container-prune`   | `wslc:session`          | 只删已停止；确认                        |
| 日志 | `wslc container logs -f --tail 500 <id>` | `container-logs`    | 无（只读）              | 可取消                                  |
| 统计 | `wslc stats --format json`               | 事件/轮询           | 无                      | 1s                                      |
| 复制 | `wslc container cp <src> <dst>`          | `container-copy`    | 同上                    | 路径校验；tar 归档                      |

运行向导字段：

- 镜像（必填，可“拉取后运行”）
- 容器名（可空，空则自动生成）
- 命令/参数（可选；默认镜像 CMD）
- 端口映射（host:container，可多条）
- 挂载（Windows 主机路径 → 容器路径；默认只读？可编辑）
- 环境变量（key/value；值默认遮挡）
- 网络（默认 bridge / 自定义网络）
- 资源：memory（WSL 大小语法，大写单位）、CPU（如支持）
- GPU：`--gpus all`（能力门禁）
- 健康检查：`--health-cmd` / interval / retries（能力门禁）
- 运行方式：后台 `-d` / 前台并打开终端 `-it`
- `--rm`、`--stop-timeout`
- 等价命令预览（结构化 argv 生成，绝不拼接 shell）

### 6.5 镜像与构建

- 拉取：`wslc pull <ref>`；解析进度行；无法估算时 `percent=null`；可取消。
- 构建：`wslc build -t <tag> <context>`；上下文必须是 Windows 绝对目录（展开 `%USERPROFILE%`）；流式日志；取消 kill 子进程；失败保留日志。
- 删除/清理：确认；`image prune` 可选 `--all`（能力门禁）。
- Inspect：OCI JSON，展示关键字段；原始 JSON 可折叠/复制；不解析成 Docker schema。
- 不在 0.2.0 做 registry 登录 UI；`wslc login` 引导 + `credentialStore` 说明。

### 6.6 事件与实时性

- `wslc events` 作为主进程长流；按 300ms 合并后推送 `containers:changed`。
- 事件字段容错解析（Docker 风格或 OCI 风格）；未知事件只触发刷新，不崩。
- 事件流断开：指数退避重连（1s/2s/5s/10s，最大 30s）；连续失败降级为 3s 轮询。
- `stats` 1s 一次；页面隐藏/窗口失焦降为 5s，恢复立即刷新。
- 日志流：按 8–16ms 合并；最多 5000 行；支持暂停/继续/下载。

### 6.7 与终端、网络、驾驶舱的联动

- **终端**：容器“打开终端”创建 `kind:'container'` 会话；终端会话侧栏显示容器分组。
- **网络**：容器发布端口在「网络」页有“容器端口”只读区；点击跳容器详情。端口冲突时给出提示（host port 已被占用）。
- **驾驶舱**：新增“容器”指标卡（运行中/总数）；快捷操作“运行容器”；最近容器列表（最多 3 条）。
- **命令面板**：`> 容器` 前缀；运行容器、打开容器终端、停止全部容器、清理。
- **托盘**：显示运行中容器数（可选）；菜单“容器”跳转。
- **状态栏**：容器任务并入现有任务 chip；`aria-live` 播报。

### 6.8 安全边界

- **结构化 spec**：渲染层只传字段，主进程用 `shared/containers/argv.ts` 生成 argv；不接受任意 `wslc` 参数或命令字符串。
- **镜像引用**：OCI 引用白名单正则（含 digest），长度 ≤255；禁止控制字符。
- **容器/网络/卷名**：DNS label 规则 `[A-Za-z0-9][A-Za-z0-9_.-]{0,62}`。
- **挂载**：主机路径必须是绝对 Windows 路径（盘符或 UNC），拒绝控制字符/`..`；容器路径必须是绝对 Linux 路径；默认不挂载 `C:\` 根；`-v` 只读选项可显式开启。
- **环境变量**：key 白名单；value ≤8KB；日志默认打码；inspect 中 env 默认遮挡，需“显示”确认。
- **端口**：1–65535；host 端口重复检测；<1024 警告。
- **资源**：memory 使用 WSL 大小语法（大写单位）；CPU 正整数；拒绝负数/超大值。
- **GPU**：只允许 `--gpus all`；不暴露 `--device`/`--privileged`/`--pid=host`。
- **settings.yaml**：YAML 解析失败拒绝写；未知键保留；备份轮转 3 份；原子写。
- **日志脱敏**：registry 凭据、`Authorization`、env 值、URL userinfo；与现有 `shared/diagnostics` 规则共用。
- **终端 OSC 52**：默认只允许写；读剪贴板需确认；可在设置关闭。
- **外链**：WebLinks 自定义 handler → `app:openExternal`；协议白名单。

### 6.9 降级与错误

| 场景                   | 行为                                                    |
| ---------------------- | ------------------------------------------------------- |
| WSL 未安装             | 容器页显示“先安装 WSL”；不显示空表                      |
| WSL < 2.9.3 / 无 wslc  | 显示“需要 WSL 2.9.3+（当前 x）”；禁用容器操作；保留说明 |
| wslc 已安装但调用失败  | 如实报错 + 原始输出 + 建议；不误导重装                  |
| `--format json` 不支持 | 回退表格解析；功能可用但提示“旧版 wslc”                 |
| 事件流不可用           | 回退 3s 轮询；页面提示“实时事件不可用”                  |
| 容器名冲突             | 拒绝并建议改名；不覆盖                                  |
| 镜像拉取失败           | 保留错误日志；可重试；不创建半容器                      |
| 端口冲突               | 运行前检测（netsh/容器表）；给出占用方                  |
| 会话终止               | 强确认；说明会停止所有容器                              |

### 6.10 容器验收标准

- [ ] WSL 3.0.3 + wslc 3.0.3：拉取 `alpine` → 运行 → 列表 → 终端 → 日志 → 统计 → 停止 → 重启 → 删除 → prune 全链路。
- [ ] `nginx` 发布端口可从 Windows `localhost` 访问；网络页显示容器端口。
- [ ] `wslc build -t` 从 Containerfile 构建成功；日志/取消/失败路径正确。
- [ ] 网络/卷 create/connect/disconnect/remove/prune 正确。
- [ ] `settings.yaml` 表单/YAML 保存、备份、重置、未知键保留。
- [ ] `system session terminate` 强确认后停止所有容器；列表刷新。
- [ ] 事件流断开自动重连/回退轮询。
- [ ] WSL 2.7.x / 无 wslc：容器页降级，不崩、不空转。
- [ ] 任意容器操作不能注入 argv；契约测试覆盖拒绝用例。

---

## 7. 配置 2.0 与迁移

### 7.1 `settings.jsonc` v3

保留 `general` / `wsl` / `backup` / `advanced`，扩展 `terminal`，新增 `workbench` / `containers`：

```jsonc
{
  "$schemaVersion": 3,
  "general": {
    "autoRefreshOnStart": true,
    "pollIntervalMs": 5000,
    "locale": "system",
    "accent": "aurora",
    "closeBehavior": "minimizeToTray",
    "launchAtLogin": false,
    "reduceMotion": false,
  },
  "workbench": {
    "defaultRoute": "dashboard", // dashboard | terminal | last
    "autoCollapseSidebar": true, // 终端页自动收 56px 轨
    "tabPosition": "top", // top | left
    "density": "comfortable", // comfortable | compact
    "showStatusLine": true,
    "showPaneHeaders": "auto", // auto | always | never
    "sessionRailWidth": 240,
    "confirmClosePane": true,
  },
  "terminal": {
    "fontFamily": "Cascadia Mono, Consolas, monospace",
    "fontSize": 14,
    "lineHeight": 1.25,
    "letterSpacing": 0,
    "cursorStyle": "bar",
    "cursorBlink": true,
    "cursorInactiveStyle": "outline",
    "scrollback": 10000,
    "copyOnSelect": false,
    "rightClickBehavior": "contextMenu", // contextMenu | paste | selectWord
    "pasteWarning": "multiline", // always | multiline | never
    "theme": "light", // light | dark | follow-app | high-contrast
    "bell": "none", // none | visual | sound
    "webgl": "auto", // auto | on | off
    "smoothScroll": true,
    "minimumContrastRatio": 4.5,
    "shellIntegration": "off", // off | prompt | on（按发行版另存状态）
    "confirmCloseWithRunningProcess": true,
    "defaultProfileId": "",
  },
  "wsl": {
    "defaultShell": "",
    "autoShutdownAfterConfigChange": false,
  },
  "containers": {
    "pollIntervalMs": 3000,
    "statsIntervalMs": 1000,
    "confirmPrune": true,
    "confirmRemoveRunning": true,
    "defaultStopTimeoutSec": 10,
    "maskEnvValues": true,
    "lastImage": "ubuntu:latest",
  },
  "backup": {
    "defaultDir": "%USERPROFILE%\\WSL-Backups",
    "format": "tar",
    "keepRecent": 5,
    "autoBackupBeforeDestructive": true,
  },
  "advanced": {
    "showRawCommand": false,
    "confirmDestructive": true,
    "logLevel": "info",
    "hardwareAcceleration": true,
    "autoUpdate": true,
  },
}
```

**终端 Profile**（可放 `settings.terminal.profiles` 或独立 `terminal-profiles.jsonc`；建议放 settings 内，量小）：

```jsonc
{
  "profiles": [
    {
      "id": "ubuntu-dev",
      "label": "Ubuntu 开发",
      "launch": { "kind": "distro", "distro": "Ubuntu-24.04", "shell": "/bin/zsh", "cwd": "~/project" },
      "theme": "dark",
      "shellIntegration": true,
    },
  ],
}
```

### 7.2 `distros.jsonc` v3

新增字段：

- `terminalProfileId: string`（默认 `''`）
- `hidden: boolean`（隐藏 docker-desktop 等内部发行版；默认 false）
- `defaultShell: string`（覆盖全局默认；默认 `''`）

保留：`name/alias/tags/color/icon/note/startupCwd/pinned/quickActions`。

### 7.3 `containers.jsonc` v1（新增）

只存“用户意图”，不存实时状态：

```jsonc
{
  "$schemaVersion": 1,
  "recipes": [
    {
      "id": "nginx-web",
      "label": "Nginx Web",
      "image": "nginx:latest",
      "name": "web",
      "ports": [{ "host": 8080, "container": 80, "address": "127.0.0.1" }],
      "volumes": [{ "host": "D:\\www", "container": "/usr/share/nginx/html", "readOnly": true }],
      "env": {},
      "network": "bridge",
      "detach": true,
      "rm": true,
      "stopTimeoutSec": 10,
      "health": { "cmd": "", "interval": "", "retries": 0 },
    },
  ],
  "recentImages": ["ubuntu:latest", "nginx:latest"],
}
```

### 7.4 `ui-state.jsonc` v2

```jsonc
{
  "$schemaVersion": 2,
  "window": { "width": 1440, "height": 900, "x": 120, "y": 80, "maximized": false },
  "sidebarCollapsed": false,
  "recentCommands": [],
  "workbench": {
    "activeTabId": "t1",
    "sessionRailOpen": false,
    "tabs": [
      {
        "id": "t1",
        "title": "Ubuntu",
        "profileId": "ubuntu-dev",
        "layout": {
          "kind": "split",
          "dir": "row",
          "ratio": 0.5,
          "a": { "kind": "leaf", "sessionId": "…" },
          "b": { "kind": "leaf", "sessionId": "…" },
        },
      },
    ],
  },
}
```

### 7.5 迁移策略

- 版本：`settings` v2→v3、`distros` v2→v3、`ui-state` v1→v2、新增 `containers` v1。
- 迁移前备份到 `backups/v0.1.4/`；迁移失败保留原文件并提示，不覆盖。
- `settings`：
  - `terminal.theme: 'auto'` → `'light'`；`'custom'` → `'high-contrast'`；`'follow-app'` 保留。
  - `terminal.lineHeight` 默认 1.2 → 1.25；`scrollback` 5000 → 10000；`cursorStyle` 默认 block → bar（可保留用户值）。
  - 新增 `workbench` / `containers` 默认段；`terminal` 新字段用默认值。
- `distros`：新增字段默认值；未知字段保留。
- `ui-state`：旧 `terminalLayout` **不迁移**（PTY 会话不会跨应用重启存活，迁移无意义）；保留 `window/sidebarCollapsed/recentCommands`；新 `workbench` 为空。
- `containers`：首次启动生成空 `recipes: []`。
- 迁移说明写入 README/CHANGELOG：0.2.0 的终端布局会重置一次。

---

## 8. 设计系统 2.0

### 8.1 布局、密度与令牌

新增语义令牌（`packages/shared/src/tokens.ts` 唯一事实源）：

```css
/* 工作台 */
--workbench-topbar-h: 34px;
--workbench-status-h: 20px;
--rail-w: 56px;
--rail-w-expanded: 232px;
--session-rail-w: 240px;
--pane-gap: 1px;
--pane-padding: 4px;

/* 终端 */
--color-term-bg: #fbfcfe;
--color-term-fg: #1e293b;
--color-term-cursor: #6366f1;
--color-term-selection: rgba(99, 102, 241, 0.25);
--color-term-black: #0f172a;
--color-term-red: #dc2626;
/* ...16 色 ... */

/* 工作台表面 */
--color-workbench-bg: #f7f8fb;
--color-pane-border: #e2e5ec;
--color-pane-active: #6366f1;
--color-rail-bg: #ffffff;
--color-rail-active: rgba(99, 102, 241, 0.12);
```

- 终端配色独立于 Naive 主题；`terminal.theme=dark` 只切换终端变量，不切应用。
- `density=compact`：顶栏 30px、标签 26px、状态行 18px、字号 13；`comfortable` 用默认。
- 动效：工作台切换 ≤140ms；面板焦点 ≤80ms；终端内容零过渡；`reduceMotion` 全部即时。

### 8.2 终端配色

| 主题          | 背景                     | 前景      | 光标      | 选区          | 适用             |
| ------------- | ------------------------ | --------- | --------- | ------------- | ---------------- |
| light         | `#FBFCFE`                | `#1E293B` | accent    | accent 25%    | 默认，与应用一致 |
| dark          | `#0B1220`                | `#E2E8F0` | `#22D3EE` | `#6366F1` 35% | 开发者偏好       |
| follow-app    | light + accent 光标/选区 |           |           |               | 强调色联动       |
| high-contrast | `#FFFFFF`                | `#0B1220` | `#0B1220` | 28%           | 无障碍           |

深色主题只作用于 xterm 与终端容器，不影响侧栏/内容页；避免“应用一半黑一半白”。

### 8.3 组件清单

**新增 `packages/ui` 工作台原语**：

- `WorkbenchShell`（顶栏/侧轨/状态行插槽）
- `WorkbenchTab` / `WorkbenchTabStrip`
- `PaneHeader`
- `StatusLine`
- `IconButton`（统一 tooltip/aria）
- `DataToolbar`（容器页筛选/刷新/动作）
- `StatBadge`（健康/状态）
- `KeyValueList`（详情）
- `EmptyActionGrid`（启动中心）

**不引入新组件库**；继续 Naive UI + 自研业务组件。

---

## 9. 安全与隐私

| 层       | 0.2.0 措施                                                                                |
| -------- | ----------------------------------------------------------------------------------------- |
| 渲染进程 | `contextIsolation` + `sandbox` + 零 Node；不允许 `window.open`                            |
| IPC      | 契约单一事实源；zod 严格校验；每个通道正反用例；事件 payload 校验                         |
| 命令执行 | 参数数组；`wslc` 结构化 spec；无 shell 拼接；二进制固定 `wslc.exe`                        |
| 容器     | 镜像/名称/路径/端口/资源白名单；禁止 `--privileged`/`--device`/host 网络；GPU 仅 `all`    |
| 配置     | YAML 解析 + schema + 备份 + 原子写；未知键保留；迁移备份                                  |
| 日志     | env/凭据/Authorization/URL userinfo 脱敏；诊断包复用同一规则                              |
| 终端     | OSC 52 写默认允许、读需确认；WebLinks 走 `app:openExternal`；Shell 集成脚本固定模板、可逆 |
| 提权     | 主进程不提权；提权白名单不变；`wslc` 不提权                                               |
| 外链     | `http/https` 白名单；控制字符拒绝                                                         |
| 更新     | 签名校验保持；0.2.0 发布前配置 `publisherName`（0.1.4 遗留）                              |

---

## 10. 测试与质量门禁

### 10.1 单元 / 契约

新增重点：

- `shared/containers/argv.test.ts`：所有 spec → argv；非法字段拒绝；不产生 shell 拼接。
- `shared/containers/parsers.test.ts`：NDJSON、OCI inspect、表格回退、畸形输入、超大行。
- `shared/contracts.test.ts`：每个 contract 有 handler/preload/schema；事件通道对称。
- `shared/terminal/layout.test.ts`：新布局树、几何、恢复、脏数据剪枝。
- `main/services/wslc/*.test.ts`：能力探测、列表/统计/日志/事件、错误映射、取消、锁。
- `main/services/terminal-session.test.ts`：流控 ACK、批处理、pause/resume、恢复、上限。
- `shared/config-migrations.test.ts`：v2→v3 全字段、损坏文件、未来版本。
- `renderer/stores/containers.test.ts`：事件合并、轮询回退、删除/撤销、错误态。

覆盖率：

- 总门禁 ≥85% 保持。
- 新 per-glob 地板（建议）：
  - `packages/shared/src/containers/**`：lines/statements 90，branches 85，functions 90。
  - `packages/shared/src/terminal/**`：90/90/85/90。
  - `apps/desktop/src/main/services/wslc/**`：88/88/82/88。
  - `apps/desktop/src/renderer/stores/containers.ts`：85/85/80/80。
  - `apps/desktop/src/renderer/features/terminal/**`：90/90/85/90。
- 组件地板：保持 ui 96/96/88/90；renderer 提升到 90/90/85/70（新测试补齐后校准）。

### 10.2 组件测试

- `WorkbenchLayout`：全出血、导航轨、顶栏、状态行、专注模式。
- `TerminalTabStrip`：新建/关闭/重命名/拖拽/溢出/键盘。
- `TerminalSessionRail`：分组、折叠、拖拽宽度、空态。
- `TerminalSearchOverlay`：N/M、大小写/正则、Esc。
- `ContainersView`：列表/筛选/空态/错误态/降级态。
- `RunContainerModal`：端口/挂载/环境变量校验、等价命令、提交锁。
- `ContainerDetailDrawer`：日志/统计/inspect/操作确认。
- `WslcSettingsPanel`：YAML/表单同步、校验、保存失败保留。
- `SettingsView`：终端/工作台/容器设置落盘。

### 10.3 E2E / 视觉

新增 E2E：

1. **终端几何**：1920×1080 与 1180×760 启动，读取 `.terminal-pane` boundingBox，断言占窗口面积 ≥90%/85%；无水平滚动。
2. **终端保活/分屏**：切路由、分屏、关闭、拖拽，scrollback 不变。
3. **专注模式**：进入/退出，布局恢复。
4. **命令块**：mock OSC 133 序列，断言块边界/exit code/复制输出。
5. **容器降级**：无 wslc 时显示更新提示；不崩。
6. **容器链路**（有 wslc 的 Windows runner 或 fake executable）：列表 → 运行 → 终端 → 停止 → 删除。
7. **设置持久化**：终端主题/密度/侧栏状态重启保留。

视觉基线：

- 新增 `terminal-light-1440.png`、`terminal-dark-1440.png`、`containers-empty.png`、`workbench-focus.png`。
- 重建 dashboard/settings/network/palette 基线（布局/顶栏变化）。
- 截图尺寸至少覆盖 1024×720 与 1440×900；动态区域 mask 规则更新。

### 10.4 真机矩阵

| 环境                         | 验证                                          |
| ---------------------------- | --------------------------------------------- |
| WSL 3.0.3 + wslc 3.0.3       | 全功能：容器/镜像/构建/网络/卷/系统/设置/终端 |
| WSL 2.9.3                    | 容器最小能力；JSON/健康/事件缺失时的降级      |
| WSL 2.7.x                    | 无 wslc；容器页禁用；终端/发行版正常          |
| WSL1                         | 容器禁用；终端/备份正常                       |
| Windows 10 22H2 / Windows 11 | 窗口/拖拽/字体/IME/托盘                       |
| 无 GPU                       | WebGL 回退 DOM；终端可用                      |

### 10.5 性能与安全门禁

- 终端大输出/输入延迟基准写入 `docs/testing.md`；回归 >20% 阻断。
- `smoke:product` 校验新 preload API 面。
- `verify:release` 保持；发布前配置签名/`publisherName`。
- 安全用例：容器 argv 注入、路径逃逸、镜像引用注入、环境变量日志泄露、OSC 52 读确认。

---

## 11. 工作包与里程碑

> 估算按 1 名熟悉代码库的工程师计；可与设计/测试并行。

### WP0 基线与 Spike（2–3 天）

- 测当前终端几何（截图 + boundingBox + CSS 计算），形成基线报告。
- Electron 45 + node-pty + electron-vite 6 + Vite 8 + TS 6 + vue-tsc Spike。
- 真机 `wslc --help` / `wslc container --help` / `wslc system --help` / `wslc stats --format json` / `wslc events` 采样，固化 fixtures。
- 决策记录：ESM main、Zod 4 策略、TS 6 回退点。

**验收**：Spike 分支能启动、能开终端、能打包；fixtures 入库。

### WP1 工具链与架构底座（7–9 天）

- Electron 45 / electron-vite 6 / Vite 8 / ESM main / CJS preload。
- Vue Router 5 / Pinia 4 / Zod 4 / TS 6 / Vitest 5 / Playwright 1.64 / ESLint 10 / Stylelint 17。
- IPC contracts 2.0；OperationRunner；配置 v3 骨架；删除旧通道表。
- 现有测试全绿（允许改测试，不允许删覆盖）。

**验收**：`typecheck/lint/format/test/test:component/build/smoke` 全绿；app 启动/终端/设置冒烟通过。

### WP2 终端 2.0（9–12 天）

- `WorkbenchLayout` / `TerminalWorkbench` / 顶栏 / 标签 / 会话侧栏 / 面板 / 状态行 / 搜索覆盖层 / 命令栏 / 启动中心。
- xterm addons（clipboard/serialize/ligatures 可选）；主题；流控 ACK；输出批处理；专注模式。
- Shell 集成（bash/zsh）：安装/状态/移除/启动接线；命令块 UI。
- 容器终端 spec（与服务层联调可后置）。
- 几何 E2E + 视觉基线。

**验收**：终端 90%/85% 目标；分屏/保活/搜索/命令块/深色/专注模式全部可用。

### WP3 WSL 3 容器工作台（10–14 天）

- `WslcCapabilities` / `WslcService` / 解析器 / 事件流 / 统计。
- 容器表/详情/运行向导/日志/终端/操作/清理。
- 镜像列表/拉取/构建/删除/prune。
- 网络/卷/系统/`settings.yaml`。
- 驾驶舱/网络/命令面板/托盘联动。
- 降级与错误映射；安全校验。
- 容器 E2E/组件/单测。

**验收**：真机全链路；旧 WSL 降级；安全用例通过。

### WP4 WSL 3 平台配置（3–5 天）

- `.wslconfig` 新字段：virtiofs/virtio/hostFileSystemAccess/systemDistro/kernelModules/...。
- `NetworkMode` 增加 `none`/`consomme`；`virtioproxy` 归一为 `consomme`；文案/引导更新。
- 依赖校验（virtiofs 三件套、systemDistro 路径、isolateDistroCgroup）。
- WSL 3 体检卡：内核、容器会话、virtiofs、consomme、wslc 版本。
- 安装/更新后的能力失效与刷新。

**验收**：3.0.3 真机保存/生效；旧版不阻塞；依赖提示准确。

### WP5 迁移、文档与发布（5–7 天）

- 配置迁移 v3；旧数据备份；失败提示。
- 文档：README、设计书、architecture、config-reference、testing、CHANGELOG、CONTRIBUTING。
- 视觉基线重建；全量门禁；真机证据。
- 打包/签名/`publisherName`；`verify:release`。

**验收**：0.2.0 安装包可启动；文档与实现一致；发布检查表完成。

### 里程碑

| 里程碑          | 内容                                   | 出口               |
| --------------- | -------------------------------------- | ------------------ |
| `0.2.0-alpha.1` | 工具链升级 + Workbench 壳 + 终端全出血 | 启动/终端/测试全绿 |
| `0.2.0-alpha.2` | 终端 2.0 完整（命令块/侧栏/专注）      | 几何/保活/视觉通过 |
| `0.2.0-beta.1`  | 容器只读（列表/详情/统计/日志）        | 真机只读链路       |
| `0.2.0-beta.2`  | 容器生命周期 + 镜像/网络/卷/系统       | 真机全链路         |
| `0.2.0-rc.1`    | 配置 v3/迁移/文档/门禁                 | 全量门禁 + 真机    |
| `0.2.0`         | 发布                                   | 签名/校验/安装包   |

---

## 12. 风险与对策

| 风险                              | 影响           | 概率  | 对策                                                               |
| --------------------------------- | -------------- | ----- | ------------------------------------------------------------------ |
| Electron 45 + node-pty ABI 不兼容 | 终端不可用     | 中    | Spike 先验；保留 Electron 39/40 回退点；必要时 electron-rebuild    |
| Vite 8 / Rolldown 插件不兼容      | 构建失败       | 中    | Spike；按 electron-vite 6 官方模板；保留 Vite 7 回退               |
| main ESM 与 preload 沙箱冲突      | 启动失败       | 中    | main ESM + preload CJS 双输出；启动冒烟；路径/`__dirname` 全量替换 |
| Zod 4 默认值语义变化              | 配置静默变默认 | 高    | 逐 schema 迁移；空对象/缺字段/非法字段三组测试；code review        |
| TS 6 / vue-tsc 不兼容             | 类型检查失败   | 中    | Spike；回退 TS 5.9.3；TS 7 另开分支                                |
| wslc JSON/事件格式漂移            | 容器页解析失败 | 高    | JSON 优先 + 表格回退；容错解析；fixtures；能力探测；版本门禁       |
| wslc 在旧 WSL 不存在              | 页面空白/报错  | 高    | fail-soft；明确“更新 WSL”；隐藏入口                                |
| 容器功能范围膨胀                  | 延期           | 高    | 明确非目标；0.2.0 不做 Compose/Registry UI                         |
| 终端全出血影响可读性/无障碍       | 体验下降       | 中    | 专注模式可退；密度设置；最小尺寸；对比度检查                       |
| 输出流控实现复杂                  | 丢数据/卡死    | 中    | ACK + pause/resume；超时降级；大输出测试；保留无流控回退开关       |
| Shell 集成污染用户 rc             | 用户不满       | 中    | 只写 `~/.wslpilot/`；显式安装；可逆；不自动修改 rc                 |
| 视觉基线全量变化                  | CI 红          | 高    | 预期重建；双平台基线；mask 规则更新；截图尺寸矩阵                  |
| 迁移丢数据                        | 用户数据损坏   | 低/高 | 迁移前备份；失败不覆盖；迁移测试；发布说明                         |
| 签名/publisherName 遗留           | 更新校验不生效 | 中    | 0.2.0 发布前配置证书与 `publisherName`；`verify:release` 硬门禁    |

---

## 13. 文件级变更地图

### 删除 / 替换

| 文件                                             | 处理                                                |
| ------------------------------------------------ | --------------------------------------------------- |
| `renderer/views/TerminalView.vue`                | 替换为 `features/terminal/TerminalWorkbench.vue`    |
| `renderer/features/terminal/TerminalTabs.vue`    | 替换为 `TerminalTabStrip.vue`                       |
| `renderer/features/terminal/TerminalToolbar.vue` | 替换为 `TerminalCommandBar.vue` + 覆盖层            |
| `renderer/features/terminal/XtermPane.vue`       | 重命名/重构为 `TerminalPane.vue`                    |
| `renderer/features/terminal/panes.ts`            | 演进为 `shared/terminal/layout.ts` + 几何测试       |
| `main/services/pty-manager.ts`                   | 演进为 `terminal-session.ts`                        |
| `main/services/task-runner.ts`                   | 演进为 `operations/runner.ts`（保留兼容壳一个版本） |
| `packages/shared/src/channels.ts`                | 由 contracts 派生；旧 `CH` 删除                     |
| `packages/shared/src/ipc-schema.ts`              | 拆入 `contracts/*`；旧文件删除                      |
| `.eslintrc.cjs`                                  | 替换为 `eslint.config.mjs`                          |

### 新增（核心）

- `packages/shared/src/contracts/*`
- `packages/shared/src/terminal/*`
- `packages/shared/src/containers/*`
- `packages/shared/src/wslc.ts`
- `packages/kit/src/spawn-tool.ts` / `ndjson.ts`
- `main/services/terminal-session.ts`
- `main/services/wslc/*`
- `main/services/operations/*`
- `main/ipc/contracts.ts`
- `renderer/layouts/WorkbenchLayout.vue`
- `renderer/features/terminal/*`（见 5.3）
- `renderer/features/containers/*`（见 3.6）
- `renderer/stores/workbench.ts` / `containers.ts` / `wslc-env.ts`
- `tests/e2e/terminal-geometry.e2e.ts` / `containers.e2e.ts`
- `tests/component/workbench-*.test.ts` / `containers-*.test.ts`
- `docs/plan-0.2.0.md`（本文）

### 修改（核心）

- `apps/desktop/package.json`：`type: module`、新依赖、脚本。
- `apps/desktop/electron.vite.config.ts`：main ESM、preload CJS、Vite 8。
- `apps/desktop/electron-builder.yml`：Electron 45、asarUnpack、产物。
- `apps/desktop/src/main/index.ts`：ESM、服务装配、Workbench/Containers。
- `apps/desktop/src/main/window/main-window.ts`：默认尺寸 1440×900、多窗口预留。
- `apps/desktop/src/preload/index.ts`：contracts 生成、CJS。
- `apps/desktop/src/renderer/App.vue`：按路由选择 `WorkbenchLayout` / `DefaultLayout`。
- `apps/desktop/src/renderer/router/index.ts`：`/containers` 路由、`meta.layout`。
- `apps/desktop/src/renderer/layouts/SidebarNav.vue`：rail 变体、容器入口。
- `apps/desktop/src/renderer/stores/terminal.ts`：拆分。
- `apps/desktop/src/renderer/views/SettingsView.vue`：终端/工作台/容器分区。
- `apps/desktop/src/renderer/composables/useTaskProgress.ts`：新增容器任务类型文案（`satisfies Record<TaskType,…>` 会在漏配时编译失败）。
- `apps/desktop/src/renderer/features/wsl/WslEnvironmentCard.vue`：能力清单扩展（wslc / virtiofs / consomme）、WSL 3 体检。
- `apps/desktop/src/renderer/composables/useHotkeys.ts`：新快捷键（专注模式/会话侧栏/面板最大化/命令栏）。
- `apps/desktop/src/renderer/features/command/CommandPalette.vue`：容器命令组、终端命令组。
- `packages/shared/src/tokens.ts`：2.0 令牌。
- `scripts/gen-tokens.ts`：新令牌生成。
- `vitest.config.ts` / `vitest.component.config.ts`：新分母/地板。
- `playwright.config.ts` / `visual.e2e.ts`：新基线/尺寸。
- `docs/*`、`README.md`、`CHANGELOG.md`、`WSLPilot-设计书.md`。

---

## 14. 完成定义（Definition of Done）

1. 0.2.0 计划内每个 WP 都有代码、测试、文档三件套。
2. 终端 90%/85% 几何指标由 E2E 真实断言，不是截图目测。
3. WSL 3 容器全链路在真机通过；旧 WSL 降级有测试/证据。
4. IPC contracts 覆盖全部通道；新增通道漏注册/漏校验直接红。
5. 配置 v3 迁移有正反用例；迁移前备份；失败不覆盖。
6. `npm run typecheck`、`lint`、`format:check`、`test`、`test:component`、`test:e2e`、`tokens:check`、`smoke:product` 全绿。
7. 视觉基线双平台重建并通过；无 `forbidOnly` / 假绿。
8. 安全用例（注入/路径/镜像/环境变量/OSC 52）通过。
9. 文档与实现一致：README、设计书、architecture、config-reference、testing、CHANGELOG。
10. 安装包可启动；签名/`publisherName` 配置完成（若发布签名版）。
11. 真机证据写入 `docs/aegis/work/<date>-wslpilot-0.2.0/evidence.md`。

---

## 15. 开放决策 / 假设

| 决策            | 当前建议                                     | 备选                                 |
| --------------- | -------------------------------------------- | ------------------------------------ |
| 终端默认布局    | 终端页自动收 56px 导航轨，全出血             | 保留 232px 侧栏，用户手动收          |
| 默认窗口        | 1440×900（最小 960×600）                     | 保持 1180×760                        |
| 终端深色        | 只允许终端深色，应用保持浅色                 | 全应用深色（违背现产品策略）         |
| 容器范围        | 只做 wslc 原生容器；不做 Compose/Registry UI | 加 Docker 兼容（不建议）             |
| 容器页入口      | 一级侧栏「容器」                             | 并入「工作负载」/「网络」            |
| TypeScript      | 6.0.3                                        | 5.9.3（保守）/ 7.0.2（工具链未就绪） |
| main 模块格式   | ESM                                          | CJS + 动态 import chokidar           |
| 终端布局迁移    | 不迁移旧 `terminalLayout`（会话不跨重启）    | 迁移 tab 标题/比例（价值低）         |
| 默认 Shell 集成 | 关闭，显式安装                               | 自动安装（不建议）                   |
| 终端默认主题    | light                                        | dark                                 |
| Quake 模式      | P1，可延后                                   | 0.2.0 必做                           |

---

## 附录 A：WSL 3 / wslc 资料（2026-11）

- Microsoft Learn — WSL container：<https://learn.microsoft.com/en-us/windows/wsl/wsl-container>
  - `wslc.exe` 随 WSL 提供；要求 WSL 2.9.3+；`wslc version` / `wslc run` / `image list` / `container list` / `stats` / `exec` / `logs` / `container prune` / `image prune`。
- Microsoft Learn — WSL container settings：<https://learn.microsoft.com/en-us/windows/wsl/wsl-container-settings>
  - `%LOCALAPPDATA%\wslc\settings.yaml`；`session.cpuCount` / `memorySize` / `maxStorageSize` / `storagePath` / `defaultBindingAddress` / `hostLoopback` / `idleTimeout` / `credentialStore`；`wslc settings` / `settings reset`；`session.storagePath` 变更不会迁移旧数据。
- Microsoft Learn — Advanced settings：<https://learn.microsoft.com/en-us/windows/wsl/wsl-config>
  - `networkingMode`: `none|nat|bridged|mirrored|consomme`；`virtiofs`（依赖 `virtio` + `hostFileSystemAccess`）；`systemDistro`；`kernelModules`；`loadDefaultKernelModules` / `loadKernelModules`；`kernelDebugPort`；`telemetry`；`debugConsoleLogFile`；`kernelBootTimeout`；`distributionStartTimeout`；`mountDeviceTimeout`；`crashDumpFolder`；`isolateDistroCgroup`。
- Windows Developer Blog — WSL containers GA（2026-09-29）：<https://blogs.windows.com/windowsdeveloper/2026/09/29/wsl-containers-now-generally-available/>
  - 新增 `container restart` / `container cp` / `system info` / `network connect|disconnect` / `events` / 健康检查 / `--stop-timeout` / `--mount` / 可配置存储路径。
- WSL 3.0 概览（第三方汇总，用于背景）：Linux 内核 6.18；virtiofs 默认用于容器；consomme 网络；wslc / wslcsession。

> 注：`wslc` 的 JSON 输出/事件字段以实际版本为准；实现必须“能力探测 + 容错解析 + 版本门禁”，不得把第三方文章当契约。

## 附录 B：终端像素预算计算

### B.1 0.1.4（1920×1080）

```text
window           1920 × 1080
titlebar         40
statusbar        28
sidebar          232
content          1688 × 1012
terminal max-w   1400  → 左右各 144
terminal padding 20 + 20
pane width       1400 − 40 = 1360
vertical chrome  16 + 12 + 10×4 + 54.7（header）+ 42（tabs）+ 28（toolbar）+ 26.6（status）≈ 219
pane height      1012 − 219 = 793
pane area        1360 × 793 = 1,078,480
content area     1688 × 1012 = 1,708,256
ratio            63.1%
window ratio     52.0%
```

### B.2 0.2.0（1920×1080，rail 56，单面板无 header）

```text
window           1920 × 1080
workbench bar    34
status line      20
rail             56
pane area        1864 × 1026
pane area px     1,912,464
window px        2,073,600
ratio            92.2%
```

### B.3 0.2.0（1180×760，rail 56）

```text
window           1180 × 760
workbench bar    34
status line      20
rail             56
pane area        1124 × 706 = 793,544
window px        896,800
ratio            88.5%
```

> 以上未计入 1px 分屏间隙、窗口边框和 DPI 缩放；E2E 以实际 `boundingBox` 为准。

---

## 附录 C：新增 IPC 通道草案

> 最终以 `shared/contracts/*` 为准；以下用于评审范围。

**Terminal**

- `terminal:create` / `terminal:input` / `terminal:resize` / `terminal:kill` / `terminal:list` / `terminal:ack` / `terminal:host`
- 事件：`terminal:data` / `terminal:exit` / `terminal:flow`

**Shell Integration**

- `shell:status` / `shell:install` / `shell:remove`

**Containers**

- `containers:list` / `containers:inspect` / `containers:run` / `containers:start` / `containers:stop` / `containers:restart` / `containers:remove` / `containers:prune` / `containers:logs` / `containers:stats` / `containers:copy`
- 事件：`containers:changed` / `containers:log` / `containers:stats`

**Images**

- `images:list` / `images:pull` / `images:inspect` / `images:remove` / `images:prune` / `images:build`

**Networks / Volumes**

- `networks:list` / `networks:create` / `networks:remove` / `networks:connect` / `networks:disconnect` / `networks:prune`
- `volumes:list` / `volumes:create` / `volumes:remove` / `volumes:prune`

**WSLc System**

- `wslc:status` / `wslc:systemInfo` / `wslc:sessionList` / `wslc:sessionTerminate`
- `wslc:settingsRead` / `wslc:settingsWrite` / `wslc:settingsReset`

**Window**

- `window:openTerminal`（P2 预留）

---

## 附录 D：0.2.0 实施第一周清单

1. 建立 `docs/aegis/work/<date>-wslpilot-0.2.0/`，记录基线、Spike、真机命令输出。
2. 在独立分支完成 Electron 45 + node-pty + electron-vite 6 + Vite 8 最小启动。
3. 完成 ESM main / CJS preload 改造，`npm run dev` + 打包冒烟通过。
4. 用 Playwright 测当前终端 boundingBox，保存 `before.json` 作为对照。
5. 抓取真机 `wslc` 输出 fixtures：`version`、`container list --format json`、`image list --format json`、`stats --format json`、`system info`、`events` 10 行、`--help`。
6. 写 `shared/containers/parsers` 与 `shared/contracts` 骨架，先让测试红→绿。
7. 确定 Zod 4 迁移清单（逐文件），先改 `shared/config-schema.ts` 与 `ipc-schema`。
8. 与设计确认 Workbench 线框与 34/20/56/240 四个关键尺寸。

---

> **一句话总结**：0.1.4 把“能做的事”做全了；0.2.0 要把“做事的地方”做成真正的驾驶舱——终端占满该占的空间，WSL 3 的容器能力真正可用，底座换到能支撑下一个大版本的位置。
