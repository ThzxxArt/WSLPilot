# Changelog

本项目遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，
版本号遵循 [Semantic Versioning](https://semver.org/lang/zh-CN/)。

> **版本号策略**：序列自 `0.1.0` 起步并保持 `0.x`，**永不发布 `1.0.0`**。

## [0.1.4] - 2026-10-25

### Notes

- **0.1.4 为 WSL 3.0 对齐版（回归收口 + 平台能力）**：先修 0.1.3 已交付但实际不可用的
  行为，再补 WSL 3.0 的发行版存储治理与配置面；不做容器管理（留 0.2.0），不换 Electron。
- 真机基线：**WSL 3.0.3.0 / 内核 6.18.54.1-1 / wslc 3.0.3.0 / Windows build 26300**。
  `wsl --help` 在 3.0.3 退出码为 255 且写 stderr，能力探测按“有选项文本即解析”处理。
- 真机发现并据此修正：`wsl --import` 后发行版显示 Stopped，但 VHD 仍被 WSL 占用；
  `--resize` / `--set-default-user` / `--set-sparse` 会报 `WSL_E_DISTRO_NOT_STOPPED`
  （“VHD 当前正在使用中”），`--terminate` 不能释放，必须在 Windows 侧执行
  `wsl --shutdown`。应用不自动 shutdown，只在详情页提供显式确认按钮与可行动错误文案。

### Removed

- **失效的 WSL 更新回滚**：`wsl --update --rollback` 在 WSL 3.0 已移除，2.7.3+ 也会失败。
  删除 `app:wslUpdateRollback` 通道、preload API、handler、service、argv builder、提权 op
  与界面入口；高级菜单改为「查看 WSL 版本历史 / 手动安装旧版」（外链 GitHub Releases）。
- `SplitPane.vue` 递归分屏容器（被扁平 pane host 取代，避免分屏时重建 xterm）。

### Fixed

- **终端保活**：路由层仅对 `TerminalView` 启用 `KeepAlive`；分屏改为「扁平 pane host +
  计算矩形 + 独立分隔条」，以 ptyId 为稳定 key。切路由再回、分屏/关闭面板不再销毁已有
  xterm 实例与 scrollback。
- **并发互斥**：抽出 `KeyedLock`，TaskRunner 与直接操作共用同一把 key 锁；
  所有 `install`（含按名安装）与 `wsl --update`/`--set-default-version` 共用全局锁；
  `distros:start|terminate|setDefault|shutdown`、`app:wslSetDefaultVersion` 在运行中任务
  存在时拒绝并列出任务；`wsl --shutdown` 在拿到全局锁后再次检查，避免 check-then-act 杀掉刚入队的任务；
  shutdown 窗口内直接操作（start/terminate/setDefault/withLock）同样被拒绝，只有 shutdown 自身可执行。
- **导出/压缩停机语义**：`--export`/`--compact` 运行中发行版必须显式 `terminateFirst`；
  删除“导出过程中可以继续使用该发行版”的错误文案；克隆运行中源发行版直接拒绝。
  注销前自动备份会显式先终止发行版（否则安全网本身必然失败）。导出结束若输出为空，
  按 `IO_ERROR` 回滚并删除空文件，不再把空归档当成功。
- **纯中文 UTF-16LE 无 BOM 解码**：编码探测增加 streaming 严格 UTF-8 判据，128 字节
  探测窗口截断多字节字符时不再误判为 UTF-16LE。
- **INI 最小编辑**：只替换 `=` 右侧值，保留行内注释、键写法与等号旁空白；重复段/键取
  **第一处**（与 WSL configfile.cpp 的 first-wins 一致）；`#` 是唯一行内注释符；
  双引号 + `\\`/`\"`/`\n`/`\t`/`\b` 转义可逆（Windows 路径不再被 WSL 当非法转义）；
  支持 WSL 的反斜杠+换行续接，编辑后收敛为单行，不留下孤立续接片段。
- **容量语法**：`--vhd-size`/`--resize` 与 `.wslconfig` size 字段统一为 WSL
  `ParseMemorySize` 语法（整数 + `B|K|KB|M|MB|G|GB|T|TB`，大小写敏感、无小数）；
  `8G`/裸字节可保存，`1.5GB`/`8gb` 在执行前拒绝。
- **resize 只增**：读取 VHDX 元数据中的**虚拟容量**做硬门禁；目标 ≤ 当前值直接拒绝，
  不再依赖无保护作用的 `--allow-unsafe`（WSL 目标更小时会实际缩容）。
- **单一契约**：`meta:set` 复用 `distros.jsonc` 的 distroMetaSchema；动作 id / 快捷动作在
  配置读入与执行边界同一校验（兼容 legacy `git:pull`，上限统一 100）；network.jsonc
  v1→v2 迁移修复重复/空规则 id；v2 读取时修复空/非法 id、保留重复并交给网络页
  「一键修复」（修复动作纳入写队列）；distros.jsonc v1→v2 迁移截断超长/超量标签与
  快捷动作，避免收紧 schema 时被 sanitize 静默丢弃。
- **提权载荷**：helper 输入从可被同用户改写的 `request.json` 改为命令行 base64；
  helper 脚本本身传 SHA-256，提权进程先校验字节再从内存执行，UAC 期间替换临时脚本
  只会校验失败；`wsl.install` 的 `noLaunch` 随结构化参数传入，老 WSL 的 plain
  重试在提权路径同样生效。
- **安装高级选项**：`.wslconfig` 的 `general.distributionInstallPath` /
  `wsl2.defaultVhdSize` 作为安装向导占位默认值；WSL1 时禁用并清空磁盘大小/固定磁盘；
  折叠高级选项不再静默丢弃已填值，校验错误自动展开并显示。
- **退出链**：`app.exit(0)` 改为 flush 后 `app.quit()`，electron-updater 的
  `autoInstallOnAppQuit` 不再被跳过；`Logger.flush()` 等待日志队列落盘。
- **配置版本**：非整数 `$schemaVersion` 归一为整数，避免每次启动重复迁移。
- **对话框**：导出/导入/迁移/克隆的浏览按钮与备份页第 4 步任务记录丢失场景全部有
  失败提示或退出按钮，不再“点了没反应/无按钮死路”。
- **备份向导**：第 2 步禁用「下一步」时显示具体原因；运行中未勾选先停止、导入重名
  （大小写不敏感）在进入下一步前即提示；迁移同样要求先确认终止运行中发行版；查找发行版
  统一 trim 名称；WSL1 禁选 vhd；tar.gz 在能力不足时不再预选，
  `runExport` 在终止终端前做能力门禁；导入不再用导出 flag 误拦截（导入 argv 无
  `--format`）；运行中导出的等价命令预览包含前置 `wsl --terminate`。
- **存储卡**：压缩失败/取消后刷新 distros（compact 可能已先终止运行中发行版）；
  存储任务独立 watcher + 互斥 busy，快速终态不会卡住；稀疏操作补确认、WSL2/能力/停止校验。
- **设置/安装**：WSL 环境卡「刷新」同时刷新共享能力 store，向导不再只能重启恢复；
  预发布更新按 `updatePreRelease` 能力门禁；默认备份格式 tar.gz 也按 `exportFormats`
  能力置灰/降级；克隆文案/按钮与“必须已停止”的服务语义一致。
- `normalizeState` 先匹配 `uninstalling`，不再把卸载中显示成安装中。

### Added

- **WSL 能力矩阵**（`WslCapabilities`）：`wsl --help` 主探测 + 版本表兜底 + `wslc version`；
  版本兜底直接从 `WSL_FEATURE_META` 推导，避免 UI 文案与能力表漂移；新增
  `WSL_FEATURE_UNSUPPORTED` 与渲染层 `wsl-env` store；设置 → WSL 展示能力清单。
- **存储与身份**：`distros:compact` / `distros:resize` / `distros:setDefaultUser`；
  详情页新增存储卡（宿主 vhdx、内部用量、可回收上限估算、压缩、扩容、默认用户、稀疏、
  停止全部 WSL），危险动作确认 + 等价命令 + 能力门禁。
- **安装高级选项**：`wsl --install` 支持 `--location` / `--version` / `--vhd-size` /
  `--fixed-vhd` / `--web-download` / `--enable-wsl1`；安装向导新增高级选项与命令预览。
- **安装完成判定基线只取一次**：在第一次 spawn 前记录目标是否已注册，`--no-launch`
  降级重试复用同一基线；避免第一次尝试注册出的目标被误判为“装前已存在”，
  从而关闭注册信号、让 plain 首启会话永久挂住。命令正常退出但目标仍不在名单时
  报 `TASK_FAILED`，不再假报安装完成。
- **tar.gz 备份**：导出格式 `tar.gz`（WSL 2.4.4+），命名/轮转/列表/扩展名/导入全链路；
  3.0.3 真机验证 `wsl --import` 可直接识别 tar.gz。
- **配置面**：`.wslconfig` 新增 `[general]` 与高价值键（kernel/kernelCommandLine/safeMode/
  localhostForwarding/guiApplications/nestedVirtualization/vmIdleTimeout/dnsProxy/
  defaultVhdSize/gpuSupport/maxCrashDumpCount/instanceIdleTimeout/distributionInstallPath/
  bestEffortDnsParsing/ignoredPorts/hostAddressLoopback）；`networkingMode` 支持
  `none`/`consomme`；`autoMemoryReclaim` 读写规范化 `dropCache`；未知 enum 允许保存并提示。
  `wsl.conf` 补 `[gpu]`、`[time]`、`[boot] protectBinfmt`、`[automount] ldconfig/cgroups`。
- **发布校验**：`scripts/verify-release.mjs` 校验版本/tag/CHANGELOG/产物/签名/publisherName；
  未签名必须显式 `--allow-unsigned`。

### Verification

- 单测 1,252 条全通过（新增能力探测、KeyedLock、TaskRunner 锁、VHDX 虚拟容量、存储任务、
  导出停机、WSL size 语法、INI first-wins/转义/续接、迁移、tar.gz 等用例）；组件 374 条、
  E2E 4 条、视觉回归 2 条通过；typecheck / lint / format:check 全绿。
- 真机验证：WSL 3.0.3 上 tar.gz 导入/导出、compact、能力探测（help 全 flag）、VHDX
  虚拟容量读取通过；resize/default-user/sparse 的“VHD in use”路径已按官方提示映射
  （需 Windows 侧 shutdown）。
- Windows 0.1.4 安装包已用 Windows Node 重建并复制到 `apps/desktop/release`；
  `verify-release --allow-unsigned --require-artifacts --tag v0.1.4` 在 Windows 上通过
  （setup sha512 一致，签名 NotSigned 显式放行，publisherName 未配置）。
- 未覆盖：2.7.14 / inbox / Windows 10 真机不足；resize/default-user/sparse 的 shutdown 后
  成功路径未在本会话执行。发布前必须按 `docs/testing.md` 复验并补 `publisherName`。

## [0.1.3] - 2026-10-14

### Notes

- **0.1.3 为 WSL 深耕版**（功能增强）：聚焦 **WSL 本体生命周期（安装 / 更新 / 回滚 / 默认版本）、
  发行版管理增强（宿主磁盘 / 稀疏磁盘 / 克隆 / 注销前备份）、终端优化增强（分屏 / 启动目录与 Shell
  接线 / 快捷键与右键菜单 / 搜索高亮 / WebGL 渲染）、`.wslconfig` 全局配置编辑**；并清除历史遗留
  （`state.jsonc` 无消费方幽灵字段、`kit/env.ts` 死代码、文档失真）。
- 通道/任务类型/提权 op 全量扩展并保持四方对账：新增 `app:wslEnv` / `app:wslUpdate` /
  `app:wslUpdateRollback` / `app:wslSetDefaultVersion` / `distros:setSparse` / `io:clone` /
  `wslconfig:read|write` / `clipboard:read|write`；提权白名单新增
  `wsl.update` / `wsl.updateRollback` / `wsl.setDefaultVersion` / `wsl.setSparse`；
  任务类型新增 `update` / `manage` / `clone` / `unregister`。
- 安装 WSL 本体与 `wsl --update` / `--rollback` 共用 `wsl:global` 串行锁（本体级操作绝不并发）。
- 遗留清理（审计二轮）：注销任务化后 `TaskRunner.runExclusive` 专用 API 已无生产消费 →
  整体移除（互斥语义由任务 `lockKey` 单一承担）；`summarizeWslConfChanges` 由主进程服务
  迁入 `@wslpilot/shared` 并接入 `/etc/wsl.conf` 与 `.wslconfig` 两处差异预览摘要（消除死导出）。
- 正确性补齐（Git 审计三轮）：INI 行内注释在单事实源下同时支持 `#` 与 `;`（对齐旧镜像读取
  语义，空白前缀；引号值内为字面量）；段落名/键名大小写不敏感（对齐旧镜像解析与 WSL 自身
  语义；改写保留原键名大小写、不产生重复语义键）；终端布局恢复强制「叶子 id 唯一」不变量
  （手改脏数据中重复 ptyId 只保留首个，杜绝同一会话绑两个面板）；`swap=0`（禁用交换）与
  字段提示一致放行。
- 实测：单测 1186 条（lines 95.07% / branches 88.08% / functions 94.84%）、组件 365 用例
  （ui 桶 98.99/90.58/92.86、renderer 桶 89.72/84.30/63.53；两档地板按「实测 −2pp」重校准为
  ui 96/96/88/90、renderer 87/87/82/61）。

### Added

- **WP1 WSL 本体生命周期**
  - 环境体检（`app:wslEnv`）：`wsl --version` + `wsl --status` 全量解析 —— 版本 / 内核 /
    默认发行版 / 默认版本；**非抛出语义**（未安装返回 `installed:false` + 原始输出），
    供「一键安装」引导直接消费；设置 → WSL 新增环境卡（版本行、默认版本下拉、
    更新 / 预发布 / 回滚入口），读取失败给重试而不断路；驾驶舱 hero 版本旁同步提供「更新 WSL」入口
  - 一键安装 WSL（未安装场景）：设置环境卡与驾驶舱错误横幅（`WSL_NOT_INSTALLED` /
    `WSL_NOT_FOUND`）均可直达安装任务；安装向导在「在线列表失败」时改给「一键安装 WSL」
    兜底（不再弹错误 toast 后死路）；安装/更新输出识别「需要重启 Windows」并在完成面板如实提示
  - `wsl --update` 更新（`app:wslUpdate`）：长任务（流式日志 + 可取消 + 权限不足自动转提权）；
    按「前读版本 → 执行 → 后读版本」如实报告三种结果（版本已变 / 无变化 / 需要重启），
    绝不伪造「检查到新版本」；预发布通道 `--pre-release`（高级入口）
  - `wsl --update --rollback` 回滚（`app:wslUpdateRollback`）：危险操作显式确认后执行
  - `wsl --set-default-version` 默认版本（`app:wslSetDefaultVersion`）：设置卡下拉（仅影响新导入），
    直接失败且权限不足时自动转提权助手
  - `wsl --list --online` 解析 FRIENDLY NAME（`OnlineDistro`），安装向导展示友好名
- **WP2 发行版管理增强**
  - 宿主磁盘可见：`distros:list` 经注册表 BasePath 补 `hostDiskBytes`（`ext4.vhdx` 实测大小），
    详情概览新增「磁盘（宿主）」行
  - 稀疏磁盘：`distros:setSparse` → `wsl --manage <name> --set-sparse <true|false>`（WSL 2.0+；
    老版本映射为「设置 → WSL 更新」引导）；详情页一键启用（同发行版锁串行，可与导出/迁移互斥）
  - 克隆发行版：`io:clone` 单任务组合「导出临时归档 → 以新名导入（版本随源）→ 清理临时目录」；
    失败自动回滚不完整注册；新名称校验（大小写归一、重名/同名拒绝）
  - 注销任务化（`distros:unregister` 契约改为 `{ name, backupFirst }` → `TaskHandle`）：
    可勾选「注销前自动备份」（默认跟随 `backup.autoBackupBeforeDestructive`），
    备份与注销在同一排他锁内执行；同发行版运行中任务仍硬拒绝
- **WP3 终端优化增强**
  - **分屏**：标签内左右 / 上下分裂（最多 4 面板），拖拽分隔条调整比例（夹取 15%–85%）、
    活动面板描边与焦点切换、每标签记忆最近活动面板、右键/工具栏/快捷键/命令面板四入口
    （上限双保险：store 拒绝 + 达到 4 面板后四处入口同步禁用）；
    关闭面板自动折叠布局，最后一个面板关闭标签；**布局持久化到 `ui-state.terminalLayout`**，
    窗口重载后按存活会话恢复分屏（死面板剪枝、单子 split 折叠、深度超限整树拒绝）
  - **启动目录与 Shell 接线**（半幽灵字段根治）：`distros.jsonc` 的 `startupCwd` 与
    `settings.wsl.defaultShell` 真正作用于新建面板（各入口统一 `openDefault`）；
    新建弹层支持显式 Shell / 启动目录（留空用默认）
  - 终端专属快捷键：`Ctrl+Shift+C` 复制选中（无选区提示）、`Ctrl+Shift+V` 粘贴（主进程剪贴板、
    超限自动分片）、`Ctrl+Shift+F` 打开搜索；全局 `Ctrl+Shift+T` 新标签、`Ctrl+Tab`/`Ctrl+Shift+Tab`
    循环标签、`Ctrl+Shift+5/6` 分屏（终端内同样可用，与集成终端同语义）
  - 面板右键菜单：复制 / 粘贴 / 全选 / 查找 / 清屏 / 滚动到底部 / 左右上下分屏 / 关闭面板
  - 剪贴板可靠通道：`clipboard:read|write`（主进程 Electron clipboard；选中即复制同步切换）
  - 搜索增强：全部命中高亮 + 当前命中强调、区分大小写 / 正则、命中计数（N/M）、
    Enter / Shift+Enter 下一个 / 上一个
  - WebGL 渲染器（`@xterm/addon-webgl`）：加载失败或上下文丢失自动回退 DOM 渲染器，绝不半成品
  - 工具栏新增：粘贴 / 滚动到底部（贴底自动隐藏）/ 分屏 ×2 / 关闭面板；标签悬浮提示
    （发行版 · Shell · 目录 · 创建时间，恢复会话使用主进程真实创建时间）
- **WP4 `.wslconfig` 全局配置编辑**
  - 共享层新增 `wslconfig.ts`：`[wsl2]`（memory / processors / swap / swapFile / networkingMode /
    dnsTunneling / firewall / autoProxy）与 `[experimental]`（autoMemoryReclaim / sparseVhd）
    的行级最小编辑（保留注释与未知键）、带单位容量校验、表单模型与差异清单；
    `network.ts` 的镜像模式读取改为复用同一解析器（单一事实源）
  - 主进程新增 `wslconfig-service`：宿主文件读 / 写（写前语法守卫 → 备份轮转（3 份）→ 原子写），
    纯 fs 操作无需 UAC；`wslconfig:read|write` 通道
  - 网络页新增「WSL 全局配置（.wslconfig）」面板：可视化表单 + 原始文本 + Diff 预览、
    内联字段校验（非法值阻止保存）、其他键原样保留展示、「打开所在目录」、
    「立即重启 WSL（wsl --shutdown）」；保存后自动刷新镜像模式状态

### Changed

- 组件覆盖率地板按「实测 −2pp」重校准：renderer **88/88/83/59 → 87/87/82/61**
  （实测 89.72/84.30/63.53，365 用例）；ui 桶维持 96/96/88/90（实测 98.99/90.58/92.86）
- README / docs/testing.md 基线与快捷键同步；设置 → WSL 增补「去编辑 .wslconfig」入口
- 命令面板新增「终端：左右/上下分屏、关闭当前面板」（存在活动面板时提供）

### Fixed

- **0.1.2 遗留收口：「取消中止仅 mock 验证」补齐真实进程验证** —— 新增
  `run-tool.abort.run.test.ts`：用真实 `node` 挂起子进程验证 abort 会真正终止进程
  （aborted 标记 / 快速返回 / 非零退出；不 mock child_process，Linux 与 Windows CI 同验）
- **历史遗留清除**：`state.jsonc` 的 `lastScanAt` / `lastMetrics` 为无任何生产读写的幽灵字段
  （仅测试夹具引用），schema 与类型一并移除（旧数据读取时被剥离，不告警）
- **死代码清除**：`packages/kit/src/env.ts`（未被 index 导出、全仓零导入）与其测试删除
- **文档失真**：`docs/design-system.md` 移除已不存在的 `--space-*` / `--shadow-glow` /
  多档阴影描述（与 `tokens.ts` 唯一事实源对齐）；设计书的 `state.jsonc` 样例、
  `wsl --update` 命令表与终端分屏章节同步实况
- 解析器补齐行内注释语义：非引号值的「空白 + `#`」之后视为注释（引号值内 `#` 为字面量）——
  修复 `.wslconfig` 编辑器与镜像模式读取对 `networkingMode = "NAT" # 注释` 形态的解析

### Security

- 提权白名单扩展遵循同一铁律：结构化 op + 参数数组（`wsl.update` / `wsl.updateRollback` /
  `wsl.setDefaultVersion` / `wsl.setSparse` 全部 `.strict()` 参数校验，argv 经 commands.ts
  唯一事实源构建；Helper 脚本 op↔program 二次校验自动覆盖新 op）
- 克隆/稀疏流程全部复用既有执行边界：发行版名 `assertSafeDistroName`、安装路径
  `ioPathSchema`（控制字符拒绝）、临时目录独立 `mkdtemp` 且无论成败清理
- `.wslconfig` 写入走语法守卫 + 原子写 + 备份轮转，绝不把半损坏全局配置落盘

## [0.1.2] - 2026-10-12

### Notes

- **0.1.2 为第二轮质量收敛版**：全量深读缺陷根治 + 工程护栏加固，无新增功能；
  功能增量（引导页 / `.wslconfig` 编辑 / 文件双栏等）留待 0.2.0。
- 修复主题：数据安全（跨发行版串写 / 丢编辑 / 守卫旁路 / 编辑残留）、并发（写队列 / 代际 /
  名额预留 / 取消透传）、门禁一致性（隐式启动封杀补全）、安全（命令注入 / 脱敏 / 提权误判 /
  IPC 纵深防御）、健壮性（日志 / 压缩 / 原子写 / 缓存 / 编码）、UI 体验（全局错误兜底 /
  无障碍 / 令牌化）、工程护栏（CI / 覆盖率分母 / E2E / 视觉掩码）。
- 实测：单测 1109 条（lines 95.97% / branches 88.39% / functions 95.54%）、组件 333 用例
  （ui 桶 98.99/90.58/92.86 → 地板 96/88/90；renderer 桶 90.22/85.23/61.12 → 地板 88/83/59）、
  E2E smoke 2 条 + 视觉 2 条；「等价命令复制执行」文案统一引导 **管理员 PowerShell**。

### Fixed

- **数据安全（跨发行版串写 / 丢编辑 / 守卫旁路 / 编辑残留）**
  - 文件面板跨发行版串写根治：载入文件记录所属发行版，保存前校验归属（不一致拒绝写回）；
    切换发行版被取消时回退父级选择（`restore-distro`），不再把编辑留在未载入的新发行版上；
    目录加载代际守卫（快速进出目录旧响应不覆盖新目录）；写盘在途冻结导航/返回/刷新；
    「超限截断只展示前缀」文案与实现对齐（只读渲染前缀，不再只提示不展示）
  - 详情弹窗守卫旁路根治：版本转换 / 注销此前直接关窗绕过脏守卫静默丢弃未保存编辑，
    现先过 `requestClose`（wsl.conf + 文件页同语义），通过后才执行；关窗守卫加在途重入锁
    （连点 Esc / 遮罩只弹一次确认）
  - 页签与编辑残留：同一详情弹窗内切换发行版保持当前页签（此前每次变化都强制回「概览」，
    现仅关闭→打开回概览）；
    打开 / 切换发行版复位元数据编辑态（不再用旧发行版编辑值写回）；详情加载代际守卫
    （旧的注册表详情 / 指标 / 最近任务响应不覆盖新发行版）
  - WslConfPanel「重新载入」先过脏守卫（此前直接 load 静默丢编辑）；保存成功刷新发行版 store
    （autoShutdown 终止后列表运行状态不再失真）
  - 设置防抖丢编辑：SettingsView 文本类设置 400ms 防抖卸载时 flush（切页即走不再丢最后一次编辑）
  - XtermPane 卸载竞态：`await host()` 期间卸载的续体二次校验（不再向已卸载面板 `open()`，
    杜绝泄漏与 unhandled rejection）；`syncPtySize` 单飞（并发尺寸同步只发一次 IPC）；
    尺寸同步失败提示节流（同一失败只提示一次）
  - 并发防重：备份向导 / 安装向导启动锁（双击不并行拉起两个长任务）、详情转换与注销
    in-flight 锁、任务取消按钮在途禁用、备份日志抽屉只渲染尾部 ≤500 行并提示截断
  - 发行版 busy key 与 `byName` 查找大小写归一（WSL 名不区分大小写，`ubuntu` 与 `Ubuntu`
    的按钮 loading 不再对不上）
- **并发（RMW 写队列 / 代际 / 名额预留 / 取消透传）**
  - network / actions store 写队列：upsert / remove / setEnabled 的「读→改→写」在队列轮到时
    才读快照，并发 RMW 丢更新根治；删除返回被删快照，连续删除后各自撤销恢复各自
  - devices store 代际守卫（重叠 load 旧响应晚到不覆盖新状态）；network `proxyApply` 代际
    守卫（写 A 发行版的迟到脚本结果不覆盖后发起查看的 B 脚本）；`loadStatus` 增加 silent 模式
  - terminal store 创建名额预留：同步段占位 + `creatingDistros` 名单，TOCTOU 封死
    （并发创建不突破 maxSessions）；同发行版并发创建去重（双击只发起一次）
  - 任务失败 / 取消原因端到端透传：`TaskProgress.error` 新增字段，渲染层不再用最后一条
    message 冒充失败原因；终态重复事件不后拨 `finishedAt`
  - wslconf 同发行版读-写轻量串行（并发读不拿旧内容做整体覆盖）
- **运行门禁（隐式启动封杀补全）**
  - action-runner 探测先于运行门禁：`probeUserEnv`（`wsl -d X -e sh -c`）在探测前
    `assertRunning`，不再由探测隐式拉起发行版（handler 门禁保留为双保险）
  - IPC 装配 wsl 依赖必填：`ctx.wsl?.`（装配缺失时静默绕过门禁）形态移除
    （actions / fs / pty / network）
  - fs `revealInExplorer` 补门禁（此前静默失效）；network proxy 三通道
    （apply / clear / state）补门禁
  - distros unregister 任务互斥：同发行版（大小写归一）仍有 running 任务时拒绝注销
- **健壮性**
  - wslconf diff 上限降级：超过 4M 单元格退化为「全删 + 全增」（正确性不降、不再 OOM）；
    `isSameText` 直接文本比较（保存前判断不再跑全量 diff）
  - logger：本地时区日键（东八区 0–8 点不再落「昨天」文件）、保留策略（7 天 / 5MB）、
    单队列串行 append（并发写不交错丢行）、非对象 extra 包 `{ value }`
  - zip：异步 `deflateRaw`（不再阻塞主进程）、容量守卫（条目 / 合计超 ZIP 上限可读报错）、
    DOS 日期 1980 clamp（非法日期不再回绕到 2098）
  - atomic-write：覆盖时保留原文件权限 mode、rename 3 次指数退避（50/150/450ms）、
    POSIX 目录 fsync（目录项落盘）
  - registry 缓存治理：查询失败不写 30s 缓存（一次瞬断不再伪装「确无发行版」）、single-flight
    合并并发读；`Version` 缺失保留 undefined（不再伪造为 2）
  - usbipd：bind 等操作可取消（abort 子进程按 TASK_CANCELED 结算）、
    bind/unbind/attach/detach 统一串行队列、`--version` 锚定 usbipd-win 前缀
  - network：Windows `ProxyServer` 多协议串解析（不再产出垃圾代理地址）、`ProxyOverride`
    继承为 no_proxy 例外、IPv6 校验收紧（`::` 次数与组数）、系统转发表 kind 区段化
    （v6 条目不再误标 v4tov4）、规则匹配改四元组全等、地址比较 trim + 小写
  - run-tool `signal` 取消透传 + maxBuffer 截断标记（不把截断输出当完整结果）；
    tool-output BOM 优先识别；config-schema 迁移链不完整不假盖章；
    schema-sanitize 不满足契约不得当合法配置返回
  - metrics：`sampledAt` 取所有成功样本的最新时刻；无 Running 发行版不 push 0 假数据点
    （history 冻结）；`sampleDistro` 区分「未运行」与「采样失败」
  - diagnostics：单文件超上限跳过该文件继续收集小文件、mkdir 失败映射 IO_ERROR；
    signature 检测失败降级未检测态（不冒泡 UNKNOWN）；`appOpenConfigDir` openPath
    非空错误串映射 IO_ERROR；app 存在性检查 `statSync` 改异步（不阻塞主进程）；
    update 四通道错误码由 UNKNOWN 统一为 TASK_FAILED
- **UI / 体验**
  - 全局错误兜底：`app.config.errorHandler` + App.vue `onErrorCaptured` 渲染降级面板
    （重载按钮）；preload 桥接缺失显式错误屏（不再全页静默失能、白屏无出路）
  - 路由 catch-all：非法 hash / 托盘未知路径重定向驾驶舱，不再白屏
  - 状态栏真实健康度：发行版 / 指标任一 lastError 时警示点 + 「服务异常」（不再恒绿）；
    多任务并行显示「运行任务 N」；`aria-live` 播报只在任务开始 / 结束迁移时更新（进度不刷屏）
  - 设置：新增「恢复默认设置」（`defaultConfig` 唯一事实源全量 patch）；强调色保存失败
    不报成功（判 persist 返回值）；检查更新 / 下载更新的 loading 相互独立
  - 发行版页：首页排序 running → default → pinned → 名称（不再把运行中截断在 6 条之外）；
    表格停止按钮二次确认；`focus`/`detail` 查询参数消费后清理（刷新不重复弹窗 / 过滤）；
    手动刷新独立 loading（轮询不再让按钮周期性闪烁）；表格 a11y（caption + scope）
  - USB 页：首次加载骨架屏（不再先闪空态）；共享 / 附加开关补 aria-label；官网引导链接；
    「操作成功但列表刷新失败」如实提示
  - 命令面板：键盘导航展平序与视觉一致（分组序，不再跳组）；结果集缩减夹紧高亮项
  - 主题覆盖扩展：Input / Select / Dropdown / Tag / Tooltip / Message 纳入 ThemeOverrides；
    按压色从 hover 派生更深一档（不再复用 hover）；字号 / 圆角引用令牌（去硬编码）
  - 组件：Skeleton 单根（父级透传 class/style 不再产生 extraneous attrs）；Sparkline
    非有限值过滤 + 恒定序列画中线；ProgressRing 半径守卫（stroke ≥ size 不再产生负半径）；
    MetricCard 时长引用令牌 + reduced-motion 中途开启立即落终值；useReducedMotion 挂载对拍
  - 窄窗口（<960px）侧栏自动折叠、恢复宽度回用户偏好；导航 `aria-current`；
    热键 `e.repeat` 不连发、`Ctrl+Shift+,` 不误触设置；轮询窗口隐藏真正暂停（不做空转）
  - 细节：备份向导重置保留默认格式、网络编辑弹窗受控关闭（保存失败保留表单）、
    系统转发表状态 12s 静默轮询、跨发行版脚本串台消除、终端字号边界禁用 + aria-label 补全

### 审计修复

- **独立正确性审计修复**（0.1.2 发布后独立审计，shared / kit / ui + 文档域）：
  - schema-sanitize：整对象回退过宽根治 —— 语义级 refine 失败（如 network.jsonc 重复 id）
    不再清空用户全部配置，仅输出「键面残缺」才回退默认值
  - wslconf `isSameText`：恢复行级等价（仅 CRLF/LF 换行差异不算 dirty），保持 O(n) 直接比较
  - logger：保留清理排除今日文件与保留集最新一天，不再可能删掉正在写入的日志
  - run-tool：取消结果新增 `aborted` 标记（abort 与普通失败可区分）
  - elevation：删除重复 JSDoc；`isElevationError` 补 `elevation is required` 语序
  - types：`PortProxyEntry.kind` 注释与 v4tov4 / v6tov6 实现对齐
  - tool-output：UTF-32LE/BE BOM 优先于 UTF-16 判定（TextDecoder 不可用时手动降级解码）
  - diagnostics：密钥赋值支持转义引号值；鉴权头允许 `:` 后无空格（`Authorization:Bearer x`）
  - atomic-write：保留 mode 仅取权限位 `& 0o777`（不复刻 setuid/setgid/sticky）
  - zip：合计体积守卫由 `> 4GiB` 收紧为 `>= 0xffffffff`（uint32 字段溢出边界）
  - 测试诚实化：ProgressRing 负半径（size×1.2 stroke）与默认渐变派生、MetricCard 字符串数字
    三条假覆盖修正为真实可失败断言
- **独立正确性审计修复**（renderer / 视图 / 主进程域）：
  - ConflictResolver：`action` slot 替换默认按钮导致点击三选后弹窗不关闭（队列反叠框）——
    实例化 dialog 并在 resolve 落地后 `destroy()`，队列在销毁后推进
  - DistroDetailModal：files 页签补 `display-directive="show"`（切页签不再卸载文件面板丢编辑）；
    FileBrowserPanel/WslConfPanel 的切换确认 await 后复验发行版归属（杜绝视图串台）
  - InstallDistroModal：补「取消」终态出口（此前无按钮死路）；taskLost 隐藏进行中标签与进度条
  - DevicesView：USB 官网按钮改走新增 `app:openExternal` 通道（原用仅允许目录的 openPath，
    点击必失败）；协议白名单（仅 http/https）+ handler 二次校验
  - XtermPane：尺寸同步单飞 settle 后若仍漂移链式补发（消除「飞行中丢最后一次尺寸」）
  - FileBrowserPanel：保存期间编辑器只读，仅当文本仍等于快照才清脏标记（假干净根治）
  - 大小写归一补齐：备份重名比较 / 终端创建去重 / 文件面板归属校验（WSL 名不区分大小写）
  - network store：silent 轮询不再令非 silent 请求的 loading 永久卡住（owner 记账）
  - App.vue：onErrorCaptured 不再阻断全局 errorHandler（协作语义修正）；降级面板补「返回应用」复位
  - metrics store：采样成功清除 lastError（StatusBar 不再永久「服务异常」）
  - SidebarNav：窄屏自动折叠时 toggle 禁用（不再把「展开」写成用户偏好）
  - TitleBar：窗口控件先取 `wslAPI.app` 判空（子命名空间缺失不再同步 TypeError）
  - update store：删除无消费方的聚合 `busy`（死代码清零）
  - SettingsView：恢复默认后界面刷新失败提示 warning（不再误报成功）
  - main：注销改走 `runExclusive` 与同发行版长任务严格互斥（TOCTOU 根治）；
    update install 抛错映射 `TASK_FAILED`（不再 UNKNOWN）+ 状态落 error；
    usbipd「成功优先」收尾（取消信号在成功后到达不再误报取消）；
    proxyState 的 NOT_FOUND 正则收窄（发行版不存在不再假报「脚本不存在」）；
    runTool `truncated` 消费（usbipd/network 截断输出按失败处理）；
    wslconf 写与终止纳入同一 per-distro 队列；`assertRunning` 注入改必填
  - 视觉回归：镜像卡掩码收窄**评估后回退为整卡掩码**（收窄后 mask 矩形仍随
    mirrored/NAT 状态变化，两平台基线曾因此记录不同状态，环境一换即假红；
    定高整卡掩码使两形态在截图中等价）——0.1.2 变更记录以此为准
- **第二轮审计收口**（对审计修复本身的独立复审，11 项漏面清零）：
  - 诊断脱敏：单引号值支持转义引号；鉴权头正则改 `[ \t]*`（保留「scheme 与凭据零空格」
    拼接形态的宁多打码，同时禁止 `\s*` 跨行吞并下一行）
  - `isElevationError` 补 `required\b` 词尾边界（`requiredx` 不再命中）
  - `httpUrlSchema` 拒绝控制字符（`https://x\nhttp://evil` 不再过 schema；
    handler 侧协议白名单校验保持）——补换行/大小写变体用例
  - 文件页签改 `show:lazy`（首次激活才挂载：未点开不做多余 `fs.readDir` IPC，
    之后常驻不再随页签切换卸载丢编辑）
  - 注销互斥恢复「运行中任务检查」（含无锁终端动作，不可被强杀）+ `runExclusive`
    作为 TOCTOU 双保险；`runExclusive` 补 disposed 检查——补 busy 拒绝用例
  - TerminalView 的会话去重/in-flight 键大小写归一（大小写变体不再绕过双开防护）——补用例
  - 视觉掩码残留清理（`.mirror-card .sub code` 子掩码与 stability 定宽规则删除——
    已被整卡掩码覆盖，截图零变化由 linux/win32 硬比对复核）
  - ProgressRing 渐变断言去除过度钉死（色值跟随断言已本质覆盖）；XtermPane
    失败轮不链式补发自愈——补用例
  - docs/testing.md 门禁数字与配置对齐（83/59）；CI 令牌步骤更名
    `Tokens artifacts check (generated & in sync)`（措辞与真实语义一致）

### Added

- **工程护栏（CI / 覆盖率 / E2E）**
  - `npm run tokens:check`（设计令牌产物与 `tokens.ts` 逐字节对账）入 CI「Tokens drift check」步骤
    —— CI 语义 = 生成物存在且与源一致（供本地开发者自检）；生成物不入库是既有设计，
    `build` 脚本首位前置 `npm run tokens`，保证构建始终使用与 `tokens.ts` 同步的生成物
  - 覆盖率分母治理：单测 features 改 `features/**` 通配（新 feature 目录不再静默掉出分母）；
    组件 ui 桶纳入 `composables/`、`directives/`、`naive/`、`index.ts`
    （vRipple / useReducedMotion / applyAccentToDom / theme-overrides 有测试但此前不计分）
  - smoke-product 增加 **preload 模块图硬校验**（产物可加载 + API 面真实暴露）
  - Playwright `forbidOnly`（CI 出现 `.only` 直接失败，防静默缩减测试面）
  - E2E 新增两条：**「命令面板执行导航」**（搜索 → 执行 → 标题切换 + 面板收起）、
    **「设置持久化闭环」**（修改减弱动效 → 重启仍生效，落盘 → 读回 → 渲染全链路）
  - 「无 WSL 首启降级可读」E2E **评估后未做模拟**（记录理由）：Windows CreateProcess 搜索序为
    「调用方目录 → 当前目录 → System32 → Windows → PATH」，System32 优先于 PATH，
    剥离 PATH 无法抑制 wsl.exe；该路径由组件/单测层真实覆盖（stores 错误态、
    DashboardView 错误横幅、errors 目录建议文案），理由已固化在 `smoke.e2e.ts` 内注释
  - 测试稳固化：`vi.waitFor` 条件等待替代硬 sleep 与固定轮询（chokidar / 组件异步时序）

### Changed

- 组件覆盖率地板随测试补齐再次上调：ui 96/96/88/90（实测 98.99/90.58/92.86）；
  renderer **88/88/82/58 → 88/88/83/59**（独立审计修复后复测 90.22/85.23/61.12，333 用例）
- docs/testing.md 基线与门禁表同步（单测 1109 条：95.97/88.39/95.54）；
  README 测试区块补实测数字与 tokens:check 说明
- 视觉回归：系统转发表掩码收窄为数据行区域（表头 / 边框参与比对）保留；
  镜像卡掩码收窄评估后**回退为整卡**（状态可变区域使 mask 矩形漂移，宽掩码更稳——见审计修复）
- 视觉回归：smoke 补结构补偿断言（收窄区域容器必须真实可见且不塌陷）

### Security

- 等价命令引用改 **PowerShell 单引号规则**（无需引用时原样、否则 `'…'` 包裹内部双写）：
  `& % | ^ < > ( )` 等 cmd 元字符注入 / 错误展开根治；错误建议与 README 统一引导
  「管理员 PowerShell」
- 诊断包脱敏补齐：URL userinfo 单段（`scheme://token@host`）打码、`Authorization: Bearer` /
  `Proxy-Authorization: Basic` 头打码、`private_key` / `client_secret` 赋值打码
  （对齐「可安全提交」承诺）
- `isElevationError` 收窄为明确 UAC / 管理员语境：Linux 风格 `permission denied` 不再误弹
  无谓 UAC（漏判代价小于误判代价）
- IPC `patch` 深嵌套 fail-closed：深度超限一律拒绝（深层 `__proto__` 不再依赖下游兜底）
- id 安全校验唯一实现收敛（`slug.ts`，规则 id / 动作 id 同规则族）；`configKeySchema` 从
  `CONFIG_FILE_NAMES` 派生（双事实源漂移根治）；`isAppError` 类型级校验、
  `createAppError` 目录外 code 兜底不崩

## [0.1.1] - 2026-10-12

### Notes

- **0.1.1 为质量收敛版**：0.1.0 后全部修复正式发版 + 全量深读发现的 9 处缺陷根治 + 测试诚实化与盲区补齐，
  无新增功能；功能增量（引导页 / `.wslconfig` 编辑 / 文件双栏等）留待 0.2.0。
- 配置冲突三选语义：**重载**=采用磁盘、**覆盖**=写回应用内状态、**暂不处理**=保留应用内状态并清标记。
  三者在 UI 全部可达（关闭 X / Esc = 暂不处理），0.1.0 时 UI 只暴露前两者的缺口已补齐。
- 备份文件名非法字符改 `%XX` 转义（不再是统一 `_`）：`a*b` 与 `a_b` 属不同备份文件族，轮转互不误删。
- 代理配置支持「全空 = 不配置代理」的关闭态保存；`general.theme` 幽灵字段与 `accent: custom` 占位枚举已移除
  （浅色是产品策略而非配置项）。
- E2E / 视觉回归使用临时 `userData`（`WSLPILOT_USER_DATA`）：基线与冒烟不再受本机配置影响、
  也不读写真实用户数据。
- 0.1.1 x64 安装包（NSIS setup + portable）已由 Windows 原生工具链打包（WSL 经 interop 驱动），
  `win-unpacked` 原生启动冒烟通过；`win32` 视觉基线硬比对通过。

### Fixed

- **fix: headless 动作日志乱码根治 — spawnWsl 流式解码双形态**（`-e` 透传 UTF-8 / 内建 UTF-16LE / `WSL_UTF8=1`）
  - **根因**：流式 `spawnWsl` 固定按 UTF-16LE 解码，而 `wsl -d X -e program`（headless 自定义动作）与
    `WSL_UTF8=1` 环境的输出是 UTF-8 —— 日志两两并成汉字、换行被吞，任务抽屉里全程不可读
  - **修复**：首块探测（BOM / 奇数位 NUL 结构）锁定编码 + `StringDecoder` 处理跨块残缺字节与半行；
    与整段解码共用 `detectWslEncoding` 唯一事实源；stdout/stderr 各自独立探测
  - 补 UTF-8 / UTF-16LE / BOM / 奇数切分 / 小首块等待 / 半行 flush 用例 9 条
- **fix: 安装完成判定前缀误判根治**
  - **根因**：`wsl --list` 输出用 `includes(target)` 子串匹配 —— 已有 `Ubuntu-22.04` 时安装 `Ubuntu`
    会在安装真正开始前假结算「完成」并吞掉仍在进行的安装进程
  - **修复**：`parseDistroList` 精确名单匹配（大小写不敏感、兼容 `wsl --list` 简单列表与
    `--verbose` 表格两种真实输出形态）+ 安装前基线名单（装前已存在时不启用注册信号，只信进程退出）；
    补前缀碰撞、装前已存在回归用例
- **fix: 元数据合并大小写归一**（`distros:list` meta 索引 / `listWithMeta` / 动作 `startupCwd`）——
  WSL 回报大小写与 distros.jsonc 不一致时，别名 / 置顶 / 启动目录不再静默丢失
- **fix: 设置页两处 IPC 失败不再静默**：打开配置目录 / 浏览备份目录补 catch + 错误 Toast（不产生未处理拒绝）
- **fix: 详情弹窗关窗同时守卫「文件」页脏编辑**（此前只守 wsl.conf，文件页未保存修改静默丢失）
- **fix: 终端标签右键不再触发拖拽重排**（拖拽只认左键；中键关闭语义不变）
- **fix: 配置冲突 resolve 幂等**（naive 一次关闭可能先后触发 onEsc/onClose，「暂不处理」不再重复执行）
- **fix: spawn-task 看门狗兜底定时器统一清理**（kill 无响应分支的 100ms 兜底 timer 不再泄漏）
- **fix: 终端缓冲截断代理对逻辑修正**（起点为孤立低位代理时跳过；起点为高位代理时保留完整配对 ——
  旧实现方向相反，会把完整配对删成孤立低代理）
- **fix: 移除幽灵设计令牌 `gradient-custom`**（生成物与唯一事实源逐一对账并加防回归断言）
- **fix: MetricCard 关键帧样式补空行**（`npm run lint` 全量复核在 0.1.1 转红的既有 stylelint 违规，根治）
- **fix: 打开详情弹框即启动发行版根治 — 隐式启动全面封杀**（用户实测反馈）
  - **根因**：`wsl -d X -e …` 会把停着的发行版拉起来（WSL 语义）——详情弹框随挂载的
    wsl.conf 面板（display-directive=show）直接 `cat /etc/wsl.conf`，一开弹框就启动了发行版
  - **状态门禁双层**：渲染层（wsl.conf/文件面板未运行不读取、启动后自动载入、按钮同门禁）
    - **主进程硬闸** `wsl.assertRunning`——metrics 采样 / wslconf 读写 / fs 读写 / 自定义动作 /
      终端建会话五个「进发行版跑命令」入口全部先验运行状态，未运行报 DISTRO_NOT_RUNNING + 指引
  - 新增「未运行拒绝读/写/采样/开会话」测试钉；夹具全量对齐 Running 语义
- **fix: 发行版按钮语义统一 + 终端状态门禁**（用户实测反馈）
  - **颜色**：「启动」统一蓝色（此前用发行版品牌色覆盖 primary，每个发行版一个色）、「停止」统一红色；
    卡片/表格/详情弹框三处一致
  - **状态驱动按钮**：详情弹框按运行状态显示「启动/停止」（此前未运行也显示停止）；
    终端按钮（卡片/更多菜单/详情弹框）未运行即禁用并提示「请先启动」
  - **启动只能走「启动」按钮**：terminal store 硬门禁——未运行发行版拒绝开终端会话（任何入口：按钮/快捷键/
    命令面板/深链），命令面板「打开终端」只对运行中发行版出现
  - **终端页只选运行中**：新建下拉与默认目标只取 Running，自动开标签不再隐式启动发行版
  - 新增错误码 DISTRO_NOT_RUNNING（消息+建议入错误目录）；测试 +3（按钮类名/终端门禁/store 硬闸）
- **fix: 安装任务「永远进行中」根治 + 安装弹框重做**（用户三测怒评）
  - **根因**：`wsl --install` 装完会拉起发行版**首启会话并挂住不退出** → 任务永远跑着、
    弹框永远「进行中」（之前只改了进度文案，完成判定没修——属实没改到位）
  - **三层完成判定**：`--no-launch` 装完即退（常规路径）→ 老 WSL 不识别该开关自动降级重试 →
    进程仍挂时以「目标发行版已注册」（wsl --list 可观测）为完成信号结算任务；
    提权白名单 argv 同步（`--no-launch` 三处同源）
  - **弹框重做**：三步向导条（选择→安装→完成）、真实百分比/不确定态进度条、
    **实时日志尾**（下载/安装过程全程可见）、用时显示；完成态给「打开终端」直达 + 用户名/密码设置指引；
    失败态给「重新开始」
  - 测试 +3（挂住但已注册即结算 / --no-launch 降级 / argv 同步）
- **fix: 终端错位真根因 — PTY 尺寸同步丢失**（用户二测反馈「跟原来没有任何区别」）
  - 用户文本取证：所有断行恰在 **80 列**（会话创建默认 cols:80）+ 碎片带 79 前导空格 + prompt 与列表混排
    = **ConPTY 按 80 列折行重绘而 xterm 是真实宽度**——上次的 windowsPty 对策只治 reflow 伪影，
    治不了「resize 从未生效」这个真根因
  - **尺寸同步必达 + 自愈**：fit 后同步改走重试×3/记账通道；输出流间隙零成本校验尺寸漂移并自动拉齐
    （无论 resize 因何种原因丢失，下一次输出即收敛），失败有 toast 不再静默
  - Windows 真机复验：`ls -l` 长行（NetHood/PrintHood 等 110+ 字符）在真实宽度软换行、续行归零列、
    CJK 引号名完整、零 80 列硬截——用户贴文中的碎片/错排/双 prompt 混排全部消失
- **fix: 终端渲染全面增强 — 错位/丢行根治**（用户实测截图反馈）
  - **ConPTY 伪影对策（根因）**：xterm 官方 `windowsPty` 开关从未设置——文档明言缺此配置时
    ConPTY 重绘（缩放/回滚）会用空行顶掉视口并**丢失数据**（截图实证：3 行整体消失 + 1 行左半缺失）；
    现按宿主构建号启用 `backend:'conpty'` 对策（Win10 旧 ConPTY 走保守分支），新增 `pty:host` 通道上报构建号
  - **输出流竞态封死**：initialBuffer（渲染期快照）与 onData 订阅之间的窗口会丢 chunk；
    订阅移到挂载同步段 + 未决 chunk 入队按序回放（初始缓冲 → 队列 → 直写，不丢不重）
  - **fit/resize 稳定化**：同尺寸不重复 fit、ResizeObserver rAF 合并防抖、字体加载完成后复位再 fit
    （反复同尺寸 resize 触发 ConPTY 多次重绘是错位诱因之一）
  - **字体度量**：含空格字体名（Cascadia Mono）补引号防 CSS 失配回退错字体；显式 letterSpacing:0
  - **样式**：xterm.css 强制黑底覆盖为透明（底色宿主随主题）、滚动条主题化
  - Windows 真机验证：ls 宽输出行连续无缺行、拖选复制正常（实测「已复制」）；安装包已重打
- **fix: 安装进度假 0% + 新装发行版用户设置指引**（用户实测反馈）
  - **进度**：`wsl --install` 任务此前只报开头 0 与结尾 100，全程挂着假 0%（发行版已在列表里进度条还是 0%）；
    改为起手报 null（「进行中…」不确定态）+ 从 wsl 输出**机会式提取真实百分比**（输出含 % 时如实上报），
    状态栏/任务抽屉的 null 进度同步呈现「…」
  - **用户设置**：安装完成面板补「设置用户名与密码」指引（首次启动进入 UNIX 用户创建向导；
    root 下 `adduser` + `/etc/wsl.conf` `[user] default=` 路径），README 故障排查同步
- **fix: 指标单位错位 + 迷你图滥用根治**（用户实测反馈）
  - **单位**：`formatKb` 档位与换算步长错位——KB/1024 得 MB 却标 G、KB/1024² 得 GB 却标 T，
    16G 内存显示成「15.5T」、1T 磁盘显示成「1006.9T」；修正为 K/M/G/T 严格对齐，
    测试用实测值做回归锚点（此前测试把错误行为钉死）
  - **迷你图**：只有 CPU 是速率型指标、趋势线有信息量——运行中（离散计数）/内存/磁盘（存量）画曲线是平线噪声；
    曲线收敛到 CPU 负载单卡，「运行中」按设计书 §12.3 给脉冲点；metrics.history 只留 cpu（不养幽灵字段）；
    设计书线框同步实况；视觉基线双平台重生成
- **fix: 三症根治 — 终端乱码/弹框占满窗/指标全零**（用户实测反馈）
  - **终端**：全仓从未引入 `xterm.css`——xterm 内部辅助元素（测量层 / 隐藏 textarea）以正常流渲染，
    表现为终端顶部 tofu 图标行 + 重复字符行（`$$$…rrrr`）、并拦截鼠标导致拖选失效、复制误报「请先选中」；
    补引官方样式后乱码消失、拖选与复制恢复（实测「已复制」）
  - **弹框**：naive-ui `preset="card"` 不给 fallthrough class 挂 scoped 属性——`.detail-modal`/`.action-editor`/
    `.diff-modal`/`.install-modal` 的宽度规则全是死规则，弹框宽度放飞到全窗、内容高超窗；
    宽高迁移到 n-modal 的 `:style`（与 `rule-modal` 同款修法）+ `content-style` 内滚，实测 760×684 收进窗口
  - **指标**：`wsl.exe` 输出编码双形态（内建命令 UTF-16LE、`-e` 透传 Linux 程序 UTF-8），
    固定 utf16le 解码把 UTF-8 字节两两并成汉字乱码（`MEM:`→`䕍㩍…`）导致采样解析全灭、驾驶舱显示「—」；
    `decodeWslOutput` 自适应识别（BOM / NUL 图样），实测内存/磁盘/CPU 出真值
  - 新增 decodeWslOutput 编码自适应单测 4 例；安装包已重打（setup + portable）
- **fix: Windows 打包链路根治**（此前 `npm run build` 打包从未成功过）
  - Electron 精确钉版 `33.4.11`（此前 `^33.2.1` 范围版本 + workspaces 提升布局下 electron-builder 推断不出版本，直接报错）
  - `@wslpilot/{kit,shared,ui}` 移入 devDependencies（已被 electron-vite 打进 `out/`，属编译期依赖；
    留在 dependencies 会被 electron-builder 跟随 workspace 符号链接收集真实路径文件，越出 app 目录报错）
  - electron-builder `files` 显式排除 `node_modules/@wslpilot/**`（防符号链接收集回归）
  - 产物验证：`WSLPilot-0.1.0-x64-setup.exe`（NSIS，可自定义路径）+ `WSLPilot-0.1.0-x64-portable.exe`，打包版启动冒烟通过
- **fix: 高度链断裂 + UNKNOWN 吞错根治**（用户实测反馈）
  - **布局**：恢复被幽灵 CSS 清理误删的 `.h-full` 工具类（App.vue 的 n-config-provider 实际消费）——
    高度链断后 `.pilot-shell` 缩到内容高，页面下方留大片空白（空内容页视觉上像「底部占半屏」）
  - **错误诚实**：pty 启动级裸异常（如 node-pty 原生模块加载失败）映射为 `TASK_FAILED「无法启动终端会话」`+ 可执行建议
    （此前穿透 IPC 被 UNKNOWN 兜底吞成「发生未知错误」，用户无从判断发生了什么）
  - **错误诚实**：UNKNOWN 兜底 message 携带原因摘要（`发生未知错误：<detail 摘要>`），线索不再只藏 detail 字段
  - 视觉基线随布局修正重新生成（linux/win32 双平台）
- **fix: 全量审计根治**（40+ 项，逐条根治并钉回归测试）
  - **主进程诚实性**：`removeRule` 区分「查询失败」与「确为空」（此前查询失败被误报「已无监听」假成功）；
    `applyOne` delete-then-add 失败时回滚恢复旧监听（此前 add 失败即毁掉原有可用转发），回滚失败给出手动恢复命令行；
    `applyAll` 汇总按规则计数（此前按错误消息数，批量取消 1 条消息= N 个规则少报）且进度封顶 99 直到提权批处理落定（此前假满格）；
    `sampleMetrics` 失败抛错（此前返回全零被当成功样本污染 CPU 均值分母）；`getVersion` 双命令失败如实抛错；
    备份 `rotateBackups`/`cleanupBackups`/`listBackups` 三方语义统一为规范备份名 + 实际删除数；
    导出仅在默认备份目录做轮转（此前导出到 Downloads 也会按保留份数静默删文件）；
    inPlace 导入不再打周期假 0% 进度；`rollbackImport` 大小写归一；meta 读写大小写归一（换大小写不再产生重复条目）
  - **渲染可用性**：编辑转发规则改 id 改为真重命名（此前静默新建一条、旧规则残留）；「重启并安装」补 await/catch；
    全局快捷键输入上下文守卫（此前终端内 Ctrl+K/N/R/1-9 被劫持）；`network`/`devices`/备份列表/设置 load 失败
    补错误态（此前静默或伪装空态）；wsl.conf 脏数据保护（此前切发行版静默丢弃未保存编辑）；
    命令面板「全部关机」补确认、「查看发行版」真正打开详情弹窗、失败命令不进「最近使用」；
    终端无会话时清屏/复制/导出禁用；任务抽屉选中项被淘汰时自动回退；XtermPane 主题热更新（此前改主题已开标签不生效）；
    迁移完成「打开所在目录」修正为打开目标目录本身；UDP 行「从系统移除」禁用；代理 override 摘要展示
  - **契约清理**：`@shared/*` 深路径导入统一为 `@wslpilot/shared` 单一入口（29 文件，别名配置移除）；
    `distros.uninstall`→`distros.unregister`、`app:exportDiagnostics/openLogsDir`→`diagnostics:exportPackage/openLogsDir`
    通道与 API 动词对齐；`metrics:sample` 的 `*` 魔法键拆出 `metrics:overview` 通道；`meta.get` 接线元数据编辑预填；
    preload 返回类型精度化（PtySessionInfo 含 cwd/createdAt、cleanupBackups keep 可选、save 返回精确类型）；
    死契约 `ElevationResult` 与死导出清理；uiState 幽灵字段（lastSelectedDistro/activeView/tableSort）移除；
    Sparkline gradient id 实例化（多实例同值串色）
  - **配置冲突写保护**：冲突未决期间 `patch/update/replace` 拒绝写（此前静默覆盖外部修改并清除冲突标记）
  - **渲染层生产壳**：App.vue 补 `n-notification-provider`（此前 NetworkView 真实调用 `useNotification` 即抛、路由页白屏；
    组件测试把 useNotification 整个 mock 掉导致测试全绿而生产不可用——测试替生产撒谎，已补真 provider 链守卫测试）
  - **文档一致**：CONTRIBUTING 诊断包说法、husky/commitlint 幽灵工具链、设计令牌唯一事实源（shared/src/tokens.ts）、
    npm@12/master 分支、工程结构树按实际目录重画、M7 签名/更新接入状态、四标签详情、`advanced.autoUpdate` 契约补全、
    README 补文档索引/测试/故障排查、testing.md 覆盖率豁免修正（共 27 项）
  - **测试假信心**：task-runner 恒真断言/settle 后 report 语义、elevation-client 清理断言改真实 fs 观测、
    infra 占位断言、usbipd 常量自比对、clamp 用例补范围断言、`[{extra:1}]` strip 断言、桥名 `wslAPI` 断言、
    未 await 的 run(ctl)、tray 硬编码通道字面量（共 10 项）
  - **CI 门禁**：`.prettierignore` 补齐（format 不再扫 coverage/生成物）；release.yml 补 e2e 门禁；
    build-arm64 补 lint/format/coverage/smoke；component 覆盖率分母纳入 renderer 全部 .vue（此前 70% 数字不含 UI 层，
    两档诚实地板：ui 96/88/81、renderer 84/80/47）；`tsconfig.tools.json` 消除根配置 typecheck 盲区；
    electron.vite 三端 alias 策略统一；`@kit/*` 死路径移除
  - **视觉回归**：基线按平台分文件（`{arg}-{platform}.png`）随仓库入库（linux/win32 各 4 张），
    `updateSnapshots: 'none'` 硬门禁（此前 `'missing'`+基线未入库=每次 CI 自动造基线放行、从未真实比对）；
    CI 补基线 artifact 取证步骤
- **全量 review 根治（正确性 / 数据安全 / 幽灵配置 / 半成品 / 测试假信心清零）**
  - **数据安全**：备份命名 `%XX` 无碰撞转义（此前 `*`→`_` 会把 `a*b` 的轮转落到 `a_b` 的备份族，错删数据）
  - **数据安全**：`.vhd` 扩展名归一为 `.vhdx`（此前导出的 `.vhd` 备份永远不进列表/轮转，成幽灵文件）
  - **数据安全**：诊断包导出改原子写（此前截断写可毁掉用户已有的同名诊断包）；`atomicWrite` 支持二进制 Buffer
  - **提权助手**：Start-Process 参数元素自带双引号（此前含空格路径（`C:\Users\John Doe\…`）被子进程拆开，提权全链路失效）
  - **提权助手**：helper.ps1 写盘带 UTF-8 BOM（PowerShell 5.1 无 BOM 按 ANSI 解码，脚本非 ASCII 内容静默变乱码）；清理失败不再顶掉返回值
  - **提权助手**：失败提示不再指向不存在的「以管理员身份重试」按钮（幽灵 UI 文案）；`network:applyAll` 真正合并一次 UAC（此前逐条各弹一次）
  - **更新器**：`feedUrl` 从 `getFeedURL` 回填（字段与接口成员双幽灵）；开发模式误判收窄（此前打包后 publish 配置损坏被谎报为「开发模式」）
  - **usbipd**：`--version` 失败如实报「已安装但异常」+ 错误详情（此前一律报未安装，误导用户重装）
  - **输出解码**：GBK 探测改 fatal，降级链（gbk → windows-1252 → latin1）真正可达（此前西欧码页输出被硬解成 GBK 乱码）
  - **终端**：粘贴超 256KB 按码点分片发送（此前被 zod 拒绝后输入静默丢失 + unhandled rejection）；resize 夹紧 schema 上限；输入/同步失败有提示
  - **撤销**：删除撤销失败时保留撤销缓冲可重试（此前先清缓冲再回写，失败=被删项永久丢失）；调用方补错误处理
  - **冲突处理**：UI 补齐第三选项（X/Esc = 暂不处理），`ignore` 契约不再半成品；错误目录文案去掉不存在的「对比」按钮
  - **元数据编辑**：图标/品牌色/启动目录/置顶/快捷动作全字段可编辑（此前只开放 3 个字段，其余被动回写）；`meta.pinned` 真正生效（置顶排序 + 开关）
  - **动效降级**：强调色过渡不再顶掉 reduced-motion（此前同特异性后写覆盖全局降级规则）
  - **焦点**：CodeEditor 补 Esc 逃生口（Tab 被编辑器捕获，纯键盘用户被困）；命令面板 Tab 焦点陷阱（aria-modal 语义义务）
  - **并发**：终端 `openOrActivate` 同名去重（此前 query 快速切换可双开同一发行版）
  - **幽灵清理**：`settings/devices/network.loaded`、`distros.lastRefreshAt`、`pinned` 死 getter、
    `update.attached/errorAt/lastError`、路由 `meta.icon`、`.fade-in/.slide-up-in` 与整套未用工具类、
    `.glass/.pilot-body/.pilot-content` 全部移除或接线（`meta.title` 接 document.title）
  - **文案**：发行版页「点击卡片可启停」改为真实交互描述；文件编辑器上限提示改为真实常量；E2E 侧栏文案漂移（`备份与迁移`→`备份迁移`）修复

### Added

- **测试诚实化与盲区补测（0.1.1）**：约 30 条新用例 + 5 条假信心用例重写
  - 假信心清零：EPERM 重试真实注入（`vi.spyOn(rename)`）、代理对用例构造可达、预留通道路径恒真断言移除、
    孤儿缓冲淘汰真断言 + 模块级状态逐用例隔离、组件 mock 契约补全（`config.get` 返回完整 ConfigMap、
    `network`/`devices` 命名空间、dialog 确认可回放 —— 此前 NetworkView 确认链路组件层从未执行）
  - 盲区补齐：迁移提权成功/失败、批量提权回滚旧监听与 UAC 取消、导入后置检查、嵌套迁移拒绝、
    chokidar 解析失败 / 等价吸收 / 监听器容错三态、wsl.conf 未运行门禁与 diff 渲染、
    SettingsView 关键 setter 落盘逐项对账、TaskDrawer 取消成功 / 键盘选择 / 空态、
    命令面板最近使用渲染、PortForwardForm 新建保存、NetworkView 确认后真实执行与代理串行
- **E2E 隔离与冒烟补强**：临时 `userData`（`WSLPILOT_USER_DATA`）隔离（不读写真实配置、不受本机设置影响）；
  冒烟补发行版页与文档标题断言；侧栏定位收敛 `aside.sidebar`
  （真实 WSL 环境下页面同名按钮不再触发 strict-mode 冲突）；Linux 视觉基线在隔离后复跑一致
- **视觉回归稳定化（双平台基线重生成）**：动态源全量 mask 补全（时段问候语 / hero 统计行 /
  系统转发表 / Windows 代理状态 / `.wslconfig` 真实路径 / 版本号）+ 截图期盒尺寸固定
  （`visual-stability.css`：动态文本宽度铺满、指标值固定高度、卡片网格固定高度）——
  根治「内容变化 → mask 边界漂移 / 下方版式位移」造成的视觉假红；
  win32 基线在 Windows 侧重新生成并硬比对通过，linux 基线同步重生成

### Changed

- 无障碍：任务抽屉列表项键盘可达（Enter/Space 选中）；设置页配置标签支持 Space 激活；
  命令面板「最近使用」对辅助技术隐藏重复项（`aria-hidden` + `tabindex=-1`，不再重复暴露 option）
- 组件覆盖率地板随实测上调：renderer 84/80/47 → **85/80/52**（实测 87.90/82.51/54.69，221 用例）
- docs/testing.md 基线同步（单测 95.7/88.0/95.3；组件两档实测与地板更新）
- `general.theme` 从 settings.jsonc 移除（产品策略「只用亮色」不是可写配置）；`accent` 枚举去掉无实现的 `custom`

### Security

- 测试诚实化：5 条恒真 / 不可达用例重写为可失败断言（EPERM 重试、代理对截断、预留通道、
  孤儿淘汰、NetworkView 确认链路）——改坏实现必红
- 测试补齐提权委托链（4 服务）、M7 handler 体、preload 退订/降级契约、备份命名碰撞等回归——
  此前多处「断言不观测行为」的假信心用例已改为可观测断言

## [0.1.0] - 2026-10-10

### Notes

- 配置冲突三选语义（本版根治）：**重载**=采用磁盘、**覆盖**=写回应用内状态、**忽略**=保留应用内状态并清标记（UI 暂只暴露前两者）。
- `wsl --manage --move` 需 WSL 2.0+；不支持时给出 `wsl --update` 建议。迁移前自动备份失败会中止迁移（安全兜底）。
- 就地导入（`--import-in-place`）失败时**不自动回滚**，避免误删用户源 vhdx；归档导入失败自动 `wsl --unregister` 回滚不完整注册。
- wsl.exe 的标准输出统一是 UTF-16LE（含 `-e` 透传），`exec-wsl` 保持该解码模型不变；`reg.exe`/`netsh`/`usbipd` 等控制台工具走 `kit/tool-output` 的编码探测。

### Fixed

- **全量 review 根治（正确性 / 幽灵配置 / 半成品 / 测试假信心四类清零）**
  - **数据安全**：导出失败/取消不再留下半截归档——自动删除残档并把被改名保留的原文件还原（此前会静默毁备份）
  - **数据安全**：超限截断的文件禁止在线编辑与写回（此前保存会把前缀整文件覆盖，静默截断原文件）
  - **数据安全**：迁移目标与当前位置存在「相同或互为子目录」时拒绝执行（此前可把发行版移进自己的子目录）；注册表读不到位置时中止而不是跳过校验
  - **数据安全**：覆盖保护的保留副本改用规范备份命名，进得了备份列表与轮转（此前是永远删不掉也看不见的幽灵文件）
  - **配置正确性**：`config:update` 只写「真正改动的叶子」，不再用内存全量覆盖外部编辑过的字段，也不再顺手清掉冲突标记
  - **配置正确性**：迁移写盘改为逐叶子 diff（此前只写顶层新键，嵌套新增值不落盘却盖了版本章）
  - **配置正确性**：`resolveConflict('ignore')` 与 `'reload'` 语义区分（此前三选一只做出两种行为）
  - **配置正确性**：chokidar 路径比对归一化大小写/分隔符；自写哈希改环形缓冲，连续两次快速写不再产生假冲突弹窗
  - **长任务**：`dispose()` 后协作风控不再失明（此前退出窗口里的重活会继续跑出残局）；排队中任务被取消立即结算（此前要等锁前一个跑完）
  - **长任务**：`netsh portproxy` 应用改为 delete-then-add（幂等、改端口不残留）；「从系统移除」幂等（已无监听不再报错）
  - **终端**：`waitExit` 对已退出会话返回退出码而不是 reject「会话不存在」；双击重命名改行内输入（Electron 未实现 `window.prompt`）；拖拽排序的 window 监听器卸载时清理
  - **注册表**：`reg.exe` 输出改走编码探测（此前硬编码 UTF-16LE，中文环境乱码会让 GUID/BasePath 全部失配）
  - **文件桥**：短读按 `bytesRead` 裁剪（此前补零会把纯文本误判成二进制）
  - **生命周期**：`will-quit` 清理注册提前到服务创建后（此前 loadURL 挂起期间退出不做清理）；窗口被销毁后可经托盘/activate 重建（此前是「有托盘、开不出窗口」的僵尸）
  - **usbipd**：`attach --distribution` 不存在时自动退回默认发行版；`list` 失败给专属建议；attach 补发行版名校验
  - **发行版列表**：补齐 Lxss 深层信息（GUID / BasePath / DefaultUid）——迁移向导此前永远显示「注册表信息不可用」
- **幽灵配置全部落地**
  - `autoRefreshOnStart` 真正关掉轮询（此前只挡首刷，与提示语矛盾）
  - 21 个设置 setter 统一「乐观更新 + 失败回滚 + Toast」（此前落盘失败静默失效、UI 与磁盘分叉）
  - 侧栏折叠状态持久化到 `ui-state.jsonc`（此前重启即弹回）
  - 代理「写入脚本」改为串行「保存 → 写入」（此前并行会把旧代理写进发行版）
  - 导入向导重名硬拦截（此前只警告不拦截，任务必然失败）
  - 文件编辑器脏数据离开前确认（此前无提示丢失）
  - 错误建议文案不再指向不存在的「一键安装 WSL」按钮
- **测试假信心结构性根治**
  - 契约四方对账：`handler 注册表` 与 `INVOKE_CHANNELS` 集合相等断言（此前新增通道漏 handler 所有测试全绿）
  - preload 契约测试校验**返回值透传**与 **API 面枚举**（此前删掉 `return` 也能全绿、新增方法无提醒）
  - 覆盖率门禁覆盖面扩大到 `preload/`、`features/network/`、`config-migrations`（此前约 40% 真实逻辑永不参与评分）
  - 导航安全守卫抽成可测模块并补绕过用例（`file:` / `javascript:` / 大小写变体）
- **回验自查根治 5 处**（`1b9924f`）
  - 文件浏览器 `goTo` 改「先确认再改状态」：此前先改 path 再弹确认，点「留在此页」后面包屑与列表不一致
  - 终端标签重命名 `commitRename` 先判 `renamingId` 短路：此前 Enter 提交后输入框卸载的 blur 重复 emit，Esc 也会误改名
  - 重命名输入框聚焦选择器修正（此前 class 挂在 n-input 包裹层，选择器打不到内层 input）
  - `registry.listAll` 改单遍 `readAll` + 30s TTL 缓存（此前 `listGuids` 后又全量查询，`distros:list` 5s 轮询会打爆注册表）；安全校验类强制 fresh
  - 删除 `makeDebouncedSetter` 自管回滚（与 store 回滚叠加会写反），回滚单一来源归 store `persistField`
  - 新增组件回归测试 8 项锁死上述 bug；补 `distros:list` 注册表补齐 3 项覆盖（此前新逻辑零覆盖）

### Added

- **M7 打磨发布**：动效完善、空状态与骨架屏、无障碍、诊断包、提权助手、代码签名、自动更新
  - **动效完善**（§13.2 关键交互动效清单）
    - 按钮涟漪（`v-ripple` 指令）+ 按压缩放；卡片悬浮上浮/光晕；状态点呼吸脉冲；指标数字滚动递增
    - 路由切换淡入上移；抽屉/模态背景模糊；命令面板玻璃拟态下弹（`palette-pop`）
    - 列表增删 FLIP（端口转发表 `transition-group`）；终端标签缩放淡出 + 排序位移插值
    - 强调色切换 300ms 全局平滑过渡；Toast 右侧滑入；进度环渐变描边
    - 全部动效响应 `prefers-reduced-motion` 与设置「减弱动效」（全局降级为即时切换）
  - **空状态与骨架屏**（§12.8）：Skeleton 流光组件（不再用转圈表示加载）；空态统一「插画 + 一句话 + 主 CTA」
    （无发行版→安装、无转发规则→新建、无搜索结果→清除筛选）；文本行骨架用于列表加载
  - **无障碍**（§11.4）：「跳到主内容」跳转链接；模态焦点管理与关闭后焦点归还（命令面板 combobox /
    `aria-activedescendant` / listbox 语义）；状态栏 `role=status` + `aria-live` 任务播报；骨架屏 `aria-busy`；
    图标按钮 `aria-label` 全覆盖；危险操作图标 + 文字双编码；焦点环全局可见
  - **诊断包**（§15.3）：「打开日志目录」+「导出诊断包」（设置 → 关于）
    - 打包近期日志（限量限体积）+ 配置**脱敏副本** + 环境信息（manifest.json）为 zip
    - 脱敏规则唯一事实源：主目录（含 JSON 转义形态、大小写/分隔符变体，带路径边界防前缀碰撞）→
      `%USERPROFILE%`；URL 凭据与密钥类赋值打码；内置极简 ZIP 写入器（DEFLATE + CRC32，零新依赖）
  - **提权助手 ElevationHelper**（§14.3）：主进程保持非提权，独立提权进程按需 UAC 执行
    - 结构化请求白名单（`netsh.portproxy.add/delete` · `usbipd.bind/unbind` · `wsl.move/install/setVersion`），
      op → program/argv 唯一映射（参数数组，无 shell 拼接）；Helper 脚本对 op/program 二次校验（纵深防御）
    - 批量请求合并为一次 UAC 会话；取消 UAC → `PERMISSION_DENIED` + 等价命令行（可复制到管理员终端）
    - 服务层接线：netsh 转发 / usbipd 绑定 / 迁移磁盘 / 安装 / 版本转换在直接执行被拒时自动改走提权助手
  - **代码签名**（§17）：electron-builder `signtoolOptions`（sha256）+ `verifyUpdateCodeSignature`；
    证书经 `CSC_LINK` / `CSC_KEY_PASSWORD` 注入（release.yml 已接线 Secrets）
    - `app:signatureStatus`：检测当前可执行文件 Authenticode 状态；「设置 → 关于」展示签名/证书主题，
      未签名时给出 SmartScreen 警告说明（不吓用户、可执行）
  - **自动更新**（§17）：electron-updater 完整接入（GitHub Releases 更新源，`publish` 生成 app-update.yml）
    - 启动后台检查（`advanced.autoUpdate`，可关闭）；「设置 → 关于」检查 / 下载 / 重启安装
    - `autoDownload=false`（不偷偷下大文件）+ `autoInstallOnAppQuit=true`；`update:changed` 事件推送状态
  - **视觉回归**（§16）：Playwright 截图对比（驾驶舱 / 设置 / 网络 / 命令面板），动态区 mask、
    `updateSnapshots: 'missing'` 首跑生成基线；`npm run test:visual`
- **M6 网络与设备**：端口转发、镜像网络模式引导、代理配置、usbipd 设备面板（网络与设备面板）
  - **端口转发**（声明式规则 + `netsh interface portproxy` 应用）
    - 规则 CRUD 落 `network.jsonc`（id 白名单执行：渲染层只传 id，参数永不进命令行）；启用/停用开关、删除可撤销
    - 「应用 / 全部应用 / 从系统移除」长任务（流式日志 + 等价命令行 + 可取消）；netsh 写类全局串行锁
    - 系统对照表：读取 `netsh interface portproxy show all`，逐条标注「已生效 / 指向不同 / 未生效」
    - `udp` 规则仅记录意图（netsh portproxy 只支持 TCP），应用时显式跳过并在界面标注
    - 提权失败 → `PERMISSION_DENIED` + 等价命令行（可复制到管理员终端执行；ElevationHelper 属 M7）
  - **镜像网络模式引导**：检测 `%UserProfile%\.wslconfig` 的 `[wsl2] networkingMode`
    - 非 `mirrored` 时展示「推荐」提示卡（一键复制配置片段 + 打开所在目录 + 8 秒生效说明）
    - `mirrored` 时提示无需端口转发，减少误配置
  - **代理配置**（`network.jsonc.proxy` 为真相源）
    - 「跟随 Windows 系统代理」读取 HKCU `Internet Settings`（ProxyEnable / ProxyServer）作兜底，本地显式值优先
    - 「写入代理脚本」把生效代理落成发行版内 `/etc/profile.d/wslpilot-proxy.sh`（root tee + stdin，内容不经 shell）
    - 可查看脚本原文 / 清除脚本；写入前预览将要生成的内容
  - **USB 设备（usbipd，可选）**：设备表（BUSID / VID:PID / 描述 / 状态徽章）
    - 「共享」= `usbipd bind|unbind`（需管理员，长任务）；「附加」= `usbipd attach --wsl`（usbipd 2.0+，免提权）
    - 未安装 usbipd 时给 `winget install usbipd` 安装引导 + 一键复制，不阻断其它功能
  - 主进程 `NetworkService` / `UsbipdService`；IPC `network:*` / `devices:*` 共 13 个通道（契约先行的
    `network:apply` 预留项已交付，预留清单清零）
  - `kit/tool-output.ts`：Windows 控制台工具输出编码探测（UTF-16LE NUL 结构 → 严格 UTF-8 → GBK 回退），
    中文报错不再乱码、错误映射可靠
  - 侧栏新增「USB 设备」；命令面板补齐网络 / USB 设备导航项
- **M5 配置与动作**：wsl.conf 编辑、注册表详情、自定义动作、命令面板（配置中心化 + ⌘K）
  - **wsl.conf 编辑**：`/etc/wsl.conf` 可视化表单 + 原始文本双模式，逐键最小编辑保留注释
    - 表单覆盖 automount / network / interop / user / boot 全部常见键；未知键只展示不吞掉
    - 写入前 Diff 预览（LCS 行级差异）；写入走 `wsl -d <name> -u root -e tee /etc/wsl.conf` + stdin（内容不经 shell）
    - 8 秒规则提示；`wsl.autoShutdownAfterConfigChange` 开启时保存后自动 terminate 使配置生效
  - **注册表详情**：Lxss 完整信息（GUID / BasePath / DefaultUid / Flags / 原始键值），GUID 与安装位置一键复制
  - **自定义动作**（actions.jsonc 白名单执行）：
    - 动作卡片一键运行 + 等价命令展示；`confirm` 动作执行前二次确认（含等价命令）
    - 动作 CRUD（新建 / 编辑 / 删除）+ 删除 Toast「撤销」
    - 变量占位符 `${distroName} ${startupCwd} ${home} ${user}` 主进程安全替换（${home}/${user} 运行前探测）
    - `terminal: true` 动作复用临时 PTY（会话自动收编进终端工作区，可交互、可取消）；headless 动作流式日志进任务抽屉
  - **命令面板 ⌘K 全量升级**：模糊匹配（自研打分：连续/词首/前缀/缺口）、前缀模式（`> ` 命令 · `@ ` 发行版 · `# ` 设置）、
    分组（动作 / 发行版 / 导航 / 设置项）、快捷键提示（Kbd）、最近使用（持久化 ui-state.recentCommands）
  - **发行版内文件**：`\\wsl.localhost` 桥（readDir / read / write / revealInExplorer）+ 详情页「文件」标签
    （面包屑、目录列表、文本在线编辑保存、资源管理器定位）；路径校验拒绝 `..` 逃逸与非法字符
  - 发行版详情弹窗标签页化：概览（注册表详情）/ 配置 / 动作 / 文件
  - 全局快捷键补齐（§11.5）：`Ctrl/⌘+K` 面板 · `Ctrl/⌘+N` 新终端 · `Ctrl/⌘+,` 设置 · `Ctrl/⌘+R` 刷新 ·
    `Ctrl/⌘+Shift+P` 等价命令行开关 · `Ctrl/⌘+1…9` 切换终端标签；设置页新增「快捷键」一览
  - 设置 → WSL：默认 Shell、wsl.conf 变更后自动终止策略
  - UI 组件：CodeEditor（行号 + Tab 缩进）、Kbd（快捷键提示）
- **质量根治（全量 review 清零）**
  - 全站错误提示修复：统一 `describeError/errorLine`，AppError（纯对象）不再被 `instanceof Error` 误判吞掉
  - 配置安全：损坏 JSONC 拒绝写回、`patch({})` 不清空文件、嵌套 `__proto__` 拒绝、`z.record` 逐键清洗、版本戳不再"说谎"
  - 备份命名/轮转往返修复（全部非法字符替换 + 正则同源）
  - 长任务：无输出看门狗（10 分钟）、settle 幂等、取消与完成竞态修正（exit 0 优先成功）、记录限量
  - 生命周期：bootstrap 全局异常兜底、窗口防抖 timer 清理、config 监听器隔离、退出前 flush 落盘
  - **安装发行版向导**（`wsl --list --online` + `wsl --install`，进度/取消）
  - **全局命令面板 Ctrl/⌘+K**（导航 / 发行版 / 动作即输即搜）
  - 发行版详情弹窗（GUID/安装位置/元数据编辑/注销），「查看详情」不再是伪跳转
  - 驾驶舱快捷操作全部接通（安装 / 备份 / 清理旧备份 / 网络）
- **M4 备份迁移**：导出 / 导入 / 迁移完整 IO 能力，长任务带进度、日志与取消
- TaskRunner：任务生命周期、进度事件（`task:progress`）、取消（kill 子进程）、同发行版写任务串行锁、`state.jsonc.lastTaskResult` 落盘
- IoService：`wsl --export`（tar / `--vhd`）、`wsl --import`（`--version` / `--vhd`）、`wsl --import-in-place`、`wsl --manage --move`
  - 进度估算：源体量（ext4.vhdx / 目录统计）对比目标文件增长；无法估算时 `percent = null`
  - 备份命名 `<name>_<YYYYMMDD-HHmmss>.<ext>` + 按 `backup.keepRecent` 自动轮转
  - 破坏性操作（迁移）前自动备份（`backup.autoBackupBeforeDestructive`）
  - 路径校验：控制字符 / 空路径拒绝；`%USERPROFILE%` 环境变量展开
- 备份迁移向导 UI（BackupView）：三模式（导出 / 导入 / 迁移）× 四步（选择 → 位置格式 → 确认 → 进度）
  - 大号渐变环形进度（ProgressRing）+ 实时日志抽屉 + 一键取消
  - 确认步骤展示等价命令行（`advanced.showRawCommand`）；迁移需勾选「我已知晓」（`advanced.confirmDestructive`）
  - 最近备份列表（体积 / 格式 / 时间）
- 设置 → 备份：默认目录、默认格式、保留份数、破坏性前自动备份
- 原生文件对话框通道（`app:pickDirectory / pickSaveFile / pickOpenFile / openPath`）
- 驾驶舱快捷操作「📦 备份」直达备份迁移页

- **M3 终端**：node-pty + xterm.js 多标签终端工作区
- PtyManager：会话池（上限 10）、`wsl.exe -d … -e shell` 参数数组、ConPTY、退出统一 kill
- 终端 UI：标签栏（新建/重命名/拖拽排序/中键关闭）、工具栏（清屏/搜索/字号/复制/导出）、状态栏（光标/UTF-8/会话时长）
- 明亮终端主题，与浅色应用协调
- 设置 → 终端：字体/字号/光标样式/闪烁/回滚缓冲
- 驾驶舱与发行版卡片「终端」按钮直达指定发行版会话

- **M2 驾驶舱**：`wsl --list --verbose` 解析、发行版列表（卡片/表格）、指标卡、启停、设默认
- WslService：list / start / terminate / shutdown / setDefault / getVersion / sampleMetrics
- MetricsService：Running 发行版并发采样、驾驶舱全局概览
- RegistryService：Lxss 注册表只读（GUID / BasePath / DefaultUid），失败降级
- 发行版元数据 meta:get / meta:set（distros.jsonc）
- UI 组件：DistroCard、MetricCard、StatusDot、Sparkline
- 驾驶舱真实数据 + 快捷「全部关机」+ 轮询（失焦暂停）
- 发行版中心：搜索 / 标签筛选 / 卡片网格 / 紧凑表格

### Added (M1)

- **M1 工程骨架**：npm workspaces monorepo（shared / kit / ui / desktop）
- 设计系统：设计令牌、Naive UI 主题适配、浅色「极光」主题、四种强调色
- ConfigService：JSONC 读写、原子替换、备份轮转、zod 校验、版本迁移链
- Electron 安全基线：contextIsolation、sandbox、IPC 白名单、禁止新窗口
- 可运行外壳：标题栏、可折叠侧栏、驾驶舱、设置页（强调色实时切换）
- 系统托盘菜单（显示/隐藏、设置、退出）
- 隐藏系统默认菜单栏，使用自绘无边框标题栏
- NSIS 安装包（支持自定义安装路径）与 portable 免安装版
- 单元测试（解析 / schema / 迁移 / 错误码）与 CI 工作流

> M1–M7 已全部交付；版本序列自 `0.1.0` 起步并保持 `0.x`（**永不发布 `1.0.0`**）。
