import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { enableAutoUnmount, mount, flushPromises } from '@vue/test-utils'
import {
  appError,
  createWslAPI,
  configGetImpl,
  distro,
  findButton,
  findBodyButton,
  bodyText,
  type WslAPIMock,
} from './support'

enableAutoUnmount(afterEach)

/**
 * DashboardView / DistrosView（卡片操作与清理）+ TaskDrawer / InstallDistroModal /
 * TerminalView（任务与会话错误面）。
 * popconfirm 类操作必须走「触发 → 确认」两段点击，确认按钮 teleport 到 body。
 */

const message = {
  success: vi.fn(),
  warning: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
}
const dialog = {
  warning: vi.fn((opts: { onPositiveClick?: () => void; onNegativeClick?: () => void }) =>
    opts.onPositiveClick?.(),
  ),
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
const { useTasksStore } = await import('../../src/renderer/stores/tasks')
const { useTerminalStore } = await import('../../src/renderer/stores/terminal')
const DashboardView = (await import('../../src/renderer/views/DashboardView.vue')).default
const DistrosView = (await import('../../src/renderer/views/DistrosView.vue')).default
const TaskDrawer = (await import('../../src/renderer/features/tasks/TaskDrawer.vue')).default
const InstallDistroModal = (
  await import('../../src/renderer/features/distros/InstallDistroModal.vue')
).default
const TerminalView = (await import('../../src/renderer/views/TerminalView.vue')).default

const dashStubs = { InstallDistroModal: true, DistroDetailModal: true }

/** 点击 popconfirm 触发器后确认（确认按钮 teleport 到 body） */
async function confirmPop(triggerText: string) {
  const trigger = Array.from(document.body.querySelectorAll('button')).find((b) =>
    (b.textContent ?? '').includes(triggerText),
  )
  expect(trigger, `popconfirm 触发器「${triggerText}」`).toBeTruthy()
  trigger!.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  await flushPromises()
  // 未注入 zhCN locale 时 naive 默认英文 Confirm/确定
  const ok = findBodyButton('Confirm') ?? findBodyButton('确定') ?? findBodyButton('确认')
  expect(ok, 'popconfirm 应有确认按钮').toBeTruthy()
  ok!.click()
  await flushPromises()
}

beforeEach(() => {
  vi.clearAllMocks()
  setActivePinia(createPinia())
  document.body.innerHTML = ''
  wslAPI.config.get.mockImplementation(configGetImpl())
  wslAPI.distros.list.mockResolvedValue([])
  wslAPI.terminal.list.mockResolvedValue([])
  wslAPI.distros.listOnline.mockResolvedValue(['Ubuntu', 'Debian'])
})

describe('DashboardView 卡片与清理', () => {
  it('启动失败展示错误提示；清理旧备份成功提示份数', async () => {
    wslAPI.distros.list.mockResolvedValue([distro()])
    wslAPI.distros.start.mockRejectedValueOnce(appError('启动超时'))
    wslAPI.io.cleanupBackups.mockResolvedValueOnce({ removed: 3 })
    mount(DashboardView, { attachTo: document.body, global: { stubs: dashStubs } })
    await flushPromises()

    const start = Array.from(document.body.querySelectorAll('button')).find(
      (b) => b.textContent?.trim() === '启动',
    )
    expect(start, 'DistroCard 应有启动按钮').toBeTruthy()
    start!.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await flushPromises()
    expect(wslAPI.distros.start).toHaveBeenCalledWith('Ubuntu')
    expect(message.error).toHaveBeenCalledWith(expect.stringContaining('启动超时'))

    await confirmPop('清理旧备份')
    expect(wslAPI.io.cleanupBackups).toHaveBeenCalled()
    expect(message.success).toHaveBeenCalledWith('已清理 3 份旧备份')
  })

  it('清理旧备份失败给错误提示（错误态）', async () => {
    wslAPI.io.cleanupBackups.mockRejectedValueOnce(appError('目录被占用'))
    mount(DashboardView, { attachTo: document.body, global: { stubs: dashStubs } })
    await flushPromises()
    await confirmPop('清理旧备份')
    expect(message.error).toHaveBeenCalledWith(expect.stringContaining('目录被占用'))
  })

  it('全部关机调用 distros.shutdown', async () => {
    wslAPI.distros.list.mockResolvedValue([distro()])
    mount(DashboardView, { attachTo: document.body, global: { stubs: dashStubs } })
    await flushPromises()
    await confirmPop('全部关机')
    expect(wslAPI.distros.shutdown).toHaveBeenCalled()
    expect(message.success).toHaveBeenCalledWith('已关闭全部发行版')
  })

  it('网络入口跳转 /network', async () => {
    const w = mount(DashboardView, {
      attachTo: document.body,
      global: { stubs: dashStubs },
    })
    await flushPromises()
    findButton(w, '网络配置')!.element.click()
    await flushPromises()
    expect(routerMock.push).toHaveBeenCalledWith('/network')
  })
})

describe('DistrosView 筛选与操作', () => {
  it('搜索词过滤列表；清空筛选恢复全量', async () => {
    wslAPI.distros.list.mockResolvedValue([distro(), distro({ name: 'Debian' })])
    const w = mount(DistrosView, {
      attachTo: document.body,
      global: { stubs: { DistroDetailModal: true } },
    })
    await flushPromises()
    expect(w.findAll('.grid > *')).toHaveLength(2)

    const search = w.find('input[placeholder="搜索名称 / 别名 / 备注"]')
    await search.setValue('Debian')
    await flushPromises()
    expect(w.findAll('.grid > *')).toHaveLength(1)
    expect(w.text()).toContain('Debian')
    expect(w.text()).not.toContain('Ubuntu')

    // 无匹配 → 空态提供「清除筛选」
    await search.setValue('不存在的发行版')
    await flushPromises()
    expect(w.text()).toContain('清除筛选')
    findButton(w, '清除筛选')!.element.click()
    await flushPromises()
    expect(w.findAll('.grid > *')).toHaveLength(2)
  })

  it('启动失败展示错误提示（错误态）', async () => {
    wslAPI.distros.list.mockResolvedValue([distro()])
    wslAPI.distros.start.mockRejectedValueOnce(appError('wsl 拒绝'))
    mount(DistrosView, {
      attachTo: document.body,
      global: { stubs: { DistroDetailModal: true } },
    })
    await flushPromises()
    const start = Array.from(document.body.querySelectorAll('button')).find(
      (b) => b.textContent?.trim() === '启动',
    )
    expect(start).toBeTruthy()
    start!.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await flushPromises()
    expect(message.error).toHaveBeenCalledWith(expect.stringContaining('wsl 拒绝'))
  })

  it('表格模式渲染操作列', async () => {
    wslAPI.distros.list.mockResolvedValue([distro({ state: 'Running' })])
    const w = mount(DistrosView, {
      attachTo: document.body,
      global: { stubs: { DistroDetailModal: true } },
    })
    await flushPromises()
    // n-radio-button 渲染为 label 而非 button
    const tableOpt = w.findAll('label').find((l) => l.text().includes('表格'))!
    expect(tableOpt).toBeTruthy()
    tableOpt.element.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await flushPromises()
    expect(w.find('table').exists()).toBe(true)
  })
})

describe('TaskDrawer 取消与日志', () => {
  it('取消失败给错误提示；日志逐行渲染', async () => {
    const tasks = useTasksStore()
    tasks.applyProgress({
      taskId: 't1',
      type: 'export',
      distro: 'Ubuntu',
      percent: 10,
      message: '导出中',
      status: 'running',
      logLine: '第一行日志',
    })
    wslAPI.task.cancel.mockRejectedValueOnce(appError('任务已结束'))
    mount(TaskDrawer, { props: { show: true }, attachTo: document.body })
    await flushPromises()
    expect(bodyText()).toContain('第一行日志')

    findBodyButton('取消')!.click()
    await flushPromises()
    expect(wslAPI.task.cancel).toHaveBeenCalledWith('t1')
    expect(message.error).toHaveBeenCalledWith(expect.stringContaining('任务已结束'))
  })

  it('清理已完成：仅保留 running 任务并提示', async () => {
    const tasks = useTasksStore()
    tasks.applyProgress({
      taskId: 'r1',
      type: 'import',
      distro: 'U',
      percent: 50,
      message: '进行中',
      status: 'running',
    })
    tasks.applyProgress({
      taskId: 'f1',
      type: 'export',
      distro: 'U',
      percent: 100,
      message: '完成',
      status: 'success',
    })
    mount(TaskDrawer, { props: { show: true }, attachTo: document.body })
    await flushPromises()
    findBodyButton('清理已完成')!.click()
    await flushPromises()
    expect(useTasksStore().entries.map((e) => e.taskId)).toEqual(['r1'])
    expect(message.success).toHaveBeenCalledWith('已清理完成的任务')
  })

  it('日志用单 <pre> 拼接渲染（无逐行 div，role=log aria-live — review 0.1.2 根治）', async () => {
    const tasks = useTasksStore()
    tasks.applyProgress({
      taskId: 't1',
      type: 'export',
      distro: 'U',
      percent: 10,
      message: '导出中',
      status: 'running',
      logLine: '第一行日志',
    })
    tasks.applyProgress({
      taskId: 't1',
      type: 'export',
      percent: 20,
      message: '导出中',
      status: 'running',
      logLine: '第二行日志',
    })
    mount(TaskDrawer, { props: { show: true }, attachTo: document.body })
    await flushPromises()
    const pre = document.body.querySelector('pre.log')
    expect(pre).toBeTruthy()
    expect(pre!.getAttribute('role')).toBe('log')
    expect(pre!.getAttribute('aria-live')).toBe('polite')
    expect(pre!.textContent).toContain('第一行日志')
    expect(pre!.textContent).toContain('第二行日志')
    // 2000 行不再产生 2000 个节点
    expect(document.body.querySelectorAll('.log-line')).toHaveLength(0)
  })

  it('取消按钮在途禁用（pending 防重 — review 0.1.2 根治）', async () => {
    const tasks = useTasksStore()
    tasks.applyProgress({
      taskId: 't2',
      type: 'export',
      distro: 'U',
      percent: 10,
      message: '导出中',
      status: 'running',
    })
    let releaseCancel!: (v: boolean) => void
    wslAPI.task.cancel.mockReturnValueOnce(
      new Promise((r) => {
        releaseCancel = r
      }) as never,
    )
    mount(TaskDrawer, { props: { show: true }, attachTo: document.body })
    await flushPromises()
    const btn = findBodyButton('取消')!
    expect(btn).toBeTruthy()
    btn.click()
    await flushPromises()
    expect(wslAPI.task.cancel).toHaveBeenCalledTimes(1)
    // 在途：按钮 disabled/pending，重复点击不再发请求
    expect(btn.disabled).toBe(true)
    btn.click()
    await flushPromises()
    expect(wslAPI.task.cancel).toHaveBeenCalledTimes(1)
    releaseCancel(true)
    await flushPromises()
  })
})

describe('InstallDistroModal', () => {
  /** show 从 false → true 才触发 watch(immediate 否)里的 loadOnline */
  async function openModal() {
    const w = mount(InstallDistroModal, {
      props: { show: false },
      attachTo: document.body,
    })
    await w.setProps({ show: true })
    await flushPromises()
    return w
  }

  it('listOnline 失败给错误提示；成功列出可选项', async () => {
    wslAPI.distros.listOnline.mockRejectedValueOnce(appError('网络不可达'))
    await openModal()
    expect(wslAPI.distros.listOnline).toHaveBeenCalled()
    // errorLine 对有 message 的错误展示根因（不吞真实原因）
    expect(message.error).toHaveBeenCalledWith(expect.stringContaining('网络不可达'))
    // n-modal teleport 到 body
    expect(document.body.querySelector('.install-modal')).toBeTruthy()
  })

  it('启动安装调用 distros.install；启动失败给错误提示', async () => {
    await openModal()
    findBodyButton('开始安装')!.click()
    await flushPromises()
    expect(wslAPI.distros.install).toHaveBeenCalled()

    wslAPI.distros.install.mockRejectedValueOnce(appError('提权被拒绝'))
    await openModal()
    findBodyButton('开始安装')!.click()
    await flushPromises()
    expect(message.error).toHaveBeenCalledWith(expect.stringContaining('提权被拒绝'))
  })

  it('安装进行中点击关闭被拦截并提示', async () => {
    const w = await openModal()
    findBodyButton('开始安装')!.click()
    await flushPromises()
    // 卡片右上角关闭 → close() 拦截
    const closeBtn = document.body.querySelector<HTMLButtonElement>(
      '.install-modal .n-card-header__close',
    )
    if (closeBtn) {
      closeBtn.click()
      await flushPromises()
      expect(message.warning).toHaveBeenCalledWith('安装进行中，请先取消或等待完成')
    } else {
      // 无关闭按钮时走 n-modal 的 update:show 路径（mask 关闭）
      await w.setProps({ show: false })
      await flushPromises()
      expect(message.warning).toHaveBeenCalledWith('安装进行中，请先取消或等待完成')
    }
    expect(w.emitted('update:show')).toBeUndefined()
  })
})

describe('TerminalView 会话错误面', () => {
  it('无默认发行版时「打开终端」按钮禁用', async () => {
    const w = mount(TerminalView, { attachTo: document.body })
    await flushPromises()
    expect(w.text()).toContain('还没有终端会话')
    const btn = w.findAll('button').find((b) => b.text().includes('打开'))!
    expect(btn.element.hasAttribute('disabled')).toBe(true)
  })

  it('建会话失败展示错误提示（错误态）', async () => {
    // 终端只服务运行中发行版（review 状态门禁）：夹具必须 Running 才会进入建会话流程
    wslAPI.distros.list.mockResolvedValue([distro({ state: 'Running' })])
    wslAPI.terminal.create.mockRejectedValueOnce(appError('pty 创建失败'))
    mount(TerminalView, { attachTo: document.body })
    await flushPromises()
    expect(message.error).toHaveBeenCalledWith(expect.stringContaining('pty 创建失败'))
  })

  it('未运行发行版不进终端：下拉只列 Running，自动建标签不隐式启动（review 状态门禁）', async () => {
    wslAPI.distros.list.mockResolvedValue([
      distro({ name: 'Stopped-one', state: 'Stopped' }),
      distro({ name: 'Run-one', state: 'Running' }),
    ])
    const w = mount(TerminalView, { attachTo: document.body })
    await flushPromises()
    // 自动建标签只对 Running 生效（不触发 create → 无调用）以外：默认目标 = Run-one
    const tabs = w.findComponent({ name: 'TerminalTabs' })
    const opts = (tabs.props('distroOptions') as Array<{ value: string }>) ?? []
    expect(opts.map((o) => o.value)).toEqual(['Run-one'])
    // Stopped-one 不可选
    expect(opts.some((o) => o.value === 'Stopped-one')).toBe(false)
  })

  it('创建在途时 in-flight 名单传给 TerminalTabs（打开按钮 loading 依据 — review 0.1.2 根治）', async () => {
    wslAPI.distros.list.mockResolvedValue([distro({ state: 'Running' })])
    let releaseCreate!: (v: unknown) => void
    wslAPI.terminal.create.mockReturnValueOnce(
      new Promise((r) => {
        releaseCreate = r
      }) as never,
    )
    const w = mount(TerminalView, { attachTo: document.body })
    await flushPromises()
    const tabs = w.findComponent({ name: 'TerminalTabs' })
    expect(tabs.exists()).toBe(true)
    expect(tabs.props('creatingDistros')).toContain('Ubuntu')

    releaseCreate({ ptyId: 'p1', distro: 'Ubuntu', createdAt: 1 })
    await flushPromises()
    expect(tabs.props('creatingDistros')).toEqual([])
  })

  it('关闭会话失败给错误提示', async () => {
    useTerminalStore().adopt('p1', { title: 'Ubuntu', distro: 'Ubuntu' })
    wslAPI.terminal.kill.mockRejectedValueOnce(appError('进程已退出'))
    const w = mount(TerminalView, { attachTo: document.body })
    await flushPromises()
    // TerminalTabs 的 close 事件 → TerminalView.close() → kill 失败 → message.error
    const tabs = w.findComponent({ name: 'TerminalTabs' })
    expect(tabs.exists()).toBe(true)
    tabs.vm.$emit('close', 'p1')
    await flushPromises()
    expect(wslAPI.terminal.kill).toHaveBeenCalledWith('p1')
    expect(message.error).toHaveBeenCalledWith(expect.stringContaining('进程已退出'))
  })
})
