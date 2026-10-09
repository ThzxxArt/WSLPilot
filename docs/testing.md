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

| 模块 | 覆盖点 |
|---|---|
| `exec-wsl` | `parseDistroList`（含中文、`*` 默认标记、多空格） |
| `jsonc` | 解析容错、错误行号、最小编辑保留注释 |
| `atomic-write` | 原子替换、崩溃不留半截文件 |
| `config-schema` | zod 校验、默认值填充、部分数据合并 |
| `config-migrations` | v1→v2 迁移链 |
| `errors` | 错误码目录、结构化序列化 |

### 2. IPC 契约测试

每个通道的入参 zod schema 需有「通过」与「拒绝」用例：

```ts
// 例：config:set 入参
expect(() => ipcSchema.configSet.parse({ fileKey: 'settings', patch: {} })).not.toThrow()
expect(() => ipcSchema.configSet.parse({ fileKey: 'evil', patch: {} })).toThrow()
```

### 3. 组件测试（`npm run test:component`）

环境：`happy-dom` + `@vue/test-utils`

覆盖：按钮、卡片、确认框、配置表单、命令面板、状态点。

### 4. 视觉回归

Playwright 截图对比，保证浅色主题渲染一致性（关键页面）。

### 5. 端到端（`npm run test:e2e`）

Playwright + Electron：

- 启动、窗口显示
- 列出（模拟）发行版
- 打开终端
- 改设置并落盘到 `settings.jsonc`

## 运行

```bash
npm test               # 单元 + 集成
npm run test:component # 组件
npm run test:e2e       # E2E（需 Windows）
npm run test:watch     # 监听模式
```

## CI

`.github/workflows/ci.yml`：

- `lint-typecheck-test`：Node 20/22 矩阵，typecheck + test
- `e2e`：Windows runner，Playwright 冒烟

## 新增功能的测试要求

1. 纯函数逻辑 → 必须单元测试
2. 修改解析/schema/IPC → 同步更新用例
3. UI 改动 → typecheck + 组件测试通过
4. 破坏性行为 → E2E 或手动测试清单
