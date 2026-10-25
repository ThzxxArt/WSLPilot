# WSLPilot 0.1.4 实施计划（WSL 3.0 对齐 + 回归收口）

> 状态：needs-verification（实现与自动门禁已收口；真机 shutdown 后的
> resize/default-user/sparse 成功路径仍需在 Windows 侧按 `docs/testing.md` 人工复核；
> 2.7.14 / inbox / WSL1 真机矩阵未取得）。
> 基线 `v0.1.3` / `7b3dd05`，工作区在实施前干净。
> 原则：零遗漏、零半成品、链路完整；每个工作包以可执行测试和真机证据收口。
> 未获明确授权：不 commit、不打 tag、不 push、不发布。

## 0. 目标与非目标

### 目标

1. 修复 0.1.3 已交付但不可用/有数据风险的行为：失效回滚、终端跨路由/分屏重建、全局关机与长任务竞态、导出运行中发行版的误导文案。
2. 对齐 WSL 3.0 的发行版能力：能力探测、compact、resize、set-default-user、安装落点/磁盘大小、tar.gz 导出。
3. 补齐 `.wslconfig` / `wsl.conf` 高价值配置面，未知合法值不阻塞保存。
4. 把质量门禁变成可执行的发布门禁：新代码测试、per-glob 覆盖率、release 校验、文档同步。
5. 所有新能力在旧 WSL / inbox / WSL1 上 fail-soft：隐藏或禁用，并给出明确的版本要求。

### 非目标

- wslc 容器管理（0.2.0）。
- Electron 大版本升级（0.2.0）。
- i18n、深色主题、插件市场。
- `.wslconfig` 全量 40+ 键表单化（高价值子集 + raw 兜底）。
- 代码签名采购决策（0.1.4 只做诚实披露与发布校验入口）。

## 1. 工作包与验收

### WP0 回归与说真话（P0）

| 项                | 实施                                                                                                                                             | 验收                                                             |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------- |
| 失效回滚移除      | 删除 channel / preload / handler / service / builder / elevation op / UI / 测试 / 文档；UI 换「查看历史版本」外链 + 「修复安装（wsl --update）」 | 全仓 `rg -- '--rollback'` 仅命中「已移除」说明；3.0.3 无失效入口 |
| 终端保活          | 路由 KeepAlive（仅 TerminalView）；分屏改为扁平 pane host + 计算几何 + 独立分隔条，ptyId 为稳定 key                                              | 切路由再回、分屏前后 scrollback 与 vim/htop 现场不变；重载不双开 |
| 统一锁            | 抽出 `KeyedLock`；TaskRunner 复用它；terminate/start/setDefault/shutdown/setDefaultVersion 走 guard；shutdown 有运行任务时拒绝并列出             | 导出/迁移中 terminate/shutdown 被拒；move 不被中断               |
| 导出/压缩停机语义 | `--export` 运行中必须显式 `terminateFirst`；`--compact` 同；`--resize`/`--set-default-user` 要求已停止                                           | UI 明示「会停止该发行版」；确认后状态为 Stopped                  |
| 编码              | UTF-16LE 探测加结构判据（CJK 无 BOM 不错判）                                                                                                     | 纯中文 UTF-16LE / UTF-8 用例                                     |
| INI               | 保留行内注释与键写法；重复段/键取第一处（WSL first-wins）；双引号 + WSL 转义可逆；remove 清全部重复键                                            | 往返/注释/重复段/Windows 路径用例                                |
| 单一契约          | DistroMeta 复用同一 zod schema；action id 执行边界校验；重复 network id 迁移修复 + UI 修复入口                                                   | 重复 id 文件可迁移、可保存；`a\0b` 两端一致拒绝                  |
| 退出/日志         | `app.exit(0)` → flush 后 `app.quit()`；Logger.flush()                                                                                            | updater 退出安装不被跳过；日志尾行落盘                           |
| 配置版本          | 非整数版本归一，避免每次启动迁移                                                                                                                 | 1.5 / 2.5 用例                                                   |
| 原生对话框        | 5 处未 catch 的 dialog 调用统一失败路径                                                                                                          | 点击取消/失败不静默                                              |
| 备份死路          | BackupView 第 4 步 task 被 trim 后给关闭/重试出口                                                                                                | 不再无按钮                                                       |

### WP1 能力矩阵

- `WslCapabilities`：wslVersion、windowsBuild、wslcVersion、inbox、flags（compact/resize/setDefaultUser/installLocation/vhdSize/fixedVhd/exportFormats/importFromFile/updatePreRelease/manageSparse）、source。
- 探测：`wsl --help` 为主，版本表为兜底；`wslc version --format json`；60s 缓存，更新/安装后失效。
- `WSL_FEATURE_UNSUPPORTED`：包含 required/current，UI 统一「需要 WSL x.y（当前 z）」。
- 渲染层 `stores/wsl-env.ts` 单例；所有新按钮/字段统一门禁。
- 验收：2.7.14 上 compact 隐藏、resize/default-user 可用；inbox 上全部隐藏；3.0.3 全亮。

