# 测试策略

> 设计书 §16 · 本项目测试分五层，CI 全覆盖。

## 测试金字塔

```
        ┌──────────┐
        │   E2E    │  Playwright + Electron（Windows）
        ├──────────┤
        │ 视觉回归  │  Playwright 截图对比
        ├──────────┤
        │  组件    │  Vitest + @vue/test-utils + happy-dom
        ├──────────┤
        │ IPC 契约 │  Vitest + zod 通过/拒绝用例
        ├──────────┤
        │   单元   │  Vitest（纯函数）
        └──────────┘
```

## 分层说明

### 1. 单元测试（`npm test`）

| 模块                | 覆盖点                                                                          |
| ------------------- | ------------------------------------------------------------------------------- |
| `exec-wsl`          | `parseDistroList`（含中文、`*` 默认标记、多空格）                               |
| `tool-output`       | Windows 工具输出编码探测（UTF-16LE / UTF-8 / GBK）                              |
| `run-tool`          | netsh / usbipd 执行封装（参数数组、失败不抛）                                   |
| `network`           | netsh 参数与等价命令、portproxy 解析、`.wslconfig` 镜像模式、代理脚本、表单校验 |
| `usbipd`            | `usbipd list` 解析、BUSID 白名单、bind/attach 命令构建                          |
| `jsonc`             | 解析容错、错误行号、最小编辑保留注释                                            |
| `atomic-write`      | 原子替换、崩溃不留半截文件                                                      |
| `config-schema`     | zod 校验、默认值填充、部分数据合并                                              |
| `config-migrations` | v1→v2 迁移链                                                                    |
| `errors`            | 错误码目录、结构化序列化                                                        |

### 2. IPC 契约测试

带参通道的入参 zod schema 均有「通过」与「拒绝」用例（`ipc-schema.test.ts`，含 wslconf / fs /
action / setVersion 的字符+字节双上限用例）；无参（void）通道豁免。此外：

- `channels.test.ts`：通道清单互斥全覆盖、带参必登记 schema、**预留通道清单受控**
  （M6 交付网络与设备通道后当前无预留项；新增预留必须显式登记）
- `preload-contract.test.ts`：逐方法断言 invoke 通道名 + 参数形状可过 `IPC_SCHEMAS` 校验
  （preload 桥与 schema 零漂移）
- `ipc-router.test.ts`：handler 注册、错误序列化、参数校验拦截

```ts
// 例：config:set 入参
expect(() => ipcSchema.configSet.parse({ fileKey: 'settings', patch: {} })).not.toThrow()
expect(() => ipcSchema.configSet.parse({ fileKey: 'evil', patch: {} })).toThrow()
```

### 3. 组件测试（`npm run test:component`）

环境：`happy-dom` + `@vue/test-utils`

覆盖：StatusDot、Sparkline、MetricCard、DistroCard（启停事件、状态中文、默认禁用菜单）；
M7 补齐 Skeleton（骨架屏 / rows 形态 / aria-busy）、EmptyState（插画 + CTA 槽语义）、
vRipple（涟漪生成 / reduced-motion 降级 / 卸载清理）。

**覆盖分母（review 覆盖率分母瘦身已根治）**：此前 `vitest.component.config.ts` 的
`coverage.include` 只含 `packages/ui/src/components/**`，renderer 全部 `.vue`
（约 6800 行 UI 逻辑：SettingsView 906、BackupView 770、DistroDetailModal 660、
CommandPalette 587、WslConfPanel 496、ActionsPanel 456 等）**不进任何覆盖分母** ——
70% 数字不含 UI 层，属分母瘦身。现已纳入：

- `packages/ui/src/components/**/*.{vue,ts}`（设计系统组件）
- `packages/ui/src/composables/**`、`directives/**`、`naive/**` 与 `packages/ui/src/index.ts`
  （vRipple / useReducedMotion / applyAccentToDom / theme-overrides —— review 0.1.2 补录分母，
  此前有测试但不计分，回归门禁对它们曾是无覆盖盲区）
- `apps/desktop/src/renderer/**/*.vue`（全部 UI 视图/面板/布局壳）
- `apps/desktop/src/renderer/router/**/*.ts`（路由表 + afterEach 标题，无其他分母）

renderer 的 `.ts`（stores / composables / features 纯逻辑）**不进组件分母**：它们由
单测门禁（`vitest.config.ts` ≥85%）真实覆盖，重复计入违反「每个源文件恰好在一个门禁
分母里」。`main.ts`（createApp 装配入口）与 `**/*.d.ts` 有理由豁免。

