# 贡献指南

感谢你对 **WSLPilot** 的关注！本项目使用 npm workspaces monorepo，提交前请阅读以下约定。

## 开发环境

- **Node.js** ≥ 20
- **npm** ≥ 10
- **Windows 10 2004+ / Windows 11**（运行 Electron 应用与 wsl.exe）

```bash
git clone https://github.com/ThzxxArt/WSLPilot.git
cd WSLPilot
npm install
npm install-scripts approve electron esbuild vue-demi @parcel/watcher
npm run dev
```

## 工程结构

| 包 | 职责 |
|---|---|
| `packages/shared` | 类型、IPC 通道、zod schema、错误码、配置迁移 |
| `packages/kit` | 主进程工具（exec、原子写、JSONC、日志） |
| `packages/ui` | 设计令牌、Naive UI 主题、业务组件 |
| `apps/desktop` | Electron 主应用（main / preload / renderer） |

## 常用命令

```bash
npm run dev          # 开发模式（HMR）
npm run typecheck    # TypeScript 检查
npm test             # 单元 / 集成测试
npm run test:component  # 组件测试
npm run test:e2e     # 端到端测试
npm run build        # 构建
npm run package      # 打包 NSIS 安装包 / portable
npm run tokens       # 重新生成设计令牌 CSS
```

## 提交规范

使用 [Conventional Commits](https://www.conventionalcommits.org/)：

```
feat: 新增发行版卡片
fix: 修复 UTF-16LE 解码
docs: 更新配置参考
style: 调整间距令牌
refactor: 抽取 ConfigService
perf: 优化轮询节流
test: 补充 parseDistroList 用例
chore: 升级依赖
```

分支：`master`（稳定）、`feat/*`、`fix/*`、`chore/*`。

## 设计原则

1. **无数据库**：持久化一律 JSONC 配置文件。
2. **命令白名单**：禁止任意命令执行，动作必须在 `actions.jsonc` 声明。
3. **参数数组化**：所有系统调用以数组传参，杜绝注入。
4. **浅色主题**：不引入 darkTheme。
5. **设计令牌驱动**：颜色/间距/动效一律走 `packages/ui/src/tokens`。

## 测试要求

- 新增功能必须附带单元测试。
- 修改 `parseDistroList`、配置 schema、IPC 通道时，同步更新对应用例。
- UI 改动需保证 `npm run typecheck` 与组件测试通过。
- **覆盖率门禁 ≥85%**（lines/statements/branches/functions）。`npm run test:coverage` 不达标即失败，CI 同此标准。新增代码请自带测试，避免拉低整体覆盖率。

## 报告 Bug

请提供：

- WSLPilot 版本（设置 → 关于）
- Windows 版本 / WSL 版本
- 复现步骤
- 日志（设置 → 配置目录 → `logs/`，或「导出诊断包」）

## 许可

贡献即表示同意以 [MIT](./LICENSE) 许可发布你的代码。
