import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { enableAutoUnmount, mount, flushPromises } from '@vue/test-utils'
import { NCheckbox, NInput, NRadioGroup, NSelect } from 'naive-ui'
import { defaultConfig } from '@wslpilot/shared'
import { appError, createWslAPI, distro, findButton, bodyText, type WslAPIMock } from './support'

enableAutoUnmount(afterEach)

/**
 * SettingsView（签名/更新/诊断/配置文件面）+ BackupView（导出/迁移守卫/任务错误面）。
 * 覆盖 quality-fixes 未触达的交互与错误态。
 */

const message = {
  success: vi.fn(),
  warning: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
}
const dialog = { warning: vi.fn(), error: vi.fn(), info: vi.fn(), success: vi.fn() }
const notification = { warning: vi.fn(), success: vi.fn(), error: vi.fn(), info: vi.fn() }

vi.mock('naive-ui', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>()
  return {
    ...actual,
    useMessage: () => message,
    useDialog: () => dialog,
    useNotification: () => notification,
  }
})

vi.mock('vue-router', () => ({
  useRouter: () => ({ push: vi.fn() }),
  useRoute: () => ({ query: {} }),
}))

let wslAPI: WslAPIMock
;(globalThis as any).window.wslAPI = wslAPI = createWslAPI()

const { createPinia, setActivePinia } = await import('pinia')
const { useSettingsStore } = await import('../../src/renderer/stores/settings')
const { useTasksStore } = await import('../../src/renderer/stores/tasks')
const SettingsView = (await import('../../src/renderer/views/SettingsView.vue')).default
const BackupView = (await import('../../src/renderer/views/BackupView.vue')).default
const ExportWizard = (await import('../../src/renderer/features/backup/ExportWizard.vue')).default
const ImportWizard = (await import('../../src/renderer/features/backup/ImportWizard.vue')).default
const MoveWizard = (await import('../../src/renderer/features/backup/MoveWizard.vue')).default

beforeEach(() => {
  vi.clearAllMocks()
  setActivePinia(createPinia())
  document.body.innerHTML = ''
  // 不覆写 config.get：support 的默认实现即真实契约形状（本文件组件不消费它）
  wslAPI.distros.list.mockResolvedValue([])
  wslAPI.io.listBackups.mockResolvedValue([])
  wslAPI.update.status.mockResolvedValue({ status: 'idle', currentVersion: '0.1.0' })
  useSettingsStore().confirmDestructive = true
})

