/**
 * 视觉回归（M7 打磨项，设计书 §16 视觉回归）— 需要 Windows + 显示环境。
 * 运行：npm run test:visual（含 --update-snapshots=missing：首次生成基线，其后比对）
 *
 * 稳定性策略：
 * - 动画统一禁用（animations: 'disabled'）
 * - 数据依赖区（指标数字 / 迷你图 / 时钟 / 发行版列表）一律 mask
 *   —— 基线只锁「视觉系统」：布局、令牌、间距、字号、动效无关的渲染一致性
 * - 首次运行生成基线（CI 约定：基线随 Windows runner 生成，跨机器差异不进门禁）
 */
import { test, expect, _electron as electron } from '@playwright/test'
import { join } from 'path'

/** 机器相关 / 实时数据区域：不参与像素比对 */
function dynamicMasks(window: import('@playwright/test').Page) {
  return [
    window.locator('.metric-value'),
    window.locator('.metric-hint'),
    window.locator('svg.sparkline, .sparkline'),
    window.locator('.statusbar .right'),
    window.locator('.statusbar .muted'),
    window.locator('.cards'),
    window.locator('.grid'),
    window.locator('.skeleton-cards'),
  ]
}

test.describe('视觉回归 @visual', () => {
  test('驾驶舱 / 设置 / 网络 渲染一致', async () => {
    const app = await electron.launch({
      args: [join(__dirname, '../../out/main/index.js')],
    })
    const window = await app.firstWindow({ timeout: 30_000 })
    await expect(window.getByRole('button', { name: '驾驶舱', exact: true })).toBeVisible({
      timeout: 15_000,
    })

    // 驾驶舱骨架（版式 + 标题区 + 指标卡布局）
    await expect(window).toHaveScreenshot('m7-dashboard.png', {
      mask: dynamicMasks(window),
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
      animations: 'disabled',
      caret: 'hide',
      maxDiffPixelRatio: 0.02,
    })

    // 网络页（镜像引导卡 + 转发规则空态/表格布局）
    await window.getByRole('button', { name: '网络', exact: true }).click()
    await expect(window.getByText('网络模式', { exact: true })).toBeVisible({ timeout: 15_000 })
    await expect(window).toHaveScreenshot('m7-network.png', {
      mask: dynamicMasks(window),
      animations: 'disabled',
      caret: 'hide',
      maxDiffPixelRatio: 0.02,
    })

    await app.close()
  })

  test('命令面板玻璃拟态渲染一致', async () => {
    const app = await electron.launch({
      args: [join(__dirname, '../../out/main/index.js')],
    })
    const window = await app.firstWindow({ timeout: 30_000 })
    await expect(window.getByRole('button', { name: '驾驶舱', exact: true })).toBeVisible({
      timeout: 15_000,
    })

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

    await app.close()
  })
})