组件测试按「挂载渲染 + 关键交互走通（按钮触发对应 wslAPI 调用 / 状态变化）+ 错误态
展示断言」三件套组织；断言观测真实行为（wslAPI mock 调用参数、DOM 状态），禁止恒真。

### 4. 视觉回归（M7 已落地）

Playwright 截图对比（`npm run test:visual`，`@visual` 标签）：驾驶舱 / 设置 / 网络 / 命令面板
关键页面浅色主题渲染一致性。

- 动画禁用 + **动态源全量 mask**：时段问候语、hero 统计行（WSL 版本/发行版数量/内核）、
  指标数字与提示、迷你图、时钟、发行版卡片区、**系统转发表（仅数据行 tbody —— 表头与边框
  参与比对）**、**镜像卡（收窄为状态徽章 / 路径行 / 状态正文三个具体动态元素 —— 卡标题、
  边框、背景参与比对）**、Windows 代理状态、`.wslconfig` 真实路径、设置页版本号
  （每项都对应真实动态源，新增动态源必须登记）
- **掩码收窄的结构补偿断言**（review 0.1.2）：smoke 中断言 `.mirror-card` / `.system-card`
  容器真实可见 —— 被收窄区域的样式崩坏不再被掩码掩盖
- **截图期盒尺寸稳定化**（`tests/e2e/visual-stability.css`，仅 `stylePath` 注入、不改生产样式）：
  动态文本宽度铺满、指标值固定高度、卡片网格固定高度——消除「内容变化 → mask 边界漂移 /
  下方版式位移」造成的假红
- 基线位于 `apps/desktop/tests/e2e/__screenshots__/`，按平台分文件（`{arg}-{platform}.png`，linux/win32 各一套）随仓库入库
- `updateSnapshots: 'none'`——**缺基线直接红**，禁止 CI 自动造基线放行（review 假门禁根治）；
  新增/更新截图用例在目标平台跑 `npx playwright test --grep @visual --update-snapshots=all` 并提交生成的基线
- 比对容差 `maxDiffPixelRatio: 0.02`；需显示环境（CI `e2e` job 跑 win32 基线）

### 5. 端到端（`npm run test:e2e`）

Playwright + Electron（`electron.launch`，Windows）——一次实跑 **smoke + 视觉回归**（`*.e2e.ts` 全量，含 `@visual`）：

- smoke：启动、窗口显示、侧栏导航（驾驶舱 / 发行版 / 终端 / 备份迁移 / 设置 / 网络 / 设备）与命令面板关键元素可见性；
  0.1.2 补强：**命令面板执行导航**（搜索 → 执行 → 页面标题切换 + 面板收起）与
  **设置持久化闭环**（修改减弱动效 → 重启仍生效，落盘 → 读回 → 渲染全链路）
- **隔离**：每次启动使用临时 `userData`（`WSLPILOT_USER_DATA` 环境变量，主进程在单实例锁前应用），
  不读写真实用户配置/日志/备份，也不受本机强调色 / 侧栏折叠 / 语言影响（review E2E 隔离根治）
- **定位策略**：侧栏导航一律收敛到 `aside.sidebar` 内定位——页面内容可能出现同名按钮
  （发行版卡片的「终端」），全局 `getByRole` 在真实 WSL 环境下会 strict-mode 冲突
- visual：见上节视觉回归（截图比对，基线在 `__screenshots__/`）

## 运行

```bash
npm test               # 单元 + 集成
npm run test:coverage  # 单元 + 覆盖率（硬门禁 ≥85%）
npm run test:component # 组件 + 覆盖率（per-glob 两档硬门禁，见下）
npm run test:e2e       # E2E + 视觉回归（需 Windows）
npm run test:visual    # 仅视觉回归（@visual，首跑生成基线）
npm run test:watch     # 监听模式
```

## 覆盖率门禁（硬性）

### 单元门禁（`vitest.config.ts`）

| 指标       | 阈值      | 说明                                              |
| ---------- | --------- | ------------------------------------------------- |
| Lines      | **≥ 85%** | 低于则 `npm run test:coverage` 与 CI **直接失败** |
| Statements | **≥ 85%** | 同上                                              |
| Branches   | **≥ 85%** | 同上                                              |
| Functions  | **≥ 85%** | 同上                                              |

配置位置：`vitest.config.ts` → `test.coverage.thresholds`。

**当前基线（0.1.2）**：单测 1069 条，Lines 95.88% / Branches 88.2% / Functions 95.48%。

### 组件门禁（`vitest.component.config.ts`，per-glob 两档）

