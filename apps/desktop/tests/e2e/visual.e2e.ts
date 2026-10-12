/**
 * 视觉回归（M7 打磨项，设计书 §16 视觉回归）— 需要 Windows + 显示环境。
 * 运行：npm run test:visual（硬门禁比对；新增/更新基线用 --update-snapshots=all 并提交产物）
 *
 * 稳定性策略：
 * - 独立临时 userData（WSLPILOT_USER_DATA）：不读取真实用户配置（强调色/侧栏折叠/语言），
 *   基线与本机状态解耦（review D-15/E-11 根治）；每次从默认配置渲染
 * - 动画统一禁用（animations: 'disabled'）
 * - 数据/时段依赖区一律 mask，且截图期用 visual-stability.css 固定动态内容的盒尺寸
 *   （面积不随内容漂移、下方版式不随卡片数量位移）—— 基线只锁「视觉系统」：
 *   布局、令牌、间距、字号、动效无关的渲染一致性
 * - 基线按平台分文件（`{arg}-{platform}.png`）随仓库入库（linux/win32 各一套）；
 *   缺基线直接红（updateSnapshots: 'none'），CI 不自动造基线放行
 */
import { test, expect, _electron as electron } from '@playwright/test'
import { join } from 'path'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'

/** 截图期注入的稳定化样式（固定动态内容的盒尺寸；文件内注释了每一项的动机） */
const STABILITY_STYLE = join(__dirname, 'visual-stability.css')

/**
 * 机器相关 / 实时数据 / 时段相关区域：不参与像素比对。
 * 每一项都对应一个真实动态源（见注释），新增动态源时必须在此登记。
 */
function dynamicMasks(window: import('@playwright/test').Page) {
  return [
    // 时段问候语（早上好/下午好/晚上好）
    window.locator('.greeting'),
    // hero 统计行（WSL 版本 / 发行版数量 / 运行中数量 / 内核版本）
    window.locator('.hero .sub'),
    // 指标数值与提示（真实采样数据）
    window.locator('.metric-value'),
    window.locator('.metric-hint'),
    window.locator('svg.sparkline, .sparkline'),
    // 状态栏：时钟与全局版本
    window.locator('.statusbar .right'),
    window.locator('.statusbar .muted'),
    // 发行版卡片区（数量随本机变化；高度由 visual-stability.css 固定为 380px）
    window.locator('.cards'),
    window.locator('.grid'),
    window.locator('.skeleton-cards'),
    // 空态容器（CI runner 无 WSL 发行版时走此分支——与卡片区同尺寸掩码，保证两分支渲染等价）
    window.locator('.empty-wrap'),
    // 网络页：系统真实转发表（条数与内容随机器变化）
    window.locator('.system-card .panel-title'),
    // review 0.1.2：整表掩码收窄为数据行区域（tbody）—— 表头（监听/转发到/类型）与
    // 边框是固定视觉系统，参与比对；容器定高（visual-stability.css）保证版式不漂移
    window.locator('.system-card .table tbody'),
    window.locator('.system-card .empty-line'),
    // 网络页：端口转发表计数（规则来自用户配置）
    window.locator('.table-card .sub'),
    // 网络页：镜像模式卡（状态随运行机器 .wslconfig 变化：mirrored 说明卡 / NAT 推荐卡，
    // 两种形态的 .body 高度差约 250px）。
    // review 0.1.2 审计修复：曾把整卡掩码收窄为「状态徽章/路径行/正文」三个具体元素，
    // 但收窄后 mask 矩形（相对定高卡片的位置与尺寸）仍随状态变化——两平台基线曾因此
    // 记录不同状态（win32=mirrored、linux=NAT），环境一换即假红。现回退为**整卡掩码**：
    // 卡片已被 visual-stability.css 定高 360px，整卡 mask 矩形恒定，两种形态在截图中等价。
    window.locator('.mirror-card'),
    // 网络页：页头摘要行（含「系统已生效 N 条」动态计数）
    window.locator('.page-header .sub'),
    // 网络页：Windows 系统代理状态（随机器变化）
    window.locator('.proxy-card .hint'),
    // 设置页：版本号（随版本变化）
    window.getByText(/^WSLPilot v/),
  ]
}

