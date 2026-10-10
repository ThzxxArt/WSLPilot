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

覆盖：StatusDot、Sparkline、MetricCard、DistroCard（启停事件、状态中文、默认禁用菜单）。

组件覆盖率门禁：lines/statements/branches/functions ≥70%（`vitest.component.config.ts`，由 `npm run test:component --coverage` 强制执行）。

### 4. 视觉回归（规划中）

Playwright 截图对比，保证浅色主题渲染一致性（关键页面）。当前尚未落地，属 M7 打磨项。

### 5. 端到端（`npm run test:e2e`）

Playwright + Electron（`electron.launch`，Windows）：

- 启动、窗口显示
- 侧栏导航（驾驶舱 / 终端 / 备份迁移）关键元素可见性

## 运行

```bash
npm test               # 单元 + 集成
npm run test:coverage  # 单元 + 覆盖率（硬门禁 ≥85%）
npm run test:component # 组件 + 覆盖率（硬门禁 ≥70%）
npm run test:e2e       # E2E（需 Windows）
npm run test:watch     # 监听模式
```

## 覆盖率门禁（硬性）

| 指标       | 阈值      | 说明                                              |
| ---------- | --------- | ------------------------------------------------- |
| Lines      | **≥ 85%** | 低于则 `npm run test:coverage` 与 CI **直接失败** |
| Statements | **≥ 85%** | 同上                                              |
| Branches   | **≥ 85%** | 同上                                              |
| Functions  | **≥ 85%** | 同上                                              |

配置位置：`vitest.config.ts` → `test.coverage.thresholds`。

**当前基线（M6 交付后）**：单测 Lines 95%+ / Branches 87%+ / Functions 95%+；组件 Lines 98%+ / Branches 91%+ / Functions 84%+。

**覆盖范围**：

- `packages/shared/src/**`（类型契约、schema、错误、令牌、备份命名/命令预览）
- `packages/kit/src/**`（jsonc、atomic-write、exec-wsl、paths、logger）
- `apps/desktop/src/main/**`（ConfigService、TaskRunner、IoService、IPC、tray、window）
- `apps/desktop/src/renderer/stores|composables|features/**`（含备份向导表单纯逻辑）

**不在覆盖率门禁内**（有说明）：

- `types.ts`（纯类型，无运行时逻辑）
- `config-migrations.ts`（迁移链，随 schema 版本演进单独测）
- `updater/` `elevation/`（M7 提权/更新，尚未实现）

## CI

`.github/workflows/ci.yml`：

- `lint-typecheck-test`：Node 20/22 矩阵，typecheck + **test:coverage（85% 门禁）** + build
- 覆盖率报告以 artifact 形式保留 14 天
- `e2e`：Windows runner，Playwright 冒烟

## 新增功能的测试要求

1. 纯函数逻辑 → 必须单元测试
2. 修改解析/schema/IPC → 同步更新用例
3. UI 改动 → typecheck + 组件测试通过
4. 破坏性行为 → E2E 或手动测试清单
