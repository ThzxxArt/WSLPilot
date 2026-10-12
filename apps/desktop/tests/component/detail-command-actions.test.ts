import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { enableAutoUnmount, mount, flushPromises } from '@vue/test-utils'
import type { WslAction } from '@wslpilot/shared'
import {
  appError,
  createWslAPI,
  configGetImpl,
  distro,
  findBodyButton,
  bodyText,
  type WslAPIMock,
} from './support'

enableAutoUnmount(afterEach)

/**
 * DistroDetailModal 注册表详情面 + CommandPalette 键盘/搜索/设置项 +
 * ActionsPanel 动作 CRUD 面（quality-fixes 之外的交互与错误态）。
 */

const message = {
  success: vi.fn(),
  warning: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
}
const dialogResult = { value: true }
const dialog = {
  warning: vi.fn((opts: { onPositiveClick?: () => void; onNegativeClick?: () => void }) => {
    if (dialogResult.value) opts.onPositiveClick?.()
    else opts.onNegativeClick?.()
  }),
  error: vi.fn(),
  info: vi.fn(),
  success: vi.fn(),
}
const notification = {
  warning: vi.fn((_opts: { action?: () => unknown }) => ({ destroy: vi.fn() })),
  success: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
}

vi.mock('naive-ui', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>()
  return {
    ...actual,
    useMessage: () => message,
    useDialog: () => dialog,
    useNotification: () => notification,
  }
})

const routerMock = { push: vi.fn() }
vi.mock('vue-router', () => ({
  useRouter: () => routerMock,
  useRoute: () => ({ query: {} }),
}))

let wslAPI: WslAPIMock
;(globalThis as any).window.wslAPI = wslAPI = createWslAPI()

const { createPinia, setActivePinia } = await import('pinia')
const { useDistrosStore } = await import('../../src/renderer/stores/distros')
const { useActionsStore } = await import('../../src/renderer/stores/actions')
const { useCommandPalette } = await import('../../src/renderer/composables/useCommandPalette')
const DistroDetailModal = (
  await import('../../src/renderer/features/distros/DistroDetailModal.vue')
).default
const CommandPalette = (await import('../../src/renderer/features/command/CommandPalette.vue'))
  .default
const ActionsPanel = (await import('../../src/renderer/features/actions/ActionsPanel.vue')).default

const stubs = { WslConfPanel: true, ActionsPanel: true, FileBrowserPanel: true }

beforeEach(() => {
  vi.clearAllMocks()
  dialogResult.value = true
  setActivePinia(createPinia())
  useCommandPalette().closePalette()
  document.body.innerHTML = ''
  wslAPI.config.get.mockImplementation(configGetImpl())
  wslAPI.distros.registryDetail.mockResolvedValue({ values: {} })
  wslAPI.meta.get.mockResolvedValue(null)
})

