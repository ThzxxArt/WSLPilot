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

    // 打开终端页（M3）
    await window.locator('text=终端').first().click()
    await expect(window.locator('text=node-pty')).toBeVisible({ timeout: 15_000 })

    // 打开备份迁移页（M4）：向导模式与最近备份面板可见
    await window.locator('text=备份与迁移').first().click()
    await expect(window.locator('text=导出备份').first()).toBeVisible({ timeout: 15_000 })
    await expect(window.locator('text=导入恢复').first()).toBeVisible({ timeout: 15_000 })
    await expect(window.locator('text=迁移磁盘').first()).toBeVisible({ timeout: 15_000 })
    await expect(window.locator('text=最近备份')).toBeVisible({ timeout: 15_000 })

    await app.close()
  })
})
