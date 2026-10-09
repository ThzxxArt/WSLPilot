/**
 * E2E 启动冒烟 — 需要 Windows + 显示环境
 * 运行：npm run test:e2e
 */
import { test, expect, _electron as electron } from '@playwright/test'
import { join } from 'path'

test.describe('WSLPilot 启动冒烟', () => {
  test('主窗口可创建并显示标题', async () => {
    const app = await electron.launch({
      args: [join(__dirname, '../../out/main/index.js')],
    })

    const window = await app.firstWindow({ timeout: 30_000 })
    expect(window).toBeTruthy()

    const title = await window.title()
    expect(title).toContain('WSLPilot')

    // 侧栏导航存在
    await expect(window.locator('text=驾驶舱')).toBeVisible({ timeout: 15_000 })

    await app.close()
  })
})