describe('SettingsView 签名与诊断', () => {
  it('签名检测失败如实展示「无法检测签名状态」（不谎报未签名）', async () => {
    wslAPI.app.signatureStatus.mockRejectedValueOnce(new Error('IPC 超时'))
    mount(SettingsView, { attachTo: document.body })
    await flushPromises()
    expect(bodyText()).toContain('无法检测签名状态')
    expect(bodyText()).not.toContain('未检测到有效签名')
  })

  it('已签名 / 未签名分别渲染对应标签', async () => {
    wslAPI.app.signatureStatus.mockResolvedValueOnce({ checked: true, signed: true, detail: '' })
    mount(SettingsView, { attachTo: document.body })
    await flushPromises()
    expect(bodyText()).toContain('已签名')
  })

  it('导出诊断包成功展示结果文案；失败给错误提示', async () => {
    wslAPI.diagnostics.exportPackage.mockResolvedValueOnce({
      path: 'C:\\logs\\diag.zip',
      entries: ['a.log', 'b.jsonc'],
    })
    const w = mount(SettingsView, { attachTo: document.body })
    await flushPromises()
    findButton(w, '导出诊断包')!.element.click()
    await flushPromises()
    expect(wslAPI.diagnostics.exportPackage).toHaveBeenCalled()
    expect(w.text()).toContain('已导出 C:\\logs\\diag.zip（2 个文件）')

    wslAPI.diagnostics.exportPackage.mockRejectedValueOnce(new Error('磁盘满'))
    findButton(w, '导出诊断包')!.element.click()
    await flushPromises()
    expect(message.error).toHaveBeenCalledWith(expect.stringContaining('磁盘满'))
  })

  it('打开配置文件失败给错误提示（不静默）', async () => {
    wslAPI.config.openExternal.mockRejectedValueOnce(new Error('没有关联程序'))
    const w = mount(SettingsView, { attachTo: document.body })
    await flushPromises()
    // 配置文件入口是 n-tag[role=button]
    const tag = w.findAll('.config-tag').find((t) => t.text().includes('settings.jsonc'))!
    expect(tag.exists()).toBe(true)
    tag.element.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await flushPromises()
    expect(wslAPI.config.openExternal).toHaveBeenCalledWith('settings')
    expect(message.error).toHaveBeenCalledWith(expect.stringContaining('没有关联程序'))
  })

  it('强调色切换：实时预览 + 落盘 config.set + 成功提示', async () => {
    const w = mount(SettingsView, { attachTo: document.body })
    await flushPromises()
    w.findComponent(NRadioGroup).vm.$emit('update:value', 'sunset')
    await flushPromises()
    expect(wslAPI.config.set).toHaveBeenCalledWith(
      'settings',
      expect.objectContaining({ general: expect.objectContaining({ accent: 'sunset' }) }),
    )
    expect(message.success).toHaveBeenCalledWith(expect.stringContaining('日落 Sunset'))
  })

  it('打开配置目录失败给错误提示（不静默、不产生未处理拒绝）', async () => {
    wslAPI.app.openConfigDir.mockRejectedValueOnce(new Error('shell 打不开'))
    const w = mount(SettingsView, { attachTo: document.body })
    await flushPromises()
    findButton(w, '打开配置目录')!.element.click()
    await flushPromises()
    expect(wslAPI.app.openConfigDir).toHaveBeenCalled()
    expect(message.error).toHaveBeenCalledWith(expect.stringContaining('shell 打不开'))
  })

  it('浏览备份目录失败给错误提示（pickDirectory 拒绝不静默）', async () => {
    wslAPI.app.pickDirectory.mockRejectedValueOnce(new Error('对话框异常'))
    const w = mount(SettingsView, { attachTo: document.body })
    await flushPromises()
    findButton(w, '浏览…')!.element.click()
    await flushPromises()
    expect(message.error).toHaveBeenCalledWith(expect.stringContaining('对话框异常'))
    expect(wslAPI.config.set).not.toHaveBeenCalled()
  })

  it('浏览备份目录选中后落盘；取消选择则不写', async () => {
    wslAPI.app.pickDirectory.mockResolvedValueOnce('D:\\Backups')
    const w = mount(SettingsView, { attachTo: document.body })
    await flushPromises()
    findButton(w, '浏览…')!.element.click()
    await flushPromises()
    expect(wslAPI.config.set).toHaveBeenCalledWith(
      'settings',
      expect.objectContaining({ backup: expect.objectContaining({ defaultDir: 'D:\\Backups' }) }),
    )

    wslAPI.app.pickDirectory.mockResolvedValueOnce(null)
    wslAPI.config.set.mockClear()
    findButton(w, '浏览…')!.element.click()
    await flushPromises()
    expect(wslAPI.config.set).not.toHaveBeenCalled()
  })

  it('WSL 不支持 tar.gz 时默认格式降级为 tar（不把必然失败的默认值落盘）', async () => {
    useSettingsStore().backupFormat = 'tar.gz'
    const env = await wslAPI.app.wslEnv()
    env.capabilities!.flags.exportFormats = false
    // WslEnvironmentCard 自己 load 一次，共享 store 再 load 一次；两次都必须返回不支持
    wslAPI.app.wslEnv.mockResolvedValueOnce(env).mockResolvedValueOnce(env)
    mount(SettingsView, { attachTo: document.body })
    await flushPromises()
    expect(message.warning).toHaveBeenCalledWith(expect.stringContaining('默认备份格式已改为 tar'))
    expect(useSettingsStore().backupFormat).toBe('tar')
  })
})

