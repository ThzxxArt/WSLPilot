import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { enableAutoUnmount, mount, flushPromises } from '@vue/test-utils'
import { NRadioGroup, NSelect } from 'naive-ui'
import {
  appError,
  createWslAPI,
  distro,
  findButton,
  findBodyButton,
  type WslAPIMock,
} from './support'

enableAutoUnmount(afterEach)

/**
 * 0.1.3 新 UI 行为面：WSL 环境卡（安装/更新/回滚/默认版本）、.wslconfig 面板、
 * 克隆向导、详情页磁盘/稀疏、终端标签新建（Shell/目录）。
 */

const message = {
  success: vi.fn(),
  warning: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
}
const dialog = {
  warning: vi.fn((opts: { onPositiveClick?: () => void; onNegativeClick?: () => void }) => {
    opts.onPositiveClick?.()
  }),
  error: vi.fn(),
  info: vi.fn(),
  success: vi.fn(),
}
const notification = {
  warning: vi.fn(() => ({ destroy: vi.fn() })),
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

vi.mock('vue-router', () => ({
  useRouter: () => ({ push: vi.fn() }),
  useRoute: () => ({ query: {} }),
}))

let wslAPI: WslAPIMock
;(globalThis as any).window.wslAPI = wslAPI = createWslAPI()

const { createPinia, setActivePinia } = await import('pinia')
const { useTasksStore } = await import('../../src/renderer/stores/tasks')
const WslEnvironmentCard = (await import('../../src/renderer/features/wsl/WslEnvironmentCard.vue'))
  .default
const WslConfigPanel = (await import('../../src/renderer/features/config/WslConfigPanel.vue'))
  .default
const CloneDistroModal = (await import('../../src/renderer/features/distros/CloneDistroModal.vue'))
  .default
const DistroDetailModal = (
  await import('../../src/renderer/features/distros/DistroDetailModal.vue')
).default
const TerminalTabs = (await import('../../src/renderer/features/terminal/TerminalTabs.vue')).default

beforeEach(() => {
  vi.clearAllMocks()
  setActivePinia(createPinia())
  document.body.innerHTML = ''
  // 默认环境：已安装 WSL2；单个用例可 mockResolvedValueOnce 覆盖
  wslAPI.app.wslEnv.mockResolvedValue({
    installed: true,
    wslVersion: '2.3.4',
    kernelVersion: '5.15.153',
    defaultDistro: 'Ubuntu',
    defaultVersion: 2,
    statusRaw: '',
    capabilities: {
      source: 'help',
      wslVersion: '3.0.3.0',
      windowsBuild: 26300,
      wslcVersion: '3.0.3.0',
      inbox: false,
      flags: {
        compact: true,
        resize: true,
        setDefaultUser: true,
        installLocation: true,
        vhdSize: true,
        fixedVhd: true,
        webDownload: true,
        exportFormats: true,
        importFromFile: true,
        updatePreRelease: true,
        manageSparse: true,
      },
    },
  })
})

describe('WslEnvironmentCard（0.1.3 WSL 本体生命周期）', () => {
  it('未安装：给「一键安装 WSL」（走同一安装任务链）', async () => {
    wslAPI.app.wslEnv.mockResolvedValueOnce({
      installed: false,
      wslVersion: '',
      kernelVersion: '',
      defaultDistro: '',
      defaultVersion: null,
      statusRaw: 'wsl.exe 缺失',
      capabilities: null as never,
    })
    const w = mount(WslEnvironmentCard, { attachTo: document.body })
    await flushPromises()
    expect(w.text()).toContain('未检测到 WSL')
    findButton(w, '一键安装 WSL')!.element.click()
    await flushPromises()
    expect(wslAPI.distros.install).toHaveBeenCalledWith({})
    expect(message.info).toHaveBeenCalledWith(expect.stringContaining('已开始安装 WSL'))
  })

  it('已安装：展示环境信息；更新 / 预发布 / 版本历史全链路', async () => {
    const w = mount(WslEnvironmentCard, { attachTo: document.body })
    await flushPromises()
    expect(w.text()).toContain('2.3.4')
    expect(w.text()).toContain('Ubuntu')

    // 常规更新
    findButton(w, '更新 / 修复 WSL')!.element.click()
    await flushPromises()
    expect(wslAPI.app.wslUpdate).toHaveBeenCalledWith({ preRelease: false })
    expect(message.info).toHaveBeenCalledWith(expect.stringContaining('已开始更新 WSL'))

    // 高级：预发布通道
    // 前序更新任务仍在途时高级入口被禁用：先模拟任务完成
    useTasksStore().applyProgress({
      taskId: 'upd',
      type: 'update',
      percent: 100,
      message: '完成',
      status: 'success',
    })
    await flushPromises()
    findButton(w, '高级…')!.element.click()
    await flushPromises()
    findBodyButton('通过预发布通道更新')!.click()
    await flushPromises()
    expect(wslAPI.app.wslUpdate).toHaveBeenLastCalledWith({ preRelease: true })

    // 高级：查看版本历史（0.1.4 起不再有失效的 --rollback 入口）
    useTasksStore().applyProgress({
      taskId: 'upd',
      type: 'update',
      percent: 100,
      message: '完成',
      status: 'success',
    })
    await flushPromises()
    findBodyButton('查看 WSL 版本历史')!.click()
    await flushPromises()
    expect(wslAPI.app.openExternal).toHaveBeenCalledWith(
      'https://github.com/microsoft/WSL/releases',
    )
    expect(w.text()).not.toContain('回滚最近一次更新')
  })

  it('默认版本下拉：变更调用 wslSetDefaultVersion 并如实提示', async () => {
    const w = mount(WslEnvironmentCard, { attachTo: document.body })
    await flushPromises()
    const select = w.findComponent(NSelect)
    select.vm.$emit('update:value', 1)
    await flushPromises()
    expect(wslAPI.app.wslSetDefaultVersion).toHaveBeenCalledWith(1)
    expect(message.success).toHaveBeenCalledWith(expect.stringContaining('WSL1'))
  })

  it('读取失败：给重试而不断路', async () => {
    wslAPI.app.wslEnv.mockRejectedValueOnce(appError('服务不可用'))
    const w = mount(WslEnvironmentCard, { attachTo: document.body })
    await flushPromises()
    expect(message.error).toHaveBeenCalledWith(expect.stringContaining('服务不可用'))
    expect(findButton(w, '重试')).toBeTruthy()
  })

  it('能力矩阵从 WSL_FEATURE_META 取最低版本（不支持的项给出可行动 title）', async () => {
    const base = await wslAPI.app.wslEnv()
    base.capabilities!.flags.compact = false
    wslAPI.app.wslEnv.mockResolvedValueOnce(base)
    const w = mount(WslEnvironmentCard, { attachTo: document.body })
    await flushPromises()
    expect(w.text()).toContain('压缩磁盘')
    expect(w.text()).toContain('稀疏磁盘')
    expect(w.find('[title="需要 WSL 2.9.8+"]').exists()).toBe(true)
  })
})

describe('WslConfigPanel（0.1.3 .wslconfig 编辑）', () => {
  beforeEach(() => {
    wslAPI.wslconfig.read.mockResolvedValue({
      path: 'C:\\Users\\me\\.wslconfig',
      exists: true,
      content: '# 注释\n[wsl2]\nmemory=8GB\n',
    })
    wslAPI.wslconfig.write.mockResolvedValue({ path: 'C:\\Users\\me\\.wslconfig' })
  })

  it('表单编辑 → 预览（Diff）→ 写入（保留注释）', async () => {
    const w = mount(WslConfigPanel, { attachTo: document.body })
    await flushPromises()
    expect(w.text()).toContain('C:\\Users\\me\\.wslconfig')

    const memInput = Array.from(document.body.querySelectorAll<HTMLInputElement>('input')).find(
      (i) => i.value === '8GB',
    )
    expect(memInput, '内存输入应预填 8GB').toBeTruthy()
    memInput!.value = '16GB'
    memInput!.dispatchEvent(new Event('input', { bubbles: true }))
    await flushPromises()

    findButton(w, '预览并保存')!.element.click()
    await flushPromises()
    // Diff 弹窗（teleport）出现增删行 + 表单模式摘要（1 项修改）
    expect(document.body.textContent).toContain('变更预览')
    expect(document.body.textContent).toContain('1 项修改')
    findBodyButton('确认写入')!.click()
    await flushPromises()
    expect(wslAPI.wslconfig.write).toHaveBeenCalledWith(expect.stringContaining('memory=16GB'))
    const writeArg = (wslAPI.wslconfig.write.mock.calls as unknown[][])[0]![0] as string
    expect(writeArg).toContain('# 注释')
    expect(w.emitted('saved')).toHaveLength(1)
    expect(message.success).toHaveBeenCalledWith(expect.stringContaining('全局配置已保存'))
  })

  it('非法容量：内联错误提示 + 「预览并保存」禁用（防御路径不让坏数据出门）', async () => {
    const w = mount(WslConfigPanel, { attachTo: document.body })
    await flushPromises()
    const memInput = Array.from(document.body.querySelectorAll<HTMLInputElement>('input')).find(
      (i) => i.value === '8GB',
    )!
    memInput.value = '1.5GB'
    memInput.dispatchEvent(new Event('input', { bubbles: true }))
    await flushPromises()
    expect(w.text()).toContain('整数')
    const saveBtn = findButton(w, '预览并保存')!
    expect(saveBtn.element.hasAttribute('disabled')).toBe(true)
    expect(document.body.textContent).not.toContain('变更预览')
    expect(wslAPI.wslconfig.write).not.toHaveBeenCalled()
  })

  it('控件全覆盖：布尔/枚举/数字/清除键 + 打开目录 + 立即重启 + 原始文本直写', async () => {
    const { NInputNumber, NSelect: NSelectC } = await import('naive-ui')
    const w = mount(WslConfigPanel, { attachTo: document.body })
    await flushPromises()

    // 布尔开关（dnsTunneling）点击
    const sw = document.body.querySelector<HTMLElement>('.n-switch')!
    sw.click()
    await flushPromises()
    // 枚举（networkingMode）经 NSelect 事件
    const selects = w.findAllComponents(NSelectC)
    expect(selects.length).toBeGreaterThanOrEqual(2)
    selects[0]!.vm.$emit('update:value', 'mirrored')
    await flushPromises()
    // 数字（processors）经 NInputNumber 事件
    const numberInputs = w.findAllComponents(NInputNumber)
    expect(numberInputs.length).toBeGreaterThanOrEqual(1)
    numberInputs[0]!.vm.$emit('update:value', 8)
    await flushPromises()

    // 清除键（×）
    document.body.querySelector<HTMLButtonElement>('.clear-btn')!.click()
    await flushPromises()

    // 打开所在目录 / 立即重启（dialog mock 自动确认）
    findButton(w, '打开所在目录')!.element.click()
    await flushPromises()
    expect(wslAPI.app.openPath).toHaveBeenCalledWith('C:\\Users\\me')
    findButton(w, '立即重启 WSL')!.element.click()
    await flushPromises()
    expect(wslAPI.distros.shutdown).toHaveBeenCalled()
    expect(message.success).toHaveBeenCalledWith(expect.stringContaining('WSL 已重启'))

    // 原始文本模式直写 + 预览保存
    findButton(w, '原始文本')!.element.click()
    await flushPromises()
    const textarea = document.body.querySelector<HTMLTextAreaElement>('.code-editor textarea')!
    textarea.value = '# raw\n[wsl2]\nmemory=32GB\n'
    textarea.dispatchEvent(new Event('input', { bubbles: true }))
    await flushPromises()
    findButton(w, '预览并保存')!.element.click()
    await flushPromises()
    // 原始文本模式摘要按行数统计
    expect(document.body.textContent).toContain('原始文本：+')
    findBodyButton('确认写入')!.click()
    await flushPromises()
    const rawWrite = (wslAPI.wslconfig.write.mock.calls as unknown[][])
      .map((c) => c[0] as string)
      .find((s) => s.includes('memory=32GB'))
    expect(rawWrite).toBeTruthy()
  })
})

describe('CloneDistroModal（0.1.3 克隆发行版）', () => {
  it('校验：重名/同名拒绝；合法提交调用 io.clone 并关闭', async () => {
    const w = mount(CloneDistroModal, {
      props: {
        show: true,
        source: 'Ubuntu',
        distros: [distro({ name: 'Ubuntu' }), distro({ name: 'Existing' })],
        defaultDir: 'D:\\backups',
      },
      attachTo: document.body,
    })
    await flushPromises()

    const nameInput = Array.from(document.body.querySelectorAll<HTMLInputElement>('input')).find(
      (i) => i.getAttribute('aria-label') === '新发行版名称',
    )!
    // 同名（大小写归一）
    nameInput.value = 'ubuntu'
    nameInput.dispatchEvent(new Event('input', { bubbles: true }))
    await flushPromises()
    expect(document.body.textContent).toContain('不能与源发行版相同')
    // 已存在
    nameInput.value = 'Existing'
    nameInput.dispatchEvent(new Event('input', { bubbles: true }))
    await flushPromises()
    expect(document.body.textContent).toContain('已存在同名发行版')
    // 合法
    nameInput.value = 'Ubuntu-Dev'
    nameInput.dispatchEvent(new Event('input', { bubbles: true }))
    await flushPromises()
    findBodyButton('开始克隆')!.click()
    await flushPromises()
    expect(wslAPI.io.clone).toHaveBeenCalledWith({
      name: 'Ubuntu',
      newName: 'Ubuntu-Dev',
      installPath: 'D:\\backups',
    })
    expect(w.emitted('started')).toHaveLength(1)
    expect(w.emitted('update:show')!.at(-1)).toEqual([false])
  })

  it('浏览选择安装位置 + 提交失败如实提示', async () => {
    wslAPI.app.pickDirectory.mockResolvedValueOnce('D:\\picked-dir')
    wslAPI.io.clone.mockRejectedValueOnce(appError('克隆被拒'))
    const w = mount(CloneDistroModal, {
      props: {
        show: true,
        source: 'Ubuntu',
        distros: [distro({ name: 'Ubuntu' })],
        defaultDir: 'D:\\backups',
      },
      attachTo: document.body,
    })
    await flushPromises()
    findBodyButton('浏览…')!.click()
    await flushPromises()
    const nameInput = Array.from(document.body.querySelectorAll<HTMLInputElement>('input')).find(
      (i) => i.getAttribute('aria-label') === '新发行版名称',
    )!
    nameInput.value = 'Ubuntu-Dev'
    nameInput.dispatchEvent(new Event('input', { bubbles: true }))
    await flushPromises()
    findBodyButton('开始克隆')!.click()
    await flushPromises()
    expect(wslAPI.io.clone).toHaveBeenCalledWith(
      expect.objectContaining({ installPath: 'D:\\picked-dir' }),
    )
    expect(message.error).toHaveBeenCalledWith(expect.stringContaining('克隆被拒'))
    expect(w.emitted('started')).toBeUndefined()
  })
})

describe('DistroDetailModal（0.1.3 磁盘信息与稀疏开关）', () => {
  it('宿主磁盘行展示 + 启用稀疏磁盘调用 distros.setSparse', async () => {
    const d = distro({ name: 'Ubuntu', hostDiskBytes: 123456789 })
    const { useDistrosStore } = await import('../../src/renderer/stores/distros')
    useDistrosStore().items = [d]
    mount(DistroDetailModal, {
      props: { show: true, distroName: 'Ubuntu' },
      attachTo: document.body,
      global: {
        stubs: {
          WslConfPanel: true,
          ActionsPanel: true,
          FileBrowserPanel: true,
          CloneDistroModal: true,
        },
      },
    })
    await flushPromises()
    expect(document.body.textContent).toContain('117.7MB')
    findBodyButton('启用稀疏磁盘')!.click()
    await flushPromises()
    expect(wslAPI.distros.setSparse).toHaveBeenCalledWith('Ubuntu', true)
  })

  it('压缩运行中发行版必须传 terminateFirst=true（与确认框同语义）', async () => {
    const d = distro({ name: 'Ubuntu', state: 'Running', hostDiskBytes: 123456789 })
    const { useDistrosStore } = await import('../../src/renderer/stores/distros')
    useDistrosStore().items = [d]
    mount(DistroDetailModal, {
      props: { show: true, distroName: 'Ubuntu' },
      attachTo: document.body,
      global: {
        stubs: {
          WslConfPanel: true,
          ActionsPanel: true,
          FileBrowserPanel: true,
          CloneDistroModal: true,
        },
      },
    })
    await flushPromises()
    findBodyButton('压缩磁盘')!.click()
    await flushPromises()
    expect(wslAPI.distros.compact).toHaveBeenCalledWith('Ubuntu', true)
  })

  it('压缩停止态发行版传 terminateFirst=false（不无条件终止）', async () => {
    const d = distro({ name: 'Ubuntu', state: 'Stopped', hostDiskBytes: 123456789 })
    const { useDistrosStore } = await import('../../src/renderer/stores/distros')
    useDistrosStore().items = [d]
    mount(DistroDetailModal, {
      props: { show: true, distroName: 'Ubuntu' },
      attachTo: document.body,
      global: {
        stubs: {
          WslConfPanel: true,
          ActionsPanel: true,
          FileBrowserPanel: true,
          CloneDistroModal: true,
        },
      },
    })
    await flushPromises()
    findBodyButton('压缩磁盘')!.click()
    await flushPromises()
    expect(wslAPI.distros.compact).toHaveBeenCalledWith('Ubuntu', false)
  })

  it('扩容：停止态填大小后可提交；运行态按钮禁用', async () => {
    const stopped = distro({ name: 'Ubuntu', state: 'Stopped' })
    const { useDistrosStore } = await import('../../src/renderer/stores/distros')
    useDistrosStore().items = [stopped]
    const w = mount(DistroDetailModal, {
      props: { show: true, distroName: 'Ubuntu' },
      attachTo: document.body,
      global: {
        stubs: {
          WslConfPanel: true,
          ActionsPanel: true,
          FileBrowserPanel: true,
          CloneDistroModal: true,
        },
      },
    })
    await flushPromises()
    const input = document.body.querySelector<HTMLInputElement>('input[placeholder="50GB"]')!
    input.value = '50GB'
    input.dispatchEvent(new Event('input', { bubbles: true }))
    await flushPromises()
    findBodyButton('扩容')!.click()
    await flushPromises()
    expect(wslAPI.distros.resize).toHaveBeenCalledWith('Ubuntu', '50GB')

    // 运行态：直接点击不应发起任务
    ;(wslAPI.distros.resize as ReturnType<typeof vi.fn>).mockClear()
    const running = distro({ name: 'Ubuntu2', state: 'Running' })
    useDistrosStore().items = [running]
    await w.setProps({ show: false })
    await flushPromises()
    await w.setProps({ show: true, distroName: 'Ubuntu2' })
    await flushPromises()
    findBodyButton('扩容')!.click()
    await flushPromises()
    expect(wslAPI.distros.resize).not.toHaveBeenCalled()
  })

  it('失败分支与元数据编辑：稀疏失败/注销失败如实提示；编辑保存走 meta:set', async () => {
    const d = distro({ name: 'Ubuntu' })
    const { useDistrosStore } = await import('../../src/renderer/stores/distros')
    useDistrosStore().items = [d]
    wslAPI.distros.setSparse.mockRejectedValueOnce(appError('稀疏失败'))
    wslAPI.distros.unregister.mockRejectedValueOnce(appError('注销被拒'))
    mount(DistroDetailModal, {
      props: { show: true, distroName: 'Ubuntu' },
      attachTo: document.body,
      global: {
        stubs: { WslConfPanel: true, ActionsPanel: true, FileBrowserPanel: true },
      },
    })
    await flushPromises()

    findBodyButton('启用稀疏磁盘')!.click()
    await flushPromises()
    expect(message.error).toHaveBeenCalledWith(expect.stringContaining('稀疏失败'))

    // 注销失败：任务启动失败如实提示（不假报成功）
    findBodyButton('注销发行版')!.click()
    await flushPromises()
    expect(message.error).toHaveBeenCalledWith(expect.stringContaining('注销被拒'))

    // 元数据编辑：预填 → 保存
    findBodyButton('编辑元数据')!.click()
    await flushPromises()
    const alias = document.body.querySelector<HTMLInputElement>('input[aria-label="别名"]')!
    alias.value = '主力开发'
    alias.dispatchEvent(new Event('input', { bubbles: true }))
    await flushPromises()
    findBodyButton('保存元数据')!.click()
    await flushPromises()
    expect(wslAPI.meta.set).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Ubuntu', alias: '主力开发' }),
    )
  })
})

