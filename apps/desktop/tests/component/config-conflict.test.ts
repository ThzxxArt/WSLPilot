import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { enableAutoUnmount, mount, flushPromises } from '@vue/test-utils'
import { createWslAPI, findBodyButton, bodyText, type WslAPIMock } from './support'

const { useDistrosStore } = await import('../../src/renderer/stores/distros')
/** 面板读取走运行状态门禁（review：读取绝不隐式启动发行版）——夹具默认 Running */
const RUNNING = {
  name: 'Ubuntu',
  state: 'Running',
  version: 2,
  isDefault: true,
  meta: null,
} as never

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
/** 每次 dialog.warning 返回的实例（review 0.1.2 审计修复：显式 destroy 行为必须可断言） */
const dialogInstances: Array<{ destroy: ReturnType<typeof vi.fn> }> = []
const dialog = {
  warning: vi.fn(
    (opts: {
      onPositiveClick?: () => void
      onNegativeClick?: () => void
      onClose?: () => void
    }) => {
      // naive 真实契约：warning() 返回实例含 destroy（action slot 路径不会自动 hide，需显式销毁）
      const inst = { destroy: vi.fn() }
      dialogInstances.push(inst)
      if (dialogResult === 'positive') opts.onPositiveClick?.()
      else if (dialogResult === 'negative') opts.onNegativeClick?.()
      else opts.onClose?.()
      return inst
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
  dialogInstances.length = 0
  setActivePinia(createPinia())
  useDistrosStore().items = [RUNNING]
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

  it('Esc 与 Close 双回调只 resolve 一次（幂等守卫 — review 根治）', async () => {
    mount(ConflictResolver)
    let captured: { onEsc?: () => void; onClose?: () => void } | null = null
    dialog.warning.mockImplementationOnce((opts: unknown) => {
      captured = opts as { onEsc?: () => void; onClose?: () => void }
      return { destroy: vi.fn() }
    })
    captureConflictHandler()({ fileKey: 'settings', detail: 'diff' })
    await flushPromises()
    expect(captured).toBeTruthy()
    // 真实 naive 一次关闭可能先后触发 onEsc 与 onClose：resolve 必须幂等
    captured!.onEsc?.()
    captured!.onClose?.()
    captured!.onEsc?.()
    await flushPromises()
    expect(wslAPI.config.resolveConflict).toHaveBeenCalledTimes(1)
    expect(wslAPI.config.resolveConflict).toHaveBeenCalledWith('settings', 'ignore')
  })

  it('处理冲突失败必须报错提示（不静默）', async () => {
    mount(ConflictResolver)
    wslAPI.config.resolveConflict.mockRejectedValueOnce(new Error('写回失败'))
    dialogResult = 'positive'
    captureConflictHandler()({ fileKey: 'settings', detail: 'diff' })
    await flushPromises()
    expect(message.error).toHaveBeenCalledWith(expect.stringContaining('写回失败'))
  })

  it('说明用多段 VNode 渲染（\\n\\n 不再被 naive dialog 吞掉 — review 0.1.2 根治）', async () => {
    mount(ConflictResolver)
    let captured: Record<string, unknown> | null = null
    dialog.warning.mockImplementationOnce((opts: unknown) => {
      captured = opts as Record<string, unknown>
      return { destroy: vi.fn() }
    })
    captureConflictHandler()({ fileKey: 'settings', detail: '被外部编辑器改过' })
    expect(captured).toBeTruthy()
    // 纯文本 \n\n 会被渲染成一行：必须给出结构化 VNode
    expect(typeof captured!.content).toBe('function')
    const vnode = (captured!.content as () => { children: unknown[] })()
    expect(Array.isArray(vnode.children)).toBe(true)
    expect(vnode.children.length).toBeGreaterThanOrEqual(3)
  })

  it('「暂不处理」有显式第三按钮（不依赖 Esc/X）', async () => {
    mount(ConflictResolver)
    let captured: Record<string, unknown> | null = null
    let inst: { destroy: ReturnType<typeof vi.fn> } | null = null
    dialog.warning.mockImplementationOnce((opts: unknown) => {
      captured = opts as Record<string, unknown>
      inst = { destroy: vi.fn() }
      return inst as never
    })
    captureConflictHandler()({ fileKey: 'distros', detail: 'diff' })
    await flushPromises()
    expect(typeof captured!.action).toBe('function')
    const actionVNode = (
      captured!.action as () => { children: Array<{ props?: { onClick?: () => void } }> }
    )()
    const buttons = actionVNode.children
    expect(buttons).toHaveLength(3)
    buttons[0]!.props!.onClick!()
    await flushPromises()
    expect(wslAPI.config.resolveConflict).toHaveBeenCalledWith('distros', 'ignore')
    // 显式按钮路径同样必须销毁对话框（action slot 替换默认按钮，naive 不会自动 hide）
    expect(inst!.destroy).toHaveBeenCalledTimes(1)
  })

  it('「重载」「覆盖」「暂不处理」三条路径 resolve 后 dialog 实例都被 destroy（叠框恶化根治）', async () => {
    for (const result of ['positive', 'negative', 'close'] as const) {
      dialogInstances.length = 0
      wslAPI.config.resolveConflict.mockClear()
      const w = mount(ConflictResolver)
      dialogResult = result
      captureConflictHandler()({ fileKey: 'settings', detail: 'diff' })
      await flushPromises()
      expect(wslAPI.config.resolveConflict).toHaveBeenCalledTimes(1)
      expect(dialogInstances.length, result).toBeGreaterThan(0)
      expect(dialogInstances[0]!.destroy, result).toHaveBeenCalledTimes(1)
      w.unmount()
    }
  })

  it('多冲突排队：旧框 destroy 后队列项才弹（不叠框）', async () => {
    mount(ConflictResolver)
    const captured: Array<Record<string, unknown>> = []
    const events: string[] = []
    const original = dialog.warning.getMockImplementation()!
    // 挂起对话框：不由 mock 自动应答，模拟用户还没点击
    dialog.warning.mockImplementation((opts: unknown) => {
      captured.push(opts as Record<string, unknown>)
      const n = captured.length
      events.push(`open${n}`)
      return { destroy: vi.fn(() => events.push(`destroy${n}`)) }
    })
    try {
      const handler = captureConflictHandler()
      handler({ fileKey: 'settings', detail: 'diff1' })
      handler({ fileKey: 'network', detail: 'diff2' })
      await flushPromises()
      // 第二个冲突必须排队，不得叠加第二个对话框
      expect(captured).toHaveLength(1)

      ;(captured[0]!.onPositiveClick as () => void)()
      await flushPromises()
      expect(wslAPI.config.resolveConflict).toHaveBeenCalledWith('settings', 'reload')
      // destroy 必须先于下一个弹框：这正是「旧框悬挂 + 队列继续弹」叠框恶化的顺序契约
      expect(events).toEqual(['open1', 'destroy1', 'open2'])

      ;(captured[1]!.onClose as () => void)()
      await flushPromises()
      expect(wslAPI.config.resolveConflict).toHaveBeenCalledWith('network', 'ignore')
      expect(events).toEqual(['open1', 'destroy1', 'open2', 'destroy2'])
    } finally {
      dialog.warning.mockImplementation(original)
    }
  })
})

describe('WslConfPanel 保存与错误面', () => {
  /** 逐个点布尔开关直到脏态成立（首字段值未知，靠保存按钮启用判定） */
  async function makeDirty() {
    for (const el of Array.from(document.body.querySelectorAll('.n-switch'))) {
      el.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      await flushPromises()
      const save = findBodyButton('预览并保存')
      if (save && !save.hasAttribute('disabled')) return
    }
    throw new Error('未能制造脏编辑')
  }

  async function mountDirty() {
    const w = mount(WslConfPanel, {
      props: { distroName: 'Ubuntu' },
      attachTo: document.body,
    })
    await flushPromises()
    await makeDirty()
    return w
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

  it('未运行发行版不发起读取（读取绝不隐式启动 — review 状态门禁）', async () => {
    useDistrosStore().items = [
      { name: 'Ubuntu', state: 'Stopped', version: 2, isDefault: false, meta: null } as never,
    ]
    mount(WslConfPanel, { props: { distroName: 'Ubuntu' }, attachTo: document.body })
    await flushPromises()
    expect(wslAPI.wslconf.read).not.toHaveBeenCalled()
    expect(bodyText()).toContain('发行版未运行')
  })

  it('差异预览渲染 +/- 行内容（不只弹个框）', async () => {
    await mountDirty()
    findBodyButton('预览并保存')!.click()
    await flushPromises()
    const modal = Array.from(document.body.querySelectorAll('.diff-line'))
    expect(modal.length).toBeGreaterThan(0)
    // 至少存在一条新增或删除行（首字段开关被翻转）
    const types = modal.map((el) =>
      el.classList.contains('add') ? 'add' : el.classList.contains('del') ? 'del' : 'same',
    )
    expect(types.some((t) => t === 'add' || t === 'del')).toBe(true)
    const changed = modal.find(
      (el) => el.classList.contains('add') || el.classList.contains('del'),
    )!
    expect(['+', '-']).toContain(changed.querySelector('.sign')!.textContent!.trim())
  })

  it('预览并保存 → 确认写入调用 wslconf.write 并提示已保存', async () => {
    const w = await mountDirty()
    findBodyButton('预览并保存')!.click()
    await flushPromises()
    const confirm = findBodyButton('确认写入')
    expect(confirm, '差异预览应有确认写入按钮').toBeTruthy()
    confirm!.click()
    await flushPromises()
    // 精确对账：首个开关即 automount.enabled（true → false），最小编辑只改这一行
    expect(wslAPI.wslconf.write).toHaveBeenCalledWith('Ubuntu', '[automount]\nenabled = false\n')
    expect(message.success).toHaveBeenCalledWith(expect.stringContaining('wsl.conf 已保存'))
    expect(w.find('p.error').exists()).toBe(false)
  })

  it('raw 模式保存：wslconf.write 收到精确的编辑后内容（替换宽断言 — review 0.1.2）', async () => {
    mount(WslConfPanel, { props: { distroName: 'Ubuntu' }, attachTo: document.body })
    await flushPromises()
    const rawBtn = Array.from(document.body.querySelectorAll('button.mode-btn')).find((b) =>
      (b.textContent ?? '').includes('原始文本'),
    )
    expect(rawBtn, '应有「原始文本」模式按钮').toBeTruthy()
    rawBtn!.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await flushPromises()

    const ta = document.body.querySelector<HTMLTextAreaElement>('.editor-textarea')
    expect(ta).toBeTruthy()
    const edited = '# 手工编辑\n[boot]\nsystemd = true\n'
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!
    setter.call(ta!, edited)
    ta!.dispatchEvent(new Event('input', { bubbles: true }))
    await flushPromises()

    findBodyButton('预览并保存')!.click()
    await flushPromises()
    findBodyButton('确认写入')!.click()
    await flushPromises()
    expect(wslAPI.wslconf.write).toHaveBeenCalledWith('Ubuntu', edited)
  })

  it('保存成功但自动终止失败：warning 如实上报 terminateError（review 0.1.2 根治）', async () => {
    await mountDirty()
    wslAPI.wslconf.write.mockResolvedValueOnce({
      terminated: false,
      terminateError: 'wsl --terminate 超时',
    })
    findBodyButton('预览并保存')!.click()
    await flushPromises()
    findBodyButton('确认写入')!.click()
    await flushPromises()
    expect(message.warning).toHaveBeenCalledWith(
      expect.stringContaining('wsl.conf 已保存，但按设置自动终止发行版失败'),
    )
    expect(message.warning).toHaveBeenCalledWith(expect.stringContaining('wsl --terminate 超时'))
    // 保存成功路径与终止失败并存：不得再报「已保存 · 生效」的 success
    expect(message.success).not.toHaveBeenCalled()
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

  it('保存成功后刷新 distros store（autoShutdown 后运行状态失真 — review 0.1.2 根治）', async () => {
    wslAPI.distros.list.mockResolvedValue([
      { name: 'Ubuntu', state: 'Stopped', version: 2, isDefault: true, meta: null } as never,
    ])
    await mountDirty()
    findBodyButton('预览并保存')!.click()
    await flushPromises()
    findBodyButton('确认写入')!.click()
    await flushPromises()
    expect(wslAPI.wslconf.write).toHaveBeenCalled()
    // 真刷新：store 中的 Running 夹具被磁盘真实状态（Stopped）替换
    expect(useDistrosStore().byName('Ubuntu')?.state).toBe('Stopped')
  })

  it('「重新载入」先过脏守卫：留在此页不重载，确认放弃后才重载', async () => {
    await mountDirty()
    const reads = wslAPI.wslconf.read.mock.calls.length

    dialogResult = 'negative' // 留在此页
    findBodyButton('重新载入')!.click()
    await flushPromises()
    expect(dialog.warning).toHaveBeenCalledWith(
      expect.objectContaining({ title: '放弃未保存的修改？' }),
    )
    expect(wslAPI.wslconf.read.mock.calls.length).toBe(reads)

    dialogResult = 'positive' // 放弃修改
    findBodyButton('重新载入')!.click()
    await flushPromises()
    expect(wslAPI.wslconf.read.mock.calls.length).toBe(reads + 1)
  })

  it('切换确认丢弃后 discardConfirmed 复位：再次编辑再卸载仍如实提示', async () => {
    useDistrosStore().items = [
      RUNNING,
      { name: 'Debian', state: 'Running', version: 2, isDefault: false, meta: null } as never,
    ]
    const w = mount(WslConfPanel, {
      props: { distroName: 'Ubuntu' },
      attachTo: document.body,
    })
    await flushPromises()
    await makeDirty()

    dialogResult = 'positive'
    await w.setProps({ distroName: 'Debian' })
    await flushPromises()
    // 新发行版重新编辑出脏态，再直接卸载（如路由离开）
    await makeDirty()
    message.warning.mockClear()
    w.unmount()
    expect(message.warning).toHaveBeenCalledWith('wsl.conf 有未保存的修改已丢弃')
  })

  it('等待确认期间父级回切：旧目标的续体不得执行加载（review 0.1.2 审计修复）', async () => {
    useDistrosStore().items = [
      RUNNING,
      { name: 'Debian', state: 'Running', version: 2, isDefault: false, meta: null } as never,
    ]
    const w = mount(WslConfPanel, {
      props: { distroName: 'Ubuntu' },
      attachTo: document.body,
    })
    await flushPromises()
    await makeDirty()
    const reads = wslAPI.wslconf.read.mock.calls.length

    // 挂起确认框：模拟用户还未点击（await confirmDiscard 在途）
    const captured: Array<Record<string, unknown>> = []
    const original = dialog.warning.getMockImplementation()!
    dialog.warning.mockImplementation((opts: unknown) => {
      captured.push(opts as Record<string, unknown>)
      return { destroy: vi.fn() }
    })
    try {
      await w.setProps({ distroName: 'Debian' })
      await flushPromises()
      expect(captured).toHaveLength(1)

      // 等待期间另一面板 restore-distro 把父级拉回 Ubuntu
      await w.setProps({ distroName: 'Ubuntu' })
      await flushPromises()

      // 用户此刻才点「放弃修改」：Debian 的旧续体必须复验 props 后失效
      ;(captured[0]!.onPositiveClick as () => void)()
      await flushPromises()
      expect(wslAPI.wslconf.read.mock.calls.length).toBe(reads)
      expect(wslAPI.wslconf.read).not.toHaveBeenCalledWith('Debian')
      // 未误发 restore-distro（父级已在 Ubuntu，无需回退）
      expect(w.emitted('restore-distro')).toBeUndefined()
    } finally {
      dialog.warning.mockImplementation(original)
    }
  })
})
