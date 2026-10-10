/**
 * E2E 启动冒烟 — 需要 Windows + 显示环境
 * 运行：npm run test:e2e
 *
 * 定位策略（review M10 根治）：
 * - 侧栏导航用 role=button + aria-label 精确定位，禁止 .first() 碰运气
 * - 页面文案用 exact 文本，避免子串误中
 * - 全部断言为静态 UI 文案，不依赖 WSL 是否安装
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

    // 侧栏导航存在（aria-label 精确定位）
    await expect(window.getByRole('button', { name: '驾驶舱', exact: true })).toBeVisible({
      timeout: 15_000,
    })

    // 打开终端页（M3）
    await window.getByRole('button', { name: '终端', exact: true }).click()
    await expect(window.getByText('node-pty', { exact: false })).toBeVisible({ timeout: 15_000 })

    // 打开备份迁移页（M4）：向导模式与最近备份面板可见（exact 文本防子串误中）
    await window.getByRole('button', { name: '备份迁移', exact: true }).click()
    await expect(window.getByText('导出备份', { exact: true })).toBeVisible({ timeout: 15_000 })
    await expect(window.getByText('导入恢复', { exact: true })).toBeVisible({ timeout: 15_000 })
    await expect(window.getByText('迁移磁盘', { exact: true })).toBeVisible({ timeout: 15_000 })
    await expect(window.getByText('最近备份', { exact: true })).toBeVisible({ timeout: 15_000 })

    // 设置页（M5）：快捷键一览与 wsl.conf 自动终止策略可见
    await window.getByRole('button', { name: '设置', exact: true }).click()
    await expect(window.getByText('快捷键', { exact: true })).toBeVisible({ timeout: 15_000 })
    await expect(window.getByText('打开命令面板', { exact: true })).toBeVisible({ timeout: 15_000 })
    await expect(window.getByText('wsl.conf 变更后自动终止发行版', { exact: true })).toBeVisible({
      timeout: 15_000,
    })

    // 网络页（M6）：镜像模式卡 / 端口转发表 / 代理配置三个面板可见
    await window.getByRole('button', { name: '网络', exact: true }).click()
    await expect(window.getByText('网络模式', { exact: true })).toBeVisible({ timeout: 15_000 })
    await expect(window.getByText('端口转发', { exact: true })).toBeVisible({ timeout: 15_000 })
    await expect(window.getByText('代理配置', { exact: true })).toBeVisible({ timeout: 15_000 })
    await expect(window.getByText('新建规则', { exact: true })).toBeVisible({ timeout: 15_000 })

    // USB 设备页（M6 usbipd）：安装引导或设备表二者必有其一（静态文案，不依赖是否装了 usbipd）
    await window.getByRole('button', { name: 'USB 设备', exact: true }).click()
    await expect(window.getByText('usbipd 绑定与附加管理', { exact: false })).toBeVisible({
      timeout: 15_000,
    })

    // 命令面板（M5 ⌘K）：全局快捷键唤起，Esc 关闭
    await window.keyboard.press('Control+KeyK')
    await expect(window.locator('input[aria-label="命令面板搜索"]')).toBeVisible({
      timeout: 15_000,
    })
    await expect(window.getByText('前往：驾驶舱', { exact: true })).toBeVisible({ timeout: 15_000 })
    await window.keyboard.press('Escape')
    await expect(window.locator('input[aria-label="命令面板搜索"]')).toBeHidden({ timeout: 15_000 })

    await app.close()
  })
})