describe('DistroDetailModal 注册表与动作面', () => {
  it('registryDetail 读取失败：GUID 行展示「注册表信息不可用」（不编造）', async () => {
    wslAPI.distros.registryDetail.mockRejectedValueOnce(appError('注册表拒绝访问'))
    mount(DistroDetailModal, {
      props: { show: true, distroName: 'Ubuntu' },
      attachTo: document.body,
      global: { stubs },
    })
    await flushPromises()
    expect(bodyText()).toContain('（注册表信息不可用）')
  })

  it('registryDetail 成功展示 GUID 与默认 UID', async () => {
    wslAPI.distros.registryDetail.mockResolvedValueOnce({
      guid: '1234-ABCD',
      defaultUid: 1000,
      version: 2,
      flags: 15,
      basePath: 'C:\\WSL\\Ubuntu',
      values: { DistributionName: 'Ubuntu' },
    })
    mount(DistroDetailModal, {
      props: { show: true, distroName: 'Ubuntu' },
      attachTo: document.body,
      global: { stubs },
    })
    await flushPromises()
    expect(bodyText()).toContain('1234-ABCD')
    expect(bodyText()).toContain('1000')
    expect(bodyText()).toContain('0xf')
  })

  it('启动/停止调用 distros.start / terminate 并刷新', async () => {
    useDistrosStore().items = [distro()]
    mount(DistroDetailModal, {
      props: { show: true, distroName: 'Ubuntu' },
      attachTo: document.body,
      global: { stubs },
    })
    await flushPromises()
    findBodyButton('启动')!.click()
    await flushPromises()
    expect(wslAPI.distros.start).toHaveBeenCalledWith('Ubuntu')

    useDistrosStore().items = [distro({ state: 'Running' })]
    await flushPromises()
    findBodyButton('停止')!.click()
    await flushPromises()
    expect(wslAPI.distros.terminate).toHaveBeenCalledWith('Ubuntu')
  })

  it('打开终端受状态门禁：未运行禁用、运行中可点（review 启动只能走启动按钮）', async () => {
    useDistrosStore().items = [distro({ state: 'Stopped' })]
    mount(DistroDetailModal, {
      props: { show: true, distroName: 'Ubuntu' },
      attachTo: document.body,
      global: { stubs },
    })
    await flushPromises()
    const termStopped = findBodyButton('打开终端')!
    expect(termStopped.hasAttribute('disabled')).toBe(true)
    // 未运行时「停止」不出现、「启动」出现（状态驱动按钮）
    expect(findBodyButton('停止')).toBeFalsy()
    expect(findBodyButton('启动')).toBeTruthy()

    useDistrosStore().items = [distro({ state: 'Running' })]
    await flushPromises()
    const termRunning = findBodyButton('打开终端')!
    expect(termRunning.hasAttribute('disabled')).toBe(false)
    expect(findBodyButton('启动')).toBeFalsy()
    expect(findBodyButton('停止')).toBeTruthy()
  })

  it('启动失败展示错误提示（错误态）', async () => {
    useDistrosStore().items = [distro()]
    wslAPI.distros.start.mockRejectedValueOnce(appError('wsl.exe 返回 1'))
    mount(DistroDetailModal, {
      props: { show: true, distroName: 'Ubuntu' },
      attachTo: document.body,
      global: { stubs },
    })
    await flushPromises()
    findBodyButton('启动')!.click()
    await flushPromises()
    expect(message.error).toHaveBeenCalledWith(expect.stringContaining('wsl.exe 返回 1'))
  })

  it('保存元数据成功调用 meta.set 并关闭编辑；失败给错误提示', async () => {
    useDistrosStore().items = [distro()]
    // saveMeta 成功后 distros.refresh() 重读列表：mock 返回同名发行版，按钮保持可用
    wslAPI.distros.list.mockResolvedValue([distro()])
    const w = mount(DistroDetailModal, {
      props: { show: true, distroName: 'Ubuntu' },
      attachTo: document.body,
      global: { stubs },
    })
    await flushPromises()
    findBodyButton('编辑元数据')!.click()
    await flushPromises()
    findBodyButton('保存元数据')!.click()
    await flushPromises()
    expect(wslAPI.meta.set).toHaveBeenCalledWith(
      // 全字段契约（9 项）：不留「只断 name，其余字段错位也全绿」的假信心
      expect.objectContaining({
        name: 'Ubuntu',
        alias: '',
        tags: [],
        color: '',
        icon: 'linux',
        note: '',
        startupCwd: '~',
        pinned: false,
        quickActions: [],
      }),
    )
    expect(message.success).toHaveBeenCalledWith('元数据已保存')

    findBodyButton('编辑元数据')!.click()
    await flushPromises()
    wslAPI.meta.set.mockRejectedValueOnce(appError('磁盘只读'))
    findBodyButton('保存元数据')!.click()
    await flushPromises()
    expect(message.error).toHaveBeenCalledWith(expect.stringContaining('磁盘只读'))
    expect(w.emitted('update:show')).toBeUndefined()
  })
})

describe('CommandPalette 搜索与键盘面', () => {
  async function openPalette() {
    const w = mount(CommandPalette, { attachTo: document.body })
    useCommandPalette().openPalette()
    await flushPromises()
    return w
  }

  function paletteInput(): HTMLInputElement {
    return document.body.querySelector<HTMLInputElement>('.palette-input')!
  }

  it('搜索过滤：输入「设置」只显示匹配项；无匹配展示空态', async () => {
    await openPalette()
    const input = paletteInput()
    input.value = '打开 settings.jsonc'
    input.dispatchEvent(new Event('input', { bubbles: true }))
    await flushPromises()
    const items = Array.from(document.body.querySelectorAll('.palette-item'))
    expect(items.length).toBeGreaterThan(0)
    expect(bodyText()).not.toContain('没有匹配的命令')

    input.value = 'zzz-绝不存在的命令-zzz'
    input.dispatchEvent(new Event('input', { bubbles: true }))
    await flushPromises()
    expect(bodyText()).toContain('没有匹配的命令')
  })

  it('方向键移动高亮，Enter 执行高亮项（导航跳转）', async () => {
    await openPalette()
    const input = paletteInput()
    // 锁定导航组：只搜「前往：网络」
    input.value = '前往：网络'
    input.dispatchEvent(new Event('input', { bubbles: true }))
    await flushPromises()
    const palette = document.body.querySelector('.palette')!
    palette.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }))
    await flushPromises()
    palette.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    await flushPromises()
    expect(routerMock.push).toHaveBeenCalledWith('/network')
  })

  it('Esc 关闭面板（closePalette）', async () => {
    await openPalette()
    const palette = document.body.querySelector('.palette')!
    palette.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    await flushPromises()
    expect(useCommandPalette().open.value).toBe(false)
  })

  it('设置项「减弱动效」切换写入 config.set', async () => {
    useDistrosStore().items = []
    await openPalette()
    const input = paletteInput()
    input.value = '减弱动效'
    input.dispatchEvent(new Event('input', { bubbles: true }))
    await flushPromises()
    const btn = Array.from(document.body.querySelectorAll('.palette-item')).find((b) =>
      (b.textContent ?? '').includes('减弱动效'),
    )
    expect(btn).toBeTruthy()
    btn!.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await flushPromises()
    expect(wslAPI.config.set).toHaveBeenCalledWith(
      'settings',
      expect.objectContaining({ general: expect.objectContaining({ reduceMotion: true }) }),
    )
  })
})

