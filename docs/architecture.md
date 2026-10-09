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

## 安全

| 层       | 措施                                                                                                                                                                      |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 渲染进程 | `contextIsolation` + `sandbox` + 零 Node 权限                                                                                                                             |
| IPC      | 通道白名单 + zod 入参校验（全部带参通道强制登记 schema，契约测试守护）                                                                                                    |
| 命令执行 | 参数数组化 + `-e` 分界 + 动作白名单                                                                                                                                       |
| 路径     | 控制字符 / `..` / Windows 非法字符（`parseLinuxPath`）拒绝，结果必须在发行版根内；备份路径拒绝控制字符并展开 `%USERPROFILE%`；`app:openPath` 仅允许目录（防文件关联执行） |
| 提权     | 独立 ElevationHelper 进程 + 结构化请求（**M7 规划，尚未实现**；当前 `--manage --move` 等以当前权限执行，失败给 `PERMISSION_DENIED` 提示）                                 |