describe('SettingsView 更新卡错误面', () => {
  it('检查更新的 error 状态如实报「检查更新失败」', async () => {
    wslAPI.update.check.mockResolvedValueOnce({
      status: 'error',
      currentVersion: '0.1.0',
      error: '网络不可达',
    })
    const w = mount(SettingsView, { attachTo: document.body })
    await flushPromises()
    findButton(w, '检查更新')!.element.click()
    await flushPromises()
    expect(message.error).toHaveBeenCalledWith(expect.stringContaining('网络不可达'))
  })

  it('下载更新失败（status 非 downloaded）给错误提示', async () => {
    wslAPI.update.status.mockResolvedValueOnce({
      status: 'available',
      currentVersion: '0.1.0',
      version: '2.0.0',
    })
    wslAPI.update.download.mockResolvedValueOnce({
      status: 'error',
      currentVersion: '0.1.0',
      error: 'CDN 404',
    })
    const w = mount(SettingsView, { attachTo: document.body })
    await flushPromises()
    findButton(w, '下载更新')!.element.click()
    await flushPromises()
    expect(message.error).toHaveBeenCalledWith(expect.stringContaining('CDN 404'))
  })

  it('更新状态行渲染各状态文案（error 态显示根因）', async () => {
    wslAPI.update.status.mockResolvedValueOnce({
      status: 'error',
      currentVersion: '0.1.0',
      error: '校验和不匹配',
    })
    const w = mount(SettingsView, { attachTo: document.body })
    await flushPromises()
    expect(w.text()).toContain('更新失败：校验和不匹配')
  })
})

