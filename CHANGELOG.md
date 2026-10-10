# Changelog

本项目遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，
版本号遵循 [Semantic Versioning](https://semver.org/lang/zh-CN/)。

> **版本号策略**：序列自 `0.1.0` 起步并保持 `0.x`，**永不发布 `1.0.0`**。

## [Unreleased]

### Notes

- 配置冲突三选语义：**重载**=采用磁盘、**覆盖**=写回应用内状态、**暂不处理**=保留应用内状态并清标记。
  三者在 UI 全部可达（关闭 X / Esc = 暂不处理），0.1.0 时 UI 只暴露前两者的缺口已补齐。
- 备份文件名非法字符改 `%XX` 转义（不再是统一 `_`）：`a*b` 与 `a_b` 属不同备份文件族，轮转互不误删。
- 代理配置支持「全空 = 不配置代理」的关闭态保存；`general.theme` 幽灵字段与 `accent: custom` 占位枚举已移除
  （浅色是产品策略而非配置项）。

### Fixed

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

### Changed

- `general.theme` 从 settings.jsonc 移除（产品策略「只用亮色」不是可写配置）；`accent` 枚举去掉无实现的 `custom`

### Security

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
