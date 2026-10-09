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

    // 设置页（M5）：快捷键一览与 wsl.conf 自动终止策略可见
    await window.locator('text=设置').first().click()
    await expect(window.locator('text=快捷键').first()).toBeVisible({ timeout: 15_000 })
    await expect(window.locator('text=打开命令面板')).toBeVisible({ timeout: 15_000 })
    await expect(window.locator('text=wsl.conf 变更后自动终止发行版')).toBeVisible({
      timeout: 15_000,
    })

    // 命令面板（M5 ⌘K）：全局快捷键唤起，Esc 关闭
    await window.keyboard.press('Control+KeyK')
    await expect(window.locator('input[aria-label="命令面板搜索"]')).toBeVisible({
      timeout: 15_000,
    })
    await expect(window.locator('text=前往：驾驶舱').first()).toBeVisible({ timeout: 15_000 })
    await window.keyboard.press('Escape')
    await expect(window.locator('input[aria-label="命令面板搜索"]')).toBeHidden({ timeout: 15_000 })

    await app.close()
  })
})