/** 隔离启动：临时 userData + 关闭后清理 */
async function launchIsolated() {
  const userData = mkdtempSync(join(tmpdir(), 'wslpilot-e2e-visual-'))
  const app = await electron.launch({
    args: [join(__dirname, '../../out/main/index.js')],
    env: { ...(process.env as Record<string, string>), WSLPILOT_USER_DATA: userData },
  })
  const close = async () => {
    await app.close()
    rmSync(userData, { recursive: true, force: true })
  }
  return { app, close }
}

/**
 * 固定窗口内容尺寸 —— 视觉基线与运行机器的屏幕尺寸解耦。
 *
 * 背景（CI 首跑实锤）：默认窗口 1180×760 在小屏机器（GitHub windows runner 屏幕 1024×768，
 * 工作区 1024×720）上会被系统压到 1024×720 → 与基线尺寸失配（42% 像素差）。
 * 统一把内容区固定为 1024×720（所有目标环境都装得下、不会被裁剪），基线按此尺寸生成与比对。
 */
const SCREENSHOT_SIZE = { width: 1024, height: 720 } as const

async function fixWindowSize(app: Awaited<ReturnType<typeof electron.launch>>): Promise<void> {
  await app.evaluate(({ BrowserWindow }, size) => {
    const win = BrowserWindow.getAllWindows()[0]
    win?.setContentSize(size.width, size.height)
  }, SCREENSHOT_SIZE)
  // 等 resize 引发的布局/resize 事件稳定后再截图
  await new Promise((resolve) => setTimeout(resolve, 300))
}

test.describe('视觉回归 @visual', () => {
  test('驾驶舱 / 设置 / 网络 渲染一致', async () => {
    const { app, close } = await launchIsolated()
    try {
      const window = await app.firstWindow({ timeout: 30_000 })
      await expect(window.getByRole('button', { name: '驾驶舱', exact: true })).toBeVisible({
        timeout: 15_000,
      })
      await fixWindowSize(app)

      // 驾驶舱骨架（版式 + 标题区 + 指标卡布局）
      await expect(window).toHaveScreenshot('m7-dashboard.png', {
        mask: dynamicMasks(window),
        stylePath: STABILITY_STYLE,
        animations: 'disabled',
        caret: 'hide',
        maxDiffPixelRatio: 0.02,
      })

      // 设置页（设置行排布 + 快捷键表 + 关于/诊断/签名区 —— M7 新增区块）
      await window.getByRole('button', { name: '设置', exact: true }).click()
      await expect(window.getByText('软件更新', { exact: true })).toBeVisible({ timeout: 15_000 })
      await expect(window.getByText('诊断与反馈', { exact: true })).toBeVisible({ timeout: 15_000 })
      await expect(window).toHaveScreenshot('m7-settings.png', {
        mask: [...dynamicMasks(window), window.locator('.diag-result')],
        stylePath: STABILITY_STYLE,
        animations: 'disabled',
        caret: 'hide',
        maxDiffPixelRatio: 0.02,
      })

      // 网络页（镜像引导卡 + 转发规则空态/表格布局）
      await window.getByRole('button', { name: '网络', exact: true }).click()
      await expect(window.getByText('网络模式', { exact: true })).toBeVisible({ timeout: 15_000 })
      await expect(window).toHaveScreenshot('m7-network.png', {
        mask: dynamicMasks(window),
        stylePath: STABILITY_STYLE,
        animations: 'disabled',
        caret: 'hide',
        maxDiffPixelRatio: 0.02,
      })
    } finally {
      await close()
    }
  })

  test('命令面板玻璃拟态渲染一致', async () => {
    const { app, close } = await launchIsolated()
    try {
      const window = await app.firstWindow({ timeout: 30_000 })
      await expect(window.getByRole('button', { name: '驾驶舱', exact: true })).toBeVisible({
        timeout: 15_000,
      })
      await fixWindowSize(app)

      await window.keyboard.press('Control+KeyK')
      await expect(window.locator('input[aria-label="命令面板搜索"]')).toBeVisible({
        timeout: 15_000,
      })
      await expect(window).toHaveScreenshot('m7-palette.png', {
        // 结果列表随本机发行版/动作变化，只锁面板框体与输入区
        mask: [window.locator('#palette-results')],
        animations: 'disabled',
        caret: 'hide',
        maxDiffPixelRatio: 0.02,
      })
    } finally {
      await close()
    }
  })
})