describe('ActionsPanel CRUD 面', () => {
  function action(over: Partial<WslAction> = {}): WslAction {
    return {
      id: 'a1',
      label: '清缓存',
      scope: 'distro',
      program: '/bin/rm',
      args: ['-rf', '/tmp/x'],
      terminal: false,
      confirm: true,
      ...over,
    }
  }

  it('新建动作：空 ID 拦截、非法 ID 拦截、合法保存调用 actions.save', async () => {
    useActionsStore().items = []
    useActionsStore().loaded = true
    const w = mount(ActionsPanel, { props: { distroName: 'Ubuntu' }, attachTo: document.body })
    await flushPromises()
    w.findAll('button')
      .find((b) => b.text().includes('新建动作'))!
      .element.click()
    await flushPromises()

    // 空 ID → 提示且不保存
    findBodyButton('保存')!.click()
    await flushPromises()
    expect(message.warning).toHaveBeenCalledWith('id / 显示名 / 程序不能为空')
    expect(wslAPI.actions.save).not.toHaveBeenCalled()

    const byPlaceholder = (ph: string) =>
      document.body.querySelector<HTMLInputElement>(`.form-grid input[placeholder="${ph}"]`)!
    const setVal = (el: HTMLInputElement, v: string) => {
      el.value = v
      el.dispatchEvent(new Event('input', { bubbles: true }))
    }
    const idInput = byPlaceholder('update-all')
    const labelInput = byPlaceholder('全量更新')
    const programInput = byPlaceholder('/usr/bin/bash')
    expect(idInput && labelInput && programInput).toBeTruthy()

    // 非法 ID 字符 → 提示
    setVal(idInput, 'bad/id')
    setVal(labelInput, '显示名')
    setVal(programInput, '/bin/true')
    await flushPromises()
    findBodyButton('保存')!.click()
    await flushPromises()
    expect(message.warning).toHaveBeenCalledWith('id 含非法字符')
    expect(wslAPI.actions.save).not.toHaveBeenCalled()

    // 合法 → upsert 走 actions.save
    setVal(idInput, 'good-id')
    await flushPromises()
    findBodyButton('保存')!.click()
    await flushPromises()
    expect(wslAPI.actions.save).toHaveBeenCalledWith([
      expect.objectContaining({ id: 'good-id', label: '显示名', program: '/bin/true' }),
    ])
  })

  it('打开 actions.jsonc 失败给错误提示（不静默）', async () => {
    useActionsStore().items = []
    useActionsStore().loaded = true
    wslAPI.config.openExternal.mockRejectedValueOnce(appError('找不到编辑器'))
    const w = mount(ActionsPanel, { props: { distroName: 'Ubuntu' }, attachTo: document.body })
    await flushPromises()
    w.findAll('button')
      .find((b) => b.text().includes('打开 actions.jsonc'))!
      .element.click()
    await flushPromises()
    expect(wslAPI.config.openExternal).toHaveBeenCalledWith('actions')
    expect(message.error).toHaveBeenCalledWith(expect.stringContaining('找不到编辑器'))
  })

  it('无确认动作直接运行；运行失败给错误提示', async () => {
    useActionsStore().items = [action({ confirm: false })]
    useActionsStore().loaded = true
    const w = mount(ActionsPanel, { props: { distroName: 'Ubuntu' }, attachTo: document.body })
    await flushPromises()
    w.findAll('button')
      .find((b) => b.text().includes('运行'))!
      .element.click()
    await flushPromises()
    expect(wslAPI.actions.run).toHaveBeenCalledWith('a1', 'Ubuntu')

    wslAPI.actions.run.mockRejectedValueOnce(appError('动作执行炸了'))
    w.findAll('button')
      .find((b) => b.text().includes('运行'))!
      .element.click()
    await flushPromises()
    expect(message.error).toHaveBeenCalledWith(expect.stringContaining('动作执行炸了'))
  })

  it('删除动作可撤销：通知 action 触发 undoRestore 回写', async () => {
    useActionsStore().items = [action()]
    useActionsStore().loaded = true
    dialogResult.value = true
    const w = mount(ActionsPanel, { props: { distroName: 'Ubuntu' }, attachTo: document.body })
    await flushPromises()
    w.findAll('button')
      .find((b) => b.text().includes('删除'))!
      .element.click()
    await flushPromises()
    expect(wslAPI.actions.save).toHaveBeenCalledWith([])
    expect(notification.warning).toHaveBeenCalled()

    // 通知里的「撤销」回调：action() 返回按钮 VNode，点击其 onClick 触发 undoRestore
    const nCall = notification.warning.mock.calls[0]![0]! as unknown as {
      action: () => { props?: { onClick?: () => void } }
    }
    expect(typeof nCall.action).toBe('function')
    const vnode = nCall.action()
    expect(vnode.props?.onClick).toBeTruthy()
    vnode.props!.onClick!()
    await flushPromises()
    expect(wslAPI.actions.save).toHaveBeenLastCalledWith([expect.objectContaining({ id: 'a1' })])
  })
})
