# WSLPilot 0.1.4 durable work record

- Intent: fully implement `docs/plan-0.1.4.md` WP0–WP5 with no omissions/half-finished paths.
- Baseline: `v0.1.3` (`7b3dd05`), clean worktree, WSL 3.0.3 / kernel 6.18.54.1-1 / wslc 3.0.3.
- Scope fence: no wslc management, no Electron upgrade, no commit/tag/push/publish without explicit authorization.
- Success evidence: full gates + real-machine WSL 3.0.3 + version-gated legacy simulations + docs.
- Stop states: done | blocked | needs-verification | scope-exceeded.

## Todo map

- [x] WP0 回滚/终端/锁/导出语义
- [x] WP0 P1 编码/INI/契约/退出/对话框/死路
- [x] WP1 能力矩阵
- [x] WP2 存储与身份（resize 虚拟容量硬门禁）
- [x] WP3 配置面
- [x] WP4 安装与备份
- [x] WP5 测试/覆盖率/发布校验/文档
- [ ] 真机与全量门禁（自动门禁已过；shutdown 后成功路径、Windows 0.1.4 产物未在本会话复验）

## Evidence（2026-10-25）

- `npm test` 1,252 passed；`npm run test:coverage` lines 94.96 / branches 87.47 / functions 94.39，
  per-glob thresholds pass；`npm run test:component` 374 passed（per-glob thresholds pass）；
  `npm run test:e2e` 4 passed；`npm run lint` 0 errors；`format:check`、`typecheck`、`tokens:check`、
  `smoke:product` pass。
- 真机：3.0.3 能力探测 `source=help` 全 flag；tar.gz import/export；compact；报废发行版均注销清理。
- Windows 原生打包（本会话已重建）：通过 Windows Node 在 `C:\Temp\WSLPilot-pkg-014`
  执行 `npm ci` / `npm run build` / `npm run package`，产出
  `WSLPilot-0.1.4-x64-setup.exe`、portable、latest.yml、blockmap，并复制回
  `apps/desktop/release`；Windows 上 `scripts/verify-release.mjs --allow-unsigned
--require-artifacts --tag v0.1.4` 通过（setup sha512 一致，portable 不参与自动更新；
  签名 NotSigned 已显式放行）。打包后的 `win-unpacked/WSLPilot.exe` 冒烟启动成功。
- 未完成：安装包未签名且未设置 `publisherName`；未执行 resize / set-default-user / set-sparse
  在 `wsl --shutdown` 后的成功路径。
  原因：本会话运行在 WSL 内，shutdown 会杀死自身（已发生一次）；错误路径与 UI 指引已覆盖，
  需要在 Windows 侧人工执行 `docs/testing.md` 的 0.1.4 清单。

## Baseline facts verified

- `wsl --help` on 3.0.3: has compact/resize/set-default-user/location/vhd-size/fixed-vhd/format/from-file; no rollback.
- `wslc version` → 3.0.3.0.
- `.wslconfig` docs: [general] instanceIdleTimeout/distributionInstallPath; networkingMode none/nat/bridged/mirrored/consomme; autoMemoryReclaim dropCache.
- `wsl.conf` docs: automount ldconfig/cgroups; boot protectBinfmt; gpu; time.
- `--export --vhd` still accepted on 3.0.3; `--format` supports tar/tar.gz/tar.xz/vhd.

## Incident / corrected assumption（2026-10-25）

- 在 WSL 内执行 `wsl.exe --shutdown` 会终止承载本会话的 WSL 实例（SIGTERM）。**本轮起禁止在
  当前 WSL 内执行 shutdown**；需要“完全停止 WSL”的真机步骤只能在 Windows 侧人工执行。
- 真机发现：`wsl --import` 后发行版显示 Stopped，但 VHD 仍被 WSL 占用；
  `--resize` / `--set-default-user` / `--set-sparse` 会报 `WSL_E_DISTRO_NOT_STOPPED`
  （“VHD 当前正在使用中，请 wsl --shutdown”）；`--terminate` **不能**释放该占用。
  `--compact` 可成功；`--export --format tar.gz` 可成功（均已用一次性发行版验证）。
- 因此 WP2 的 resize/sparse 不能只判断 `state === Stopped`：必须把该错误映射为
  可行动提示（建议用户在 Windows 侧执行 `wsl --shutdown`，并明确会停止所有发行版），
  绝不自动 shutdown。