### WP2 存储与身份

- 新通道：`distros:compact`、`distros:resize`、`distros:setDefaultUser`；任务类型复用 `manage`，锁 `<distro>`。
- compact：运行中必须 `terminateFirst`；成功后重新读 vhdx 大小并报告实际变化；WSL1 拒绝。
- resize：读取 VHDX **虚拟容量**做硬门禁，只允许目标 > 当前值（WSL 的 `--resize` 在目标更小时会缩容，`--allow-unsafe` 不是增长保护）；运行中拒绝；WSL `ParseMemorySize` 整数语法校验；失败给出可行动建议。
- setDefaultUser：Linux 用户名校验；运行中拒绝；成功提示需新会话生效。
- UI：详情页「存储与身份」卡，含宿主 vhdx、内部 df、可回收上限估算、压缩、扩容、默认用户、稀疏；危险动作确认框 + 等价命令。
- 验收：一次性 WSL2 发行版上 compact 回收、resize 扩容、默认用户新会话生效。

### WP3 配置面

- `NetworkMode` 增加 `none` / `consomme`；`autoMemoryReclaim` 读兼容 `dropcache`；仅用户实际修改时写规范 `dropCache`（加载不因规范化置 dirty）。
- `.wslconfig` 增加 `[general]` 与高价值键：wsl2.kernel/kernelCommandLine/safeMode/localhostForwarding/guiApplications/nestedVirtualization/vmIdleTimeout/dnsProxy/defaultVhdSize/gpuSupport/maxCrashDumpCount；general.instanceIdleTimeout/distributionInstallPath；experimental.bestEffortDnsParsing/ignoredPorts/hostAddressLoopback。
- 字段支持 min/max、可自定义 enum；未知合法值不阻塞保存，显示「当前值不在推荐列表」。
- `wsl.conf` 补 `[gpu]`、`[time]`、`[boot] protectBinfmt`、`[automount] ldconfig/cgroups`；已知键大小写归一。
- 验收：含 `consomme`/`none`/`dropCache`/`[general]` 的文件可读可存；未知 enum 不阻塞。

### WP4 安装与备份

- `distros:install` 扩展 `{ name?, location?, version?, vhdSize?, fixedVhd?, webDownload? }`；命令预览与实跑同源。
- 默认安装位置/磁盘大小从 `.wslconfig` 读取并显示（`general.distributionInstallPath` / `wsl2.defaultVhdSize`）；UI 高级选项 + 能力门禁。
- 备份格式增加 `tar.gz`：命名/轮转/列表/扩展名/导入全链路；WSL 2.4.4+/3.0.3 原生自动识别（实测），不做自解压兜底，失败给可行动错误。
- 导出运行中发行版必须确认；压缩导出进度不伪造精确百分比。
- 验收：自定义盘安装 + vhd-size 生效；tar.gz 可列出、可导入。

### WP5 质量与交付

- 新增/更新单测、组件测试、E2E；per-glob 覆盖率地板（main/services、renderer/stores、ipc/handlers）。
- `scripts/verify-release.mjs`：版本/tag/CHANGELOG/产物 sha512/签名/publisherName 一致性；未签名必须 `--allow-unsigned`。
- 文档同步：README、CHANGELOG、设计书、architecture、config-reference、testing、CONTRIBUTING。
- 视觉基线更新；全量门禁：typecheck / lint / format:check / test / test:component / test:e2e / test:visual。
- 真机矩阵：3.0.3、2.7.14、inbox、WSL1；无法取得的真机在发布说明标注。

## 2. 执行顺序

1. WP0 P0（回滚、终端、锁、导出语义）。
2. WP0 P1（编码、INI、契约、退出、对话框、死路）。
3. WP1 能力矩阵。
4. WP2 存储与身份。
5. WP3 配置面。
6. WP4 安装与备份。
7. WP5 测试、覆盖率、发布校验、文档、全量门禁。
8. 真机验证与最终回执。

## 3. 完成定义

- 计划内每一项都有代码、测试、文档三件套。
- 所有新通道在 preload 契约测试中有正反用例。
- 所有新能力在旧版本/不可用时 fail-soft，不出现「点了没反应」。
- `npm run typecheck`、`npm run lint`、`npm run test`、`npm run test:component`、`npm run test:e2e`、`npm run format:check` 全绿。
- `node scripts/verify-release.mjs --allow-unsigned` 通过（未签名时如实报告）。
- 真机证据写入 `docs/aegis/work/2026-10-25-wslpilot-0.1.4/evidence.md`。
