# Changelog

本项目遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，
版本号遵循 [Semantic Versioning](https://semver.org/lang/zh-CN/)。

> **版本号策略**：序列自 `0.1.0` 起步并保持 `0.x`，**永不发布 `1.0.0`**。

## [0.1.2] - 2026-10-12

### Notes

- **0.1.2 为第二轮质量收敛版**：全量深读缺陷根治 + 工程护栏加固，无新增功能；
  功能增量（引导页 / `.wslconfig` 编辑 / 文件双栏等）留待 0.2.0。
- 修复主题：数据安全（跨发行版串写 / 丢编辑 / 守卫旁路 / 编辑残留）、并发（写队列 / 代际 /
  名额预留 / 取消透传）、门禁一致性（隐式启动封杀补全）、安全（命令注入 / 脱敏 / 提权误判 /
  IPC 纵深防御）、健壮性（日志 / 压缩 / 原子写 / 缓存 / 编码）、UI 体验（全局错误兜底 /
  无障碍 / 令牌化）、工程护栏（CI / 覆盖率分母 / E2E / 视觉掩码）。
- 实测：单测 1069 条（lines 95.88% / branches 88.2% / functions 95.48%）、组件 318 用例
  （ui 桶 98.99/90.58/92.86 → 地板 96/88/90；renderer 桶 90.15/84.82/60.82 → 地板 88/82/58）、
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

### Added

- **工程护栏（CI / 覆盖率 / E2E）**
  - `npm run tokens:check`（设计令牌产物与 `tokens.ts` 逐字节对账）入 CI「Tokens drift check」步骤
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

- 组件覆盖率地板随实测上调：ui 96/96/88/81 → **96/96/88/90**（分母扩展后重测
  98.99/90.58/92.86）；renderer 85/85/80/52 → **88/88/82/58**（实测 90.15/84.82/60.82，318 用例）
- docs/testing.md 基线与门禁表同步（单测 1069 条：95.88/88.2/95.48）；
  README 测试区块补实测数字与 tokens:check 说明
- 视觉回归掩码收窄：系统转发表整表 → 仅数据行区域（表头 / 边框参与比对）、
  镜像卡整卡 → 状态徽章 / 路径行 / 状态正文三个具体动态元素；smoke 补结构补偿断言
  （收窄区域容器必须真实可见，样式崩坏不再被掩码掩盖）

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
