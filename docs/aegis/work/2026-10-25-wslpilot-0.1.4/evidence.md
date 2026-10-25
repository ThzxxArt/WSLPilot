# WSLPilot 0.1.4 验证证据

- 日期：2026-10-25（Asia/Shanghai）
- 基线：`v0.1.3` / `7b3dd05`；实施工作区：`/mnt/d/CodeWorkspace/WSLPilot`
- 真机：WSL 3.0.3.0；kernel 6.18.54.1-1；WSLg 1.0.79；Windows 10.0.26300.9711；wslc 3.0.3.0

## 自动门禁

| 命令                                               | 结果                                                                     | 覆盖范围                              |
| -------------------------------------------------- | ------------------------------------------------------------------------ | ------------------------------------- |
| `npm test`                                         | 1,252 passed / 88 files                                                  | 单元 + 集成                           |
| `npm run test:coverage`                            | lines 94.96% / branches 87.47% / functions 94.39%                        | 总体 + 4 个 per-glob 地板             |
| `npm run test:component`                           | 374 passed / 21 files；lines 87.68% / branches 82.99% / functions 63.22% | 组件 + per-glob 两档                  |
| `npm run test:e2e`                                 | 4 passed（含 2 个 `@visual`）                                            | Electron 启动 / 设置持久化 / 视觉基线 |
| `npm run typecheck`                                | exit 0                                                                   | 全 workspace + tools                  |
| `npm run lint`                                     | exit 0（5 条 warning，均为 test 内多组件规则）                           | ESLint + Stylelint                    |
| `npm run format:check`                             | exit 0                                                                   | Prettier                              |
| `npm run tokens:check`                             | exit 0                                                                   | 令牌生成物逐字节一致                  |
| `npm run smoke:product`                            | PASS                                                                     | main / preload 模块图                 |
| `node scripts/verify-release.mjs --allow-unsigned` | 通过（3 条环境警告；本会话已用 Windows Node 重建 0.1.4 产物）            | 版本 / CHANGELOG / tag（本地缺省）    |

## Windows 原生打包

在 `C:\Temp\WSLPilot-pkg-014`（当前工作区源码同步副本；Windows Node v24.18.1 / npm 12.0.2）执行：

- `npm ci`：成功（796 packages）。
- `npm run build --workspace @wslpilot/desktop`：成功。
- `npm run package --workspace @wslpilot/desktop`：成功；electron-builder 25.1.8 产出
  `WSLPilot-0.1.4-x64-setup.exe`（90,481,745 B）、`WSLPilot-0.1.4-x64-portable.exe`
  （90,050,231 B）、`latest.yml`、`WSLPilot-0.1.4-x64-setup.exe.blockmap`，已复制回
  `apps/desktop/release`（2026-10-25 17:48，基于本轮审阅后的最终源码重建）。
- `node scripts/verify-release.mjs --allow-unsigned --require-artifacts --tag v0.1.4`：
  在 WSL 侧通过；setup.exe sha512 与 latest.yml 一致，portable 未列入 latest.yml
  （便携版不参与自动更新，脚本已改为警告而非假红）；WSL 无法校验 Authenticode，
  Windows 侧签名仍需发布前复验。
- 打包后的 `win-unpacked/WSLPilot.exe` 用隔离 `WSLPILOT_USER_DATA` 冒烟启动 8 秒仍存活
  （已安装版占用单实例锁，不能共用默认 userData）；日志：
  `ipc handlers registered`（81 通道，含 compact/resize/setDefaultUser）、
  `tray created`、`window ready`。

## 真机 WSL 验证

- 能力探测 `probeWslCapabilities`：`source=help`，wslVersion 3.0.3.0，wslc 3.0.3.0；
  flags：compact/resize/setDefaultUser/installLocation/vhdSize/fixedVhd/webDownload/
  exportFormats/importFromFile/updatePreRelease/manageSparse 全 true。
- `wsl --export --format tar.gz`：一次性 `WSLPilot014` 成功；备份文件非空。
- `wsl --import` 直接导入 `.tar.gz`：一次性 `WSLPilotGzTest` 成功，随后注销成功。
- `wsl --manage <name> --compact`：一次性发行版成功。
- 早期手工探针 `wsl --manage <name> --resize 2GB` / `--set-default-user tester` /
  `--set-sparse true`：在 `wsl --import` 后即使发行版显示 Stopped，WSL 仍返回
  `WSL_E_DISTRO_NOT_STOPPED`（VHD 正在使用中）；`--terminate` 不能释放。该结果发生在
  **虚拟容量硬门禁加入之前**；当前实现会先拒绝 `2GB`（目标 ≤ 当前 1TB 虚拟容量），
  不会把缩容交给 WSL。应用已把 VHD 占用错误映射为“请在 Windows 终端执行
  `wsl --shutdown` 后重试”，并在详情页提供显式确认的「关闭 WSL 虚拟机」按钮；绝不自动 shutdown。