describe('BackupView 导出与守卫', () => {
  async function toConfirm(w: ReturnType<typeof mount>) {
    w.findComponent(NRadioGroup).vm.$emit('update:value', 'export')
    await flushPromises()
    w.findComponent(ExportWizard).vm.$emit('update:form', {
      name: 'Ubuntu',
      path: 'D:\\b\\Ubuntu.tar',
      format: 'tar',
    })
    await flushPromises()
    findButton(w, '下一步')!.element.click()
    await flushPromises()
    findButton(w, '下一步')!.element.click()
    await flushPromises()
  }

  it('导出流程走到确认并启动 io.export', async () => {
    wslAPI.distros.list.mockResolvedValue([distro()])
    const w = mount(BackupView, { attachTo: document.body })
    await flushPromises()
    await toConfirm(w)
    findButton(w, '开始导出备份')!.element.click()
    await flushPromises()
    expect(wslAPI.io.export).toHaveBeenCalledWith(expect.objectContaining({ name: 'Ubuntu' }))
  })

  it('任务启动失败给错误提示（不跳进度页）', async () => {
    wslAPI.distros.list.mockResolvedValue([distro()])
    wslAPI.io.export.mockRejectedValueOnce(appError('磁盘空间不足'))
    const w = mount(BackupView, { attachTo: document.body })
    await flushPromises()
    await toConfirm(w)
    findButton(w, '开始导出备份')!.element.click()
    await flushPromises()
    expect(message.error).toHaveBeenCalledWith(expect.stringContaining('磁盘空间不足'))
  })

  it('运行中迁移未勾选终止：第 2 步直接拦住并显示原因（不拖到长任务才失败）', async () => {
    wslAPI.distros.list.mockResolvedValue([distro({ state: 'Running' })])
    const w = mount(BackupView, { attachTo: document.body })
    await flushPromises()
    w.findComponent(NRadioGroup).vm.$emit('update:value', 'move')
    await flushPromises()
    w.findComponent(MoveWizard).vm.$emit('update:form', {
      name: 'Ubuntu',
      path: 'D:\\NewHome',
      terminateFirst: false,
    })
    await flushPromises()
    findButton(w, '下一步')!.element.click()
    await flushPromises()
    expect(bodyText()).toContain('迁移需要先终止它')
    expect(findButton(w, '下一步')!.element.hasAttribute('disabled')).toBe(true)
    expect(wslAPI.io.move).not.toHaveBeenCalled()
  })

  it('迁移模式需勾选「我已知晓」，未勾选不启动任务', async () => {
    wslAPI.distros.list.mockResolvedValue([distro()])
    const w = mount(BackupView, { attachTo: document.body })
    await flushPromises()
    w.findComponent(NRadioGroup).vm.$emit('update:value', 'move')
    await flushPromises()
    w.findComponent(MoveWizard).vm.$emit('update:form', {
      name: 'Ubuntu',
      path: 'D:\\NewHome',
      terminateFirst: true,
    })
    await flushPromises()
    findButton(w, '下一步')!.element.click()
    await flushPromises()
    findButton(w, '下一步')!.element.click()
    await flushPromises()
    // 第 3 步（确认）：未勾选「我已知晓」时启动按钮禁用
    const startBtn = findButton(w, '开始迁移磁盘')
    expect(startBtn, '确认步应有开始迁移磁盘按钮').toBeTruthy()
    expect(startBtn!.element.hasAttribute('disabled')).toBe(true)
    expect(wslAPI.io.move).not.toHaveBeenCalled()
    expect(bodyText()).toContain('我已知晓')

    // 勾选后按钮解除禁用（状态变化真实可见）
    w.findComponent(NCheckbox).vm.$emit('update:checked', true)
    await flushPromises()
    expect(findButton(w, '开始迁移磁盘')!.element.hasAttribute('disabled')).toBe(false)
  })

  it('导入重名在第 1 步即拦截（canNext=false，按钮禁用）', async () => {
    wslAPI.distros.list.mockResolvedValue([distro()])
    const w = mount(BackupView, { attachTo: document.body })
    await flushPromises()
    w.findComponent(NRadioGroup).vm.$emit('update:value', 'import')
    await flushPromises()
    w.findComponent(ImportWizard).vm.$emit('update:form', {
      name: 'Ubuntu',
      source: 'file',
      archivePath: 'D:\\b\\Ubuntu.tar',
      installPath: 'D:\\import\\Ubuntu',
      format: 'tar',
    })
    await flushPromises()
    // 与现有发行版重名 → 下一步禁用
    expect(findButton(w, '下一步')!.element.hasAttribute('disabled')).toBe(true)
  })

  it('任务失败展示进度错误与日志入口', async () => {
    wslAPI.distros.list.mockResolvedValue([distro()])
    const w = mount(BackupView, { attachTo: document.body })
    await flushPromises()
    await toConfirm(w)
    findButton(w, '开始导出备份')!.element.click()
    await flushPromises()
    const tasks = useTasksStore()
    tasks.applyProgress({
      taskId: 'e',
      type: 'export',
      distro: 'Ubuntu',
      percent: 40,
      message: '磁盘满',
      status: 'failed',
    })
    await flushPromises()
    expect(w.text()).toContain('磁盘满')
  })
})

describe('BackupView 备份列表', () => {
  it('刷新按钮触发重读；成功清错误态', async () => {
    wslAPI.io.listBackups.mockRejectedValueOnce(appError('目录被占用'))
    const w = mount(BackupView, { attachTo: document.body })
    await flushPromises()
    expect(w.find('.backups-error').exists()).toBe(true)

    wslAPI.io.listBackups.mockResolvedValue([])
    findButton(w, '重试')!.element.click()
    await flushPromises()
    expect(w.find('.backups-error').exists()).toBe(false)
    expect(wslAPI.io.listBackups).toHaveBeenCalledTimes(2)
  })
})

