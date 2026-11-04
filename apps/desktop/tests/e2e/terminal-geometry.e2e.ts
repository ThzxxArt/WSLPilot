/**
 * 终端 2.0 几何 E2E（0.2.0 验收）：
 * - 工作台不渲染全局 TitleBar / StatusBar
 * - 导航轨固定 56px
 * - 终端绘图区（.panes）占整窗面积 ≥ 85%（1920×1080 目标 90%+；
 *   这里用实际窗口尺寸计算，空态与真实会话使用同一布局容器）
 *
 * 需要 Windows + 构建产物；CI 在 windows-latest 执行。
 */
import { test, expect, _electron as electron } from '@playwright/test'
import { join } from 'path'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'

test.describe('终端工作台几何', () => {
  test('全出血布局：绘图区占比 ≥ 85%，导航轨 56px，无全局标题栏', async () => {
    const userData = mkdtempSync(join(tmpdir(), 'wslpilot-e2e-geom-'))
    const app = await electron.launch({
      args: [join(__dirname, '../../out/main/index.js')],
      env: { ...(process.env as Record<string, string>), WSLPILOT_USER_DATA: userData },
    })
    try {
      const win = await app.firstWindow({ timeout: 30_000 })
      const nav = win.locator('aside.sidebar')
      await nav.getByRole('button', { name: '终端', exact: true }).click()
      await expect(win.locator('.terminal-view')).toBeVisible({ timeout: 15_000 })
      await expect(win.locator('.workbench-bar')).toBeVisible({ timeout: 15_000 })

      // 无全局壳
      await expect(win.locator('.titlebar')).toHaveCount(0)
      await expect(win.locator('.statusbar')).toHaveCount(0)

      const railBox = await nav.boundingBox()
      expect(railBox, '导航轨应有布局盒').toBeTruthy()
      expect(Math.round(railBox!.width), '导航轨宽度应为 56px').toBe(56)

      const panesBox = await win.locator('.panes').boundingBox()
      expect(panesBox, '终端绘图区应有布局盒').toBeTruthy()
      const size = await win.evaluate(() => ({ w: window.innerWidth, h: window.innerHeight }))
      const ratio = (panesBox!.width * panesBox!.height) / (size.w * size.h)
      expect(ratio, `绘图区占比 ${(ratio * 100).toFixed(1)}% 应 ≥ 85%`).toBeGreaterThanOrEqual(0.85)

      // 顶栏 34px + 状态行 20px（焦点模式之外）——高度预算不塌陷
      const barBox = await win.locator('.workbench-bar').boundingBox()
      expect(barBox!.height).toBeLessThanOrEqual(36)
      const statusBox = await win.locator('.status').boundingBox()
      expect(statusBox!.height).toBeLessThanOrEqual(22)
    } finally {
      await app.close()
      rmSync(userData, { recursive: true, force: true })
    }
  })
})