describe('TerminalTabs（0.1.3 新建面板 Shell/目录）', () => {
  it('新建弹层携带 Shell 与启动目录（create payload）', async () => {
    const w = mount(TerminalTabs, {
      props: {
        tabs: [],
        activeTabId: '',
        maxSessions: 10,
        distroOptions: [{ label: 'Ubuntu', value: 'Ubuntu' }],
        defaultDistro: 'Ubuntu',
        defaultShell: '/bin/bash',
      },
      attachTo: document.body,
    })
    await flushPromises()
    findButton(w, '新建')!.element.click()
    await flushPromises()
    const inputs = Array.from(document.body.querySelectorAll<HTMLInputElement>('.new-form input'))
    expect(inputs.length).toBeGreaterThanOrEqual(2)
    // 顺序：Shell、启动目录（select 的 filterable input 在最前）
    const shellInput = inputs[inputs.length - 2]!
    const cwdInput = inputs[inputs.length - 1]!
    shellInput.value = '/bin/zsh'
    shellInput.dispatchEvent(new Event('input', { bubbles: true }))
    cwdInput.value = '/home/me/project'
    cwdInput.dispatchEvent(new Event('input', { bubbles: true }))
    await flushPromises()
    findBodyButton('打开终端')!.click()
    await flushPromises()
    expect(w.emitted('create')!.at(-1)).toEqual([
      { distro: 'Ubuntu', shell: '/bin/zsh', cwd: '/home/me/project' },
    ])
  })
})

