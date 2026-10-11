import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { enableAutoUnmount, mount, flushPromises } from '@vue/test-utils'
import { NCheckbox, NRadioGroup } from 'naive-ui'
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
  wslAPI.config.get.mockResolvedValue({})
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
