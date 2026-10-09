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

## 安全

| 层 | 措施 |
|---|---|
| 渲染进程 | `contextIsolation` + `sandbox` + 零 Node 权限 |
| IPC | 通道白名单 + zod 入参校验 |
| 命令执行 | 参数数组化 + `-e` 分界 + 动作白名单 |
| 提权 | 独立 ElevationHelper 进程 + 结构化请求 |
