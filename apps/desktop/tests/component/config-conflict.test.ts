import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { enableAutoUnmount, mount, flushPromises } from '@vue/test-utils'
import { createWslAPI, findBodyButton, bodyText, type WslAPIMock } from './support'

enableAutoUnmount(afterEach)

/**
 * ConflictResolver（外部配置冲突三选语义）+ WslConfPanel 保存/错误面。
 * 重点：reload / overwrite / ignore 三种动作各自落到 resolveConflict 的真实参数；
 * 失败路径必须有错误提示，绝不静默。
 */

const message = {
  success: vi.fn(),
  warning: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
}
let dialogResult: 'positive' | 'negative' | 'close' = 'positive'
const dialog = {
  warning: vi.fn(
    (opts: {
      onPositiveClick?: () => void
      onNegativeClick?: () => void
      onClose?: () => void
    }) => {
      if (dialogResult === 'positive') opts.onPositiveClick?.()
      else if (dialogResult === 'negative') opts.onNegativeClick?.()
      else opts.onClose?.()
    },
  ),
  error: vi.fn(),
  info: vi.fn(),
  success: vi.fn(),
}
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
const ConflictResolver = (await import('../../src/renderer/features/config/ConflictResolver.vue'))
  .default
const WslConfPanel = (await import('../../src/renderer/features/config/WslConfPanel.vue')).default

/** 捕获 onConflict 注册的回调 */
function captureConflictHandler(): (p: { fileKey: string; detail: string }) => void {
  const calls = wslAPI.config.onConflict.mock.calls
  expect(calls.length).toBeGreaterThan(0)
  return calls[calls.length - 1]![0] as (p: { fileKey: string; detail: string }) => void
}

beforeEach(() => {
  vi.clearAllMocks()
  dialogResult = 'positive'
  setActivePinia(createPinia())
  document.body.innerHTML = ''
  wslAPI.config.resolveConflict.mockResolvedValue({})
  wslAPI.wslconf.read.mockResolvedValue('[automount]\nenabled = true\n')
  wslAPI.wslconf.write.mockResolvedValue({ terminated: false })
})

describe('ConflictResolver', () => {
  it('挂载即订阅冲突事件，卸载时解绑', async () => {
    const w = mount(ConflictResolver)
    expect(wslAPI.config.onConflict).toHaveBeenCalledTimes(1)
    const off = wslAPI.config.onConflict.mock.results[0]!.value as () => void
    w.unmount()
    expect(off).toHaveBeenCalledTimes(1)
  })

  it('「重载」采用磁盘外部修改：resolveConflict(key, reload)', async () => {
    mount(ConflictResolver)
    dialogResult = 'positive'
    captureConflictHandler()({ fileKey: 'settings', detail: '被外部编辑器改过' })
    await flushPromises()

    expect(dialog.warning).toHaveBeenCalledWith(
      expect.objectContaining({ title: '配置文件已被外部修改' }),
    )
    expect(wslAPI.config.resolveConflict).toHaveBeenCalledWith('settings', 'reload')
    expect(message.success).toHaveBeenCalledWith('已重载外部修改')
  })

  it('「覆盖」写回应用内状态：resolveConflict(key, overwrite)', async () => {
    mount(ConflictResolver)
    dialogResult = 'negative'
    captureConflictHandler()({ fileKey: 'network', detail: 'diff' })
    await flushPromises()
    expect(wslAPI.config.resolveConflict).toHaveBeenCalledWith('network', 'overwrite')
    expect(message.success).toHaveBeenCalledWith('已用应用内状态覆盖磁盘配置')
  })

  it('关闭（X/Esc）= 暂不处理：resolveConflict(key, ignore)', async () => {
    mount(ConflictResolver)
    dialogResult = 'close'
    captureConflictHandler()({ fileKey: 'distros', detail: 'diff' })
    await flushPromises()
    expect(wslAPI.config.resolveConflict).toHaveBeenCalledWith('distros', 'ignore')
    expect(message.success).toHaveBeenCalledWith(
      expect.stringContaining('已暂不处理：保留应用内状态'),
    )
  })

  it('处理冲突失败必须报错提示（不静默）', async () => {
    mount(ConflictResolver)
    wslAPI.config.resolveConflict.mockRejectedValueOnce(new Error('写回失败'))
    dialogResult = 'positive'
    captureConflictHandler()({ fileKey: 'settings', detail: 'diff' })
    await flushPromises()
    expect(message.error).toHaveBeenCalledWith(expect.stringContaining('写回失败'))
  })
})

describe('WslConfPanel 保存与错误面', () => {
  async function mountDirty() {
    const w = mount(WslConfPanel, {
      props: { distroName: 'Ubuntu' },
      attachTo: document.body,
    })
    await flushPromises()
    // 逐个点布尔开关直到脏态成立
    for (const el of Array.from(document.body.querySelectorAll('.n-switch'))) {
      el.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      await flushPromises()
      const save = findBodyButton('预览并保存')
      if (save && !save.hasAttribute('disabled')) return w
    }
    throw new Error('未能制造脏编辑')
  }

  it('读取失败展示错误文案（不伪装成空配置）', async () => {
    wslAPI.wslconf.read.mockRejectedValueOnce(new Error('sudo 不够'))
    const w = mount(WslConfPanel, {
      props: { distroName: 'Ubuntu' },
      attachTo: document.body,
    })
    await flushPromises()
    expect(w.find('p.error').exists()).toBe(true)
    expect(w.text()).toContain('sudo 不够')
  })

  it('预览并保存 → 确认写入调用 wslconf.write 并提示已保存', async () => {
    const w = await mountDirty()
    findBodyButton('预览并保存')!.click()
    await flushPromises()
    const confirm = findBodyButton('确认写入')
    expect(confirm, '差异预览应有确认写入按钮').toBeTruthy()
    confirm!.click()
    await flushPromises()
    expect(wslAPI.wslconf.write).toHaveBeenCalledWith('Ubuntu', expect.any(String))
    expect(message.success).toHaveBeenCalledWith(expect.stringContaining('wsl.conf 已保存'))
    expect(w.find('p.error').exists()).toBe(false)
  })

  it('写入失败走错误提示（错误态）', async () => {
    await mountDirty()
    wslAPI.wslconf.write.mockRejectedValueOnce(new Error('只读文件系统'))
    findBodyButton('预览并保存')!.click()
    await flushPromises()
    findBodyButton('确认写入')!.click()
    await flushPromises()
    expect(message.error).toHaveBeenCalledWith(expect.stringContaining('只读文件系统'))
    expect(bodyText()).toContain('只读文件系统')
  })
})