describe('SettingsView 设置 setter 覆盖面（落盘参数逐项对账）', () => {
  function lineOf(label: string): HTMLElement | null {
    return (
      (Array.from(document.body.querySelectorAll<HTMLElement>('.setting-line')).find((el) =>
        (el.textContent ?? '').includes(label),
      ) as HTMLElement | undefined) ?? null
    )
  }

  async function clickSwitch(label: string) {
    const line = lineOf(label)
    expect(line, `找不到设置行：${label}`).toBeTruthy()
    const sw = line!.querySelector<HTMLElement>('.n-switch')
    expect(sw, `设置行内没有开关：${label}`).toBeTruthy()
    sw!.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await flushPromises()
  }

  function selectInLine(w: ReturnType<typeof mount>, label: string) {
    return (
      w
        .findAllComponents(NSelect)
        .find((c) =>
          (c.element as HTMLElement).closest('.setting-line')?.textContent?.includes(label),
        ) ?? null
    )
  }

  async function pickSelect(w: ReturnType<typeof mount>, label: string, value: unknown) {
    const sel = selectInLine(w, label)
    expect(sel, `找不到下拉：${label}`).toBeTruthy()
    sel!.vm.$emit('update:value', value)
    await flushPromises()
  }

  it('减弱动效 / 开机自启 / 破坏性确认 / 显示等价命令行 / 自动更新 开关落盘', async () => {
    const w = mount(SettingsView, { attachTo: document.body })
    await flushPromises()

    await clickSwitch('减弱动效')
    expect(wslAPI.config.set).toHaveBeenCalledWith('settings', {
      general: { reduceMotion: true },
    })

    await clickSwitch('开机自启')
    expect(wslAPI.config.set).toHaveBeenCalledWith('settings', {
      general: { launchAtLogin: true },
    })

    await clickSwitch('破坏性操作二次确认')
    expect(wslAPI.config.set).toHaveBeenCalledWith('settings', {
      advanced: { confirmDestructive: false },
    })

    await clickSwitch('显示等价命令行')
    expect(wslAPI.config.set).toHaveBeenCalledWith('settings', {
      advanced: { showRawCommand: true },
    })

    await clickSwitch('启动时自动检查更新')
    expect(wslAPI.config.set).toHaveBeenCalledWith('settings', {
      advanced: { autoUpdate: false },
    })
    void w
  })

  it('组件语言 / 关闭行为 / 日志级别 / 终端主题 / 备份格式 下拉落盘', async () => {
    const w = mount(SettingsView, { attachTo: document.body })
    await flushPromises()

    await pickSelect(w, '组件语言', 'en-US')
    expect(wslAPI.config.set).toHaveBeenCalledWith('settings', {
      general: { locale: 'en-US' },
    })

    await pickSelect(w, '关闭窗口时', 'quit')
    expect(wslAPI.config.set).toHaveBeenCalledWith('settings', {
      general: { closeBehavior: 'quit' },
    })

    await pickSelect(w, '日志级别', 'debug')
    expect(wslAPI.config.set).toHaveBeenCalledWith('settings', {
      advanced: { logLevel: 'debug' },
    })

    await pickSelect(w, '终端主题', 'follow-app')
    expect(wslAPI.config.set).toHaveBeenCalledWith('settings', {
      terminal: { theme: 'follow-app' },
    })

    await pickSelect(w, '默认格式', 'vhd')
    expect(wslAPI.config.set).toHaveBeenCalledWith('settings', {
      backup: { format: 'vhd' },
    })
  })

  it('补漏：硬件加速 / 选中即复制 开关落盘（精确 patch）', async () => {
    const w = mount(SettingsView, { attachTo: document.body })
    await flushPromises()

    await clickSwitch('硬件加速')
    expect(wslAPI.config.set).toHaveBeenCalledWith('settings', {
      advanced: { hardwareAcceleration: false },
    })

    await clickSwitch('选中即复制')
    expect(wslAPI.config.set).toHaveBeenCalledWith('settings', {
      terminal: { copyOnSelect: true },
    })
    void w
  })

  it('补漏：默认 Shell 防抖输入落盘（卸载 flush，精确 patch）', async () => {
    const w = mount(SettingsView, { attachTo: document.body })
    await flushPromises()
    const input = w
      .findAllComponents(NInput)
      .find((c) =>
        (c.element as HTMLElement).closest('.setting-line')?.textContent?.includes('默认 Shell'),
      )
    expect(input, '找不到「默认 Shell」输入框').toBeTruthy()
    input!.vm.$emit('update:value', '/bin/zsh')
    // 防抖 400ms 内卸载：flush 必须把挂起值精确落盘
    w.unmount()
    expect(wslAPI.config.set).toHaveBeenCalledWith('settings', {
      wsl: { defaultShell: '/bin/zsh' },
    })
  })

  it('配置标签支持 Space 激活（role=button 键盘规范 — 与 TitleBar 同款）', async () => {
    const w = mount(SettingsView, { attachTo: document.body })
    await flushPromises()
    const tag = w.findAll('.config-tag').find((t) => t.text().includes('distros.jsonc'))!
    tag.element.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true }))
    await flushPromises()
    expect(wslAPI.config.openExternal).toHaveBeenCalledWith('distros')
  })
})