describe('TerminalView（0.1.3 工具栏事件面全链路）', () => {
  it('无会话时各工具栏动作安全降级（复制/粘贴/清屏/缩放/分屏/搜索/关闭面板）', async () => {
    const TerminalView = (await import('../../src/renderer/views/TerminalView.vue')).default
    const TerminalToolbar = (
      await import('../../src/renderer/features/terminal/TerminalToolbar.vue')
    ).default
    const w = mount(TerminalView, { attachTo: document.body })
    await flushPromises()
    const tb = w.findComponent(TerminalToolbar)
    tb.vm.$emit('clear')
    tb.vm.$emit('copy')
    tb.vm.$emit('paste')
    tb.vm.$emit('zoom', 1)
    tb.vm.$emit('scrollBottom')
    tb.vm.$emit('splitRow')
    tb.vm.$emit('splitCol')
    tb.vm.$emit('closePane')
    tb.vm.$emit('search', { query: 'x', caseSensitive: false, regex: false })
    tb.vm.$emit('searchNext')
    tb.vm.$emit('searchPrev')
    tb.vm.$emit('searchClose')
    tb.vm.$emit('export')
    await flushPromises()
    // 导出在无会话时如实提示（其余动作 null-safe 不抛）
    expect(message.warning).toHaveBeenCalledWith('没有活动的终端会话，无法导出')
  })
})

