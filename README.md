# WSLPilot

> **WSLPilot = WSL 的驾驶舱。** 像开飞机一样管理你的 Linux 发行版：一眼看清全局，一键完成操作，一切尽在掌握。

Windows Subsystem for Linux 的现代化图形控制中枢。技术栈：**TypeScript + Vue 3 + Electron**，持久化使用 **JSONC 配置文件**（无数据库）。

> **当前阶段：M4 备份迁移。** 发行版管理、内置终端与导出 / 导入 / 迁移（带进度与取消）已可用；配置与动作（M5）等能力将陆续交付。欢迎关注与反馈。

## 特性

- 一眼看清全部发行版状态（运行中 / 已停止 / 默认）
- 一键启停、设默认、安装、备份、迁移
- 内置终端（node-pty + xterm.js）
- 备份与迁移向导：导出 / 导入 / 迁移，环形进度 + 实时日志 + 可取消
- 全局命令面板（Ctrl/⌘ + K）
- 人类可读的 JSONC 配置，可纳入 Git
- 浅色「极光」设计系统，精致动效

## 开发

```bash
npm install
npm run dev
```

## 构建

```bash
npm run build
```

## 工程结构

```
WSLPilot/
├─ packages/shared   # 类型、IPC 通道、zod schema、错误码
├─ packages/kit      # 主进程工具（exec、原子写、JSONC、日志）
├─ packages/ui       # 设计令牌、Naive UI 主题、业务组件
├─ apps/desktop      # Electron 主应用（main / preload / renderer）
└─ scripts           # 构建与令牌生成脚本
```

## 配置文件

应用数据目录（`%APPDATA%\WSLPilot\`）：

| 文件 | 用途 |
|---|---|
| `settings.jsonc` | 应用偏好 |
| `distros.jsonc` | 发行版元数据 |
| `actions.jsonc` | 自定义动作 |
| `network.jsonc` | 端口转发 / 代理 |
| `ui-state.jsonc` | 界面状态 |
| `state.jsonc` | 运行态缓存 |

## 许可

MIT
