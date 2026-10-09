# WSLPilot

> **WSLPilot = WSL 的驾驶舱。** 像开飞机一样管理你的 Linux 发行版：一眼看清全局，一键完成操作，一切尽在掌握。

Windows Subsystem for Linux 的现代化图形控制中枢。技术栈：**TypeScript + Vue 3 + Electron**，持久化使用 **JSONC 配置文件**（无数据库）。

> **当前阶段：M4 完成 + 工程质量根治。** 发行版管理、内置终端、导出 / 导入 / 迁移（带进度与取消）、安装向导、命令面板已可用；配置与动作（M5）、网络与设备（M6）等能力将陆续交付。

## 特性

**已交付**

- 一眼看清全部发行版状态（运行中 / 已停止 / 默认），真实资源采样（内存 / 磁盘 / CPU 差分）
- 一键启停、设默认、全部关机；发行版详情（GUID / 安装位置 / 元数据编辑 / 注销）
- 安装发行版向导（`wsl --list --online` + `wsl --install`，带进度与取消）
- 内置终端（node-pty + xterm.js）多标签工作区
- 备份与迁移向导：导出 / 导入 / 迁移，环形进度 + 实时日志 + 可取消 + 备份轮转
- 全局命令面板（Ctrl/⌘ + K）：导航、发行版、动作即输即搜
- 人类可读的 JSONC 配置，可纳入 Git；外部修改冲突安全处理
- 浅色「极光」设计系统，精致动效

**规划中（UI 不提前承诺）**

- wsl.conf 可视化编辑、自定义动作（M5）
- 端口转发 / 代理、usbipd 设备（M6）

## 开发

```bash
npm install   # 需要 Node 20+ 与 npm 12（corepack enable）
npm run dev
```

## 构建

```bash
npm run build              # 构建 + 打包（当前平台架构）
npm run package --workspace @wslpilot/desktop -- --x64    # 指定架构
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

| 文件             | 用途            |
| ---------------- | --------------- |
| `settings.jsonc` | 应用偏好        |
| `distros.jsonc`  | 发行版元数据    |
| `actions.jsonc`  | 自定义动作      |
| `network.jsonc`  | 端口转发 / 代理 |
| `ui-state.jsonc` | 界面状态        |
| `state.jsonc`    | 运行态缓存      |

## 许可

MIT