describe('导入向导默认版本跟随（0.1.3 计划 1.3 链路）', () => {
  it('wslEnv 默认版本为 WSL1 时，导入表单初始版本跟随为 1', async () => {
    wslAPI.app.wslEnv.mockResolvedValue({
      installed: true,
      wslVersion: '2.6.1',
      kernelVersion: '6.6.1',
      defaultDistro: 'Ubuntu',
      defaultVersion: 1,
      statusRaw: '',
      capabilities: null as never,
    })
    const BackupView = (await import('../../src/renderer/views/BackupView.vue')).default
    const ImportWizard = (await import('../../src/renderer/features/backup/ImportWizard.vue'))
      .default
    const w = mount(BackupView, { attachTo: document.body })
    await flushPromises()
    // 切到导入模式（ImportWizard 才渲染）
    w.findComponent(NRadioGroup).vm.$emit('update:value', 'import')
    await flushPromises()
    const wizard = w.findComponent(ImportWizard)
    expect(wizard.exists()).toBe(true)
    expect(wizard.props('form').version).toBe(1)
  })

  it('环境读取失败时保持 schema 默认（WSL 2），不阻断备份页', async () => {
    wslAPI.app.wslEnv.mockRejectedValueOnce(appError('环境不可用'))
    const BackupView = (await import('../../src/renderer/views/BackupView.vue')).default
    const ImportWizard = (await import('../../src/renderer/features/backup/ImportWizard.vue'))
      .default
    const w = mount(BackupView, { attachTo: document.body })
    await flushPromises()
    w.findComponent(NRadioGroup).vm.$emit('update:value', 'import')
    await flushPromises()
    expect(w.findComponent(ImportWizard).props('form').version).toBe(2)
  })
})