UI 层加入分母后全量 functions 不达 70%，故按 vitest `thresholds` 的 per-glob 拆两档，
每档为**实测值减 2 个百分点向下取整**的诚实地板（只防回归、不虚高摆拍）：

| 分母                                   | Lines  | Statements | Branches | Functions |
| -------------------------------------- | ------ | ---------- | -------- | --------- |
| `packages/ui/src/**`（实测）           | 98.99% | 98.99%     | 90.58%   | 92.86%    |
| ↑ 门禁地板                             | **96** | **96**     | **88**   | **90**    |
| `apps/desktop/src/renderer/**`（实测） | 90.15% | 90.15%     | 84.82%   | 60.82%    |
| ↑ 门禁地板                             | **88** | **88**     | **82**   | **58**    |

（实测取自 `npm run test:component` 全量 318 用例；0.1.2 分母纳入 ui 桶
`composables` / `directives` / `naive` / `index.ts` 后重测 —— ui branches 地板随测试补齐
87→88；renderer 地板由 0.1.1 的 85/80/52 抬升至 88/82/58。）

**承诺：UI 测试将持续补齐、地板随之上调。** 每补一轮组件测试，把对应 glob 的地板
更新为「新实测 −2pp」；renderer functions 57% 是过渡期防线，不是终点。

**覆盖范围**：

- `packages/shared/src/**`（类型契约、schema、错误、令牌、备份命名/命令预览）
- `packages/kit/src/**`（jsonc、atomic-write、exec-wsl、paths、logger）
- `apps/desktop/src/main/**`（ConfigService、TaskRunner、IoService、IPC、tray、window）
- `apps/desktop/src/renderer/stores|composables|features/**`（含备份向导表单纯逻辑）

**不在覆盖率门禁内**（有说明）：

- `types.ts`（纯类型，无运行时逻辑）

（`config-migrations.ts` 已纳入门禁：`packages/shared/src/**` 全覆盖，由 `config-schema.test.ts` 的 v1→v2 用例守护。）

**M7 新增覆盖**：

- `shared/elevation.ts`（op 白名单 / 参数校验 / op→argv 映射 / 提权错误识别）
- `shared/diagnostics.ts`（脱敏规则：主目录变体、路径边界、URL 凭据、密钥打码）
- `kit/zip.ts`（CRC32 标准向量、zip 结构往返、路径逃逸拒绝）
- `main/elevation/`（客户端成功/取消/坏结果路径、BOM、空格路径引号、超时透传、工作目录清理、
  Helper 脚本白名单与校验顺序断言）
- `main/services/diagnostics-service.ts`（日志收集、导出 zip 内容与脱敏、目标路径规范化）
- `main/services/signature-service.ts`（Authenticode 输出解析、签名/未签名/检测失败）
- `main/updater/auto-update.ts`（状态机：available / not-available / downloading / downloaded / error、
  开发模式收窄判定、feedUrl 回填、download 早退、install 门控）
- `main/ipc/handlers/update.ts` + app 域 M7 三通道（委托与兜底、对话框取消/确认、扩展名规范化）
- **提权委托链**（`m7-delegation.test.ts`）：network 单条/批量合并 UAC/部分失败/UAC 取消/未注入降级、
  usbipd bind/unbind、wsl install/setVersion——此前 4 条服务链路零测试
- `renderer/stores/update.ts`（状态镜像、attach 真退订、操作失败传播）
- `renderer/features/terminal/input-chunk.ts`（256KB 分片、代理对不拆散）

## CI

`.github/workflows/ci.yml`：

- `lint-typecheck-test`：Node 20/22 矩阵，lint + format:check + typecheck +
  **Tokens drift check（`tokens:check`：`tokens.ts` 与生成产物逐字节对账）** + **test:coverage（85% 门禁）**
  - **test:component（per-glob 两档门禁：ui 96/96/87/90、renderer 87/87/82/57）** + build +
    **smoke:product（main 模块图 + preload 模块图硬校验）**
- 覆盖率报告以 artifact 形式保留 14 天
- `e2e`：Windows runner，`npm run test:e2e` 实跑 smoke + 视觉回归（`smoke.e2e.ts` 与 `visual.e2e.ts`）

## 新增功能的测试要求

1. 纯函数逻辑 → 必须单元测试
2. 修改解析/schema/IPC → 同步更新用例
3. UI 改动 → typecheck + 组件测试通过（新 `.vue` 进组件分母，须补挂载/交互/错误态三件套）
4. 破坏性行为 → E2E 或手动测试清单