- 一次性发行版均已注销；未留下测试发行版。

## 0.1.4 复审新增修复（2026-10-25 15:xx）

- **resize 只增**：新增 VHDX 虚拟容量解析（`services/vhdx.ts`）与 handler 硬门禁；
  `--resize` 目标 ≤ 当前虚拟容量直接拒绝（WSL 在目标更小时会实际缩容，`--allow-unsafe`
  不是增长保护）。真机 1TB VHDX 读取实测通过；合成 VHDX 单测通过。
- **WSL 容量语法**：统一为 `ParseMemorySize`（整数 + B/K/KB/M/MB/G/GB/T/TB，大小写敏感、
  无小数）；IPC/elevation/UI/.wslconfig 同源。真实 `wsl --manage --resize` 对 `1.5GB`/`50gb`
  拒绝、对 `50G`/`50` 接受的行为已由语法对齐。
- **INI 真相**：双引号 + WSL 转义、`#` 唯一注释、重复键/段 first-wins；修复 0.1.4 早期
  单引号/最后一条实现。旧 `.wslconfig` 的 `dropcache`/`NAT` 加载不再变 dirty。
- **提权**：请求载荷改为命令行 base64；helper 脚本传 SHA-256，提权进程先校验字节再从内存执行；
  `noLaunch` 随参数传递，提权路径的老 WSL plain 重试有效。
- **网络**：v1→v2 迁移修复重复/空/非法 id；v2 读取时修空/非法 id，重复保留给网络页「一键修复」；修复动作纳入写队列。
- **能力/备份名**：版本兜底直接读取 `WSL_FEATURE_META`，不再漏掉 2.5.4+ 的安装高级能力；
  `normalizeBackupTarget` 对 `.tgz` 在 tar/vhd/tar.gz 三种格式下都去别名，避免双后缀。
- **配置迁移**：distros v1→v2 截断超长/超量标签与快捷动作，避免 schema 收紧时被 sanitize 丢弃；
  v2 network 重复 id 保留给网络页修复，空/非法 id 读取时修复。
- **INI/提权/预览/UI 复审**：INI 支持反斜杠续接与控制字符转义；shutdown 窗口直接操作拒绝；
  导入不再误用导出门禁；运行中导出预览含 `wsl --terminate`；安装向导非法 vhd-size 在启动前拦截。
- **导出**：输出文件为空同样按失败回滚并删除空归档，不再把 0 字节文件当成功。
- **安装完成判定**：装前注册基线移到第一次 spawn 之前，且 fallback 复用同一基线；
  修复“第一次尝试注册目标 → 第二次误判已存在 → 首启会话永久挂住”的竞态；
  正常退出但名单仍无目标时明确失败，不再假报完成。
- **UI**：安装高级选项折叠不再丢值、WSL1 禁 vhd、备份 step2 显示禁用原因、导出能力/
  WSL1 vhd 门禁、运行中迁移要求先确认终止、发行版名查找统一 trim、克隆运行态禁用、
  预发布能力门禁、能力 store 刷新、压缩失败刷新状态。
- 新增/更新测试：VHDX 解析、KeepAlive 不重建、size 语法正反例、INI first-wins/转义、
  network v2 修复、tar.gz 导入/列表、安装默认值、安装 fallback 基线、compact/resize 组件路径。

## 未覆盖 / 残余风险

- **未执行** `wsl --shutdown` 后的 resize / set-default-user / set-sparse 成功路径：
  本会话运行在 WSL 内，执行 shutdown 会杀死自身（已发生一次 SIGTERM）。
  需要 Windows 侧按 `docs/testing.md` 的 0.1.4 清单人工复验。
- **Windows 0.1.4 产物已重建**：`apps/desktop/release` 现有 setup/portable/latest.yml；
  `verify-release --allow-unsigned --require-artifacts --tag v0.1.4` 在 WSL 通过元数据/产物校验。
  安装包仍未签名，自动更新无 `publisherName`；发布前必须在 Windows 配置证书/主题并复验 Authenticode。
- **未取得** 2.7.14 / inbox / Windows 10 / WSL1 真机：能力矩阵按 `wsl --help` + 版本表 fail-soft，
  单测覆盖 help 不可用、版本表兜底、全失败返回 null；WSL1 的 compact/resize 拒绝有单测；
  发布说明需标注未实测版本。
- 安装高级选项（`--location` / `--vhd-size`）只做了 argv/契约/组件层验证，**未真实下载发行版安装**；
  `--fixed-vhd` 缺少大小时服务端以 `INVALID_ARGUMENT` 拒绝（新增测试）。
- 安装包未签名，自动更新无 `publisherName`；`verify:release` 会警告，发布说明已披露。
- 视觉基线为 Linux/Playwright 生成的既有基线；Windows 原生渲染未做像素级比对。