describe('DashboardView hero「更新 WSL」入口（0.1.3 计划 1.2）', () => {
  const stubs = { InstallDistroModal: true, DistroDetailModal: true }

  it('已安装环境：hero 显示入口并派发更新任务', async () => {
    const DashboardView = (await import('../../src/renderer/views/DashboardView.vue')).default
    const w = mount(DashboardView, {
      attachTo: document.body,
      global: { stubs },
    })
    await flushPromises()
    const btn = w.findAll('button').find((b) => b.text().includes('更新 WSL'))
    expect(btn, 'hero 应有「更新 WSL」入口').toBeTruthy()
    btn!.element.click()
    await flushPromises()
    // 组件层 mock 直连（真实 preload 会把缺省 opts 归一为 {preRelease:false}；此处验证派发与反馈）
    expect(wslAPI.app.wslUpdate).toHaveBeenCalled()
    const firstArg = (
      wslAPI.app.wslUpdate.mock.calls as unknown as Array<[{ preRelease?: boolean }?]>
    )[0]?.[0]
    expect(firstArg?.preRelease ?? false).toBe(false)
    expect(message.info).toHaveBeenCalledWith(expect.stringContaining('已开始更新 WSL'))
  })

  it('未安装环境：不显示更新入口（引导由错误横幅/设置卡承担）', async () => {
    wslAPI.app.wslEnv.mockResolvedValueOnce({
      installed: false,
      wslVersion: '',
      kernelVersion: '',
      defaultDistro: '',
      defaultVersion: null,
      statusRaw: '缺失',
      capabilities: null as never,
    })
    const DashboardView = (await import('../../src/renderer/views/DashboardView.vue')).default
    const w = mount(DashboardView, {
      attachTo: document.body,
      global: { stubs },
    })
    await flushPromises()
    expect(w.findAll('button').find((b) => b.text().includes('更新 WSL'))).toBeUndefined()
  })
})