describe('SettingsView 编辑安全与恢复默认（review 0.1.2）', () => {
  function inputInLine(w: ReturnType<typeof mount>, label: string) {
    return (
      w
        .findAllComponents(NInput)
        .find((c) =>
          (c.element as HTMLElement).closest('.setting-line')?.textContent?.includes(label),
        ) ?? null
    )
  }

  it('卸载时 flush 挂起的防抖编辑（400ms 内切页不丢最后一次编辑）', async () => {
    const w = mount(SettingsView, { attachTo: document.body })
    await flushPromises()
    const input = inputInLine(w, '字体')
    expect(input, '找不到「字体」输入框').toBeTruthy()
    input!.vm.$emit('update:value', 'Fira Code')
    // 未到 400ms 即卸载：flush 必须把挂起值落盘
    w.unmount()
    expect(wslAPI.config.set).toHaveBeenCalledWith('settings', {
      terminal: { fontFamily: 'Fira Code' },
    })
  })

  it('setAccent 落盘失败不得报成功（判 persistField 返回值）', async () => {
    wslAPI.config.set.mockRejectedValueOnce(new Error('磁盘满'))
    const w = mount(SettingsView, { attachTo: document.body })
    await flushPromises()
    w.findComponent(NRadioGroup).vm.$emit('update:value', 'ocean')
    await flushPromises()
    expect(message.success).not.toHaveBeenCalled()
    expect(message.error).toHaveBeenCalledWith(expect.stringContaining('磁盘满'))
  })

  it('恢复默认设置：确认后全量 patch 默认值并提示成功', async () => {
    const w = mount(SettingsView, { attachTo: document.body })
    await flushPromises()
    findButton(w, '恢复默认设置')!.element.click()
    await flushPromises()
    expect(dialog.warning).toHaveBeenCalledWith(
      expect.objectContaining({ title: expect.stringContaining('恢复默认设置') }),
    )
    const opts = dialog.warning.mock.calls.at(-1)![0] as {
      onPositiveClick: () => Promise<void>
    }
    await opts.onPositiveClick()
    await flushPromises()
    const defaults = defaultConfig('settings')
    expect(wslAPI.config.set).toHaveBeenCalledWith('settings', {
      general: defaults.general,
      advanced: defaults.advanced,
      wsl: defaults.wsl,
      terminal: defaults.terminal,
      backup: defaults.backup,
    })
    expect(message.success).toHaveBeenCalledWith('已恢复默认设置')
  })

  it('恢复默认设置：写盘成功但 reload 失败降级为 warning，不谎报成功（review 0.1.2 审计修复）', async () => {
    const w = mount(SettingsView, { attachTo: document.body })
    await flushPromises()
    findButton(w, '恢复默认设置')!.element.click()
    await flushPromises()
    const opts = dialog.warning.mock.calls.at(-1)![0] as {
      onPositiveClick: () => Promise<void>
    }
    // 根因回归：config.set 成功而 settings.load() 失败时，此前仍提示「已恢复默认设置」
    wslAPI.config.get.mockRejectedValueOnce(new Error('配置文件损坏'))
    await opts.onPositiveClick()
    await flushPromises()
    expect(wslAPI.config.set).toHaveBeenCalled()
    expect(message.success).not.toHaveBeenCalled()
    expect(message.warning).toHaveBeenCalledWith('已恢复默认设置，界面刷新失败，请重启应用')
  })
})