describe('WslConfigPanel raw 模式不被表单残留错误阻塞（0.1.3 修复）', () => {
  it('表单态非法值 → 切 raw → 保存门控恢复可用并成功写入', async () => {
    wslAPI.wslconfig.read.mockResolvedValue({
      path: 'C:\\Users\\me\\.wslconfig',
      exists: true,
      content: '[wsl2]\nmemory=8GB\n',
    })
    const w = mount(WslConfigPanel, { attachTo: document.body })
    await flushPromises()
    // 制造表单非法值（阻止表单态保存）
    const memInput = Array.from(document.body.querySelectorAll<HTMLInputElement>('input')).find(
      (i) => i.value === '8GB',
    )!
    memInput.value = '1.5GB'
    memInput.dispatchEvent(new Event('input', { bubbles: true }))
    await flushPromises()
    expect(findButton(w, '预览并保存')!.element.hasAttribute('disabled')).toBe(true)

    // 切 raw：保存门控不应再被表单错误阻塞（raw 用户自行掌握语法）
    findButton(w, '原始文本')!.element.click()
    await flushPromises()
    const saveBtn = findButton(w, '预览并保存')!
    expect(saveBtn.element.hasAttribute('disabled')).toBe(false)
    saveBtn.element.click()
    await flushPromises()
    findBodyButton('确认写入')!.click()
    await flushPromises()
    expect(wslAPI.wslconfig.write).toHaveBeenCalledWith(expect.stringContaining('memory=1.5GB'))
  })
})
