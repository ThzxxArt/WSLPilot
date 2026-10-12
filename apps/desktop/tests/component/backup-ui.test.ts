import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { enableAutoUnmount, mount, flushPromises } from '@vue/test-utils'
import { defineComponent, h } from 'vue'
import { NMessageProvider, NSelect, NRadioGroup, NCheckbox } from 'naive-ui'
import ProgressRing from '@ui/components/ProgressRing.vue'
import BackupView from '../../src/renderer/views/BackupView.vue'
import ExportWizard from '../../src/renderer/features/backup/ExportWizard.vue'
import ImportWizard from '../../src/renderer/features/backup/ImportWizard.vue'
import MoveWizard from '../../src/renderer/features/backup/MoveWizard.vue'
import type { DistroView } from '@wslpilot/shared'

enableAutoUnmount(afterEach)

const wslAPI = {
  app: {
    pickDirectory: vi.fn(async () => 'D:\\picked'),
    pickSaveFile: vi.fn(async () => 'D:\\picked\\out.tar'),
    pickOpenFile: vi.fn(async () => 'D:\\picked\\in.tar'),
    openPath: vi.fn(async () => {}),
  },
  task: {
    cancel: vi.fn(async () => true),
    onProgress: vi.fn(() => () => {}),
  },
  io: {
    export: vi.fn(),
    import: vi.fn(),
    move: vi.fn(),
    listBackups: vi.fn(async () => []),
  },
  distros: {
    list: vi.fn(async () => [] as DistroView[]),
  },
}
// happy-dom 已提供 window：只挂 wslAPI，绝不整体覆盖（覆盖会破坏 DOM 事件）
;(globalThis as any).window.wslAPI = wslAPI

const { createPinia, setActivePinia } = await import('pinia')
const { useSettingsStore } = await import('../../src/renderer/stores/settings')
const { useTasksStore } = await import('../../src/renderer/stores/tasks')

function distro(name: string, state: 'Running' | 'Stopped' = 'Stopped'): DistroView {
  return {
    name,
    state,
    version: 2,
    isDefault: false,
    basePath: 'C:\\WSL\\' + name,
    meta: {
      name,
      alias: '',
      tags: [],
      color: '',
      icon: 'linux',
      note: '',
      startupCwd: '~',
      pinned: false,
      quickActions: [],
    },
  }
}

describe('ProgressRing', () => {
  it('renders percent label and aria value', () => {
    const w = mount(ProgressRing, { props: { percent: 42, sublabel: '导出备份' } })
    expect(w.text()).toContain('42%')
    expect(w.text()).toContain('导出备份')
    expect(w.attributes('role')).toBe('progressbar')
    expect(w.attributes('aria-valuenow')).toBe('42')
    expect(w.find('svg').exists()).toBe(true)
  })

  it('clamps out-of-range percent and shows indeterminate for null', () => {
    const w = mount(ProgressRing, { props: { percent: 250 } })
    expect(w.text()).toContain('100%')
    const w2 = mount(ProgressRing, { props: { percent: null } })
    expect(w2.classes()).toContain('indeterminate')
    expect(w2.text()).toContain('…')
    expect(w2.attributes('aria-valuenow')).toBeUndefined()
  })

  it('supports custom label', () => {
    const w = mount(ProgressRing, { props: { percent: 10, label: '完成' } })
    expect(w.text()).toContain('完成')
    expect(w.text()).not.toContain('10%')
  })
})

describe('ExportWizard', () => {
  beforeEach(() => vi.clearAllMocks())

  it('step 1 lists distros and emits selected name', async () => {
    const w = mount(ExportWizard, {
      props: {
        step: 1,
        form: { name: '', path: '', format: 'tar' },
        distros: [distro('Ubuntu'), distro('Debian')],
        defaultDir: 'D:\\Backups',
        keepRecent: 5,
      },
    })
    expect(w.text()).toContain('选择要导出的发行版')

    const select = w.findComponent(NSelect)
    await select.vm.$emit('update:value', 'Ubuntu')
    await flushPromises()
    const emitted = w.emitted('update:form')
    expect(emitted).toBeTruthy()
    const last = emitted!.at(-1)![0] as { name: string; path: string }
    expect(last.name).toBe('Ubuntu')
    // 选中后自动建议默认路径
    expect(last.path).toContain('D:\\Backups')
  })

  it('名称/格式变化跟随建议路径（未手改时）；手工路径不被覆盖（review 0.1.2 根治）', async () => {
    const w = mount(ExportWizard, {
      props: {
        step: 1,
        form: { name: '', path: '', format: 'tar' },
        distros: [distro('Ubuntu'), distro('Debian')],
        defaultDir: 'D:\\Backups',
        keepRecent: 5,
      },
    })
    const select = w.findComponent(NSelect)
    await select.vm.$emit('update:value', 'Ubuntu')
    await flushPromises()
    let last = w.emitted('update:form')!.at(-1)![0] as {
      name: string
      path: string
      format: string
    }
    expect(last.path).toContain('Ubuntu')
    expect(last.path).toMatch(/\.tar$/)

    // 父级回传表单并进入第 2 步后切格式：已建议后缀同步为 .vhdx，路径跟随
    await w.setProps({ step: 2, form: { ...last, format: 'tar' } })
    const rg = w.findComponent(NRadioGroup)
    await rg.vm.$emit('update:value', 'vhd')
    await flushPromises()
    last = w.emitted('update:form')!.at(-1)![0] as { name: string; path: string; format: string }
    expect(last.format).toBe('vhd')
    expect(last.path).toMatch(/\.vhdx$/)

    // 用户手改路径后：name 再变化不得覆盖
    await w.setProps({
      step: 1,
      form: { name: 'Ubuntu', path: 'D:\\custom\\my.tar', format: 'vhd' },
    })
    await flushPromises()
    await w.findComponent(NSelect).vm.$emit('update:value', 'Debian')
    await flushPromises()
    last = w.emitted('update:form')!.at(-1)![0] as { name: string; path: string; format: string }
    expect(last.path).toBe('D:\\custom\\my.tar')
  })

  it('step 2 browse button picks save path and emits', async () => {
    const w = mount(ExportWizard, {
      props: {
        step: 2,
        form: { name: 'Ubuntu', path: '', format: 'tar' },
        distros: [distro('Ubuntu')],
        defaultDir: 'D:\\Backups',
        keepRecent: 3,
      },
    })
    expect(w.text()).toContain('保存位置')
    expect(w.text()).toContain('保留份数')
    const buttons = w.findAll('button')
    const browse = buttons.find((b) => b.text().includes('浏览'))
    expect(browse).toBeTruthy()
    await browse!.trigger('click')
    await flushPromises()
    expect(wslAPI.app.pickSaveFile).toHaveBeenCalled()
    const last = w.emitted('update:form')!.at(-1)![0] as { path: string }
    expect(last.path).toBe('D:\\picked\\out.tar')
  })

  it('warns when no distros', () => {
    const w = mount(ExportWizard, {
      props: {
        step: 1,
        form: { name: '', path: '', format: 'tar' },
        distros: [],
        defaultDir: 'D:\\Backups',
        keepRecent: 5,
      },
    })
    expect(w.text()).toContain('尚未检测到发行版')
  })
})

describe('ImportWizard', () => {
  beforeEach(() => vi.clearAllMocks())

  it('step 1 warns on duplicate name and shows mode options', async () => {
    const w = mount(ImportWizard, {
      props: {
        step: 1,
        form: {
          name: 'Ubuntu',
          archivePath: '',
          installPath: '',
          format: 'tar',
          version: 2,
          inPlace: false,
        },
        distros: [distro('Ubuntu')],
        defaultDir: 'D:\\Backups',
      },
    })
    expect(w.text()).toContain('已存在同名发行版')
    expect(w.text()).toContain('tar 归档导入')

    const rg = w.findComponent(NRadioGroup)
    await rg.vm.$emit('update:value', 'vhd-inplace')
    const last = w.emitted('update:form')!.at(-1)![0] as { inPlace: boolean; format: string }
    expect(last.inPlace).toBe(true)
    expect(last.format).toBe('vhd')
  })

  it('step 2 hides install path for in-place and browses archive', async () => {
    const w = mount(ImportWizard, {
      props: {
        step: 2,
        form: {
          name: 'InSitu',
          archivePath: '',
          installPath: '',
          format: 'vhd',
          version: 2,
          inPlace: true,
        },
        distros: [],
        defaultDir: 'D:\\Backups',
      },
    })
    expect(w.text()).toContain('就地导入')
    expect(w.text()).not.toContain('发行版安装目录')

    const browse = w.findAll('button').find((b) => b.text().includes('浏览'))
    await browse!.trigger('click')
    await flushPromises()
    expect(wslAPI.app.pickOpenFile).toHaveBeenCalled()
    const last = w.emitted('update:form')!.at(-1)![0] as { archivePath: string }
    expect(last.archivePath).toBe('D:\\picked\\in.tar')
  })

  it('step 2 shows install path field when copying', () => {
    const w = mount(ImportWizard, {
      props: {
        step: 2,
        form: {
          name: 'New',
          archivePath: 'a.tar',
          installPath: '',
          format: 'tar',
          version: 2,
          inPlace: false,
        },
        distros: [],
        defaultDir: 'D:\\Backups',
      },
    })
    expect(w.text()).toContain('安装位置')
    expect(w.text()).toContain('建议使用独立空目录')
  })

  it('手动输入 archivePath 按扩展名同步 format（review 0.1.2 根治）', async () => {
    const w = mount(ImportWizard, {
      props: {
        step: 2,
        form: {
          name: 'New',
          archivePath: '',
          installPath: 'D:\\New',
          format: 'tar',
          version: 2,
          inPlace: false,
        },
        distros: [],
        defaultDir: 'D:\\Backups',
      },
    })
    const input = w.find('input[placeholder="选择 .tar 或 .vhdx 备份文件"]')
    expect(input.exists()).toBe(true)
    await input.setValue('D:\\b\\u.vhdx')
    await flushPromises()
    let last = w.emitted('update:form')!.at(-1)![0] as { format: string }
    expect(last.format).toBe('vhd')

    await input.setValue('D:\\b\\u.tar')
    await flushPromises()
    last = w.emitted('update:form')!.at(-1)![0] as { format: string }
    expect(last.format).toBe('tar')

    // 清空输入不擅自改格式
    await input.setValue('')
    await flushPromises()
    last = w.emitted('update:form')!.at(-1)![0] as { format: string }
    expect(last.format).toBe('tar')
  })
})

describe('MoveWizard', () => {
  it('shows running warning with terminate checkbox', async () => {
    const w = mount(MoveWizard, {
      props: {
        step: 1,
        form: { name: 'Ubuntu', path: '', terminateFirst: true },
        distros: [distro('Ubuntu', 'Running')],
        autoBackup: true,
      },
    })
    expect(w.text()).toContain('正在运行')
    const cb = w.findComponent(NCheckbox)
    await cb.vm.$emit('update:checked', false)
    const last = w.emitted('update:form')!.at(-1)![0] as { terminateFirst: boolean }
    expect(last.terminateFirst).toBe(false)
  })

  it('step 2 shows auto-backup policy', () => {
    const w = mount(MoveWizard, {
      props: {
        step: 2,
        form: { name: 'Ubuntu', path: '', terminateFirst: true },
        distros: [distro('Ubuntu')],
        autoBackup: true,
      },
    })
    expect(w.text()).toContain('安全兜底已开启')
    const w2 = mount(MoveWizard, {
      props: {
        step: 2,
        form: { name: 'Ubuntu', path: '', terminateFirst: true },
        distros: [distro('Ubuntu')],
        autoBackup: false,
      },
    })
    expect(w2.text()).toContain('自动备份已关闭')
  })

  it('目标等于当前位置时提示（组件内可得 basePath — review 0.1.2 根治）', () => {
    const w = mount(MoveWizard, {
      props: {
        step: 2,
        form: { name: 'Ubuntu', path: 'c:\\wsl\\ubuntu\\', terminateFirst: true },
        distros: [distro('Ubuntu')],
        autoBackup: true,
      },
    })
    // 大小写/尾分隔符不同也算同一位置
    expect(w.text()).toContain('目标位置与发行版当前位置相同')
  })
})

describe('BackupView 并发与重置（review 0.1.2 根治）', () => {
  /** BackupView 依赖 useMessage：必须包 NMessageProvider 才能挂载 */
  function mountBackupView() {
    const Host = defineComponent({
      setup: () => () => h(NMessageProvider, null, { default: () => h(BackupView) }),
    })
    return mount(Host, { attachTo: document.body })
  }

  function findBtn(w: ReturnType<typeof mount>, label: string) {
    return w.findAll('button').find((b) => b.text().includes(label)) ?? null
  }

  beforeEach(() => {
    vi.clearAllMocks()
    setActivePinia(createPinia())
    document.body.innerHTML = ''
    wslAPI.io.export.mockResolvedValue({ taskId: 'new-1' })
    wslAPI.io.listBackups.mockResolvedValue([])
  })

  it('挂载时接续本页运行中任务到进度视图；reset 保留默认备份格式', async () => {
    const settings = useSettingsStore()
    settings.backupFormat = 'vhd'
    const tasks = useTasksStore()
    tasks.track({ taskId: 'run-1' }, { type: 'export', distro: 'Ubuntu', message: '导出 Ubuntu' })

    const w = mountBackupView()
    await flushPromises()
    // 接续：直接进入进度步骤（无需重走向导）
    expect(w.text()).toContain('查看日志')

    const listCallsBefore = wslAPI.io.listBackups.mock.calls.length
    tasks.applyProgress({
      taskId: 'run-1',
      type: 'export',
      percent: 100,
      message: '完成',
      status: 'success',
    })
    await flushPromises()
    // isDone 时刷新最近备份列表（review 0.1.2 根治）
    expect(wslAPI.io.listBackups.mock.calls.length).toBeGreaterThan(listCallsBefore)
    const again = findBtn(w, '再来一次')
    expect(again).toBeTruthy()
    await again!.trigger('click')
    await flushPromises()

    // reset 不丢设置默认格式（export / import 都保留 vhd）
    expect(w.findComponent(ExportWizard).props('form').format).toBe('vhd')
    const rg = w.findComponent(NRadioGroup)
    await rg.vm.$emit('update:value', 'import')
    await flushPromises()
    expect(w.findComponent(ImportWizard).props('form').format).toBe('vhd')
  })

  it('双击「开始」只启动一个长任务（starting 锁 — review 0.1.2 根治）', async () => {
    let releaseExport!: (v: unknown) => void
    wslAPI.io.export.mockReturnValueOnce(
      new Promise((r) => {
        releaseExport = r
      }) as never,
    )
    const w = mountBackupView()
    await flushPromises()

    // 通过 ExportWizard 更新表单，随后两步到确认页
    w.findComponent(ExportWizard).vm.$emit('update:form', {
      name: 'Ubuntu',
      path: 'D:\\b\\u.tar',
      format: 'tar',
    })
    await flushPromises()
    await findBtn(w, '下一步')!.trigger('click')
    await flushPromises()
    await findBtn(w, '下一步')!.trigger('click')
    await flushPromises()

    const startBtn = findBtn(w, '开始导出备份')
    expect(startBtn).toBeTruthy()
    await startBtn!.trigger('click')
    await startBtn!.trigger('click')
    await flushPromises()
    // 锁生效：两次点击只拉起一个长任务
    expect(wslAPI.io.export).toHaveBeenCalledTimes(1)
    releaseExport({ taskId: 'new-1' })
    await flushPromises()
    // 启动完成后进入进度页
    expect(w.text()).toContain('查看日志')
  })

  it('迁移目标等于当前位置时「下一步」被拦截（review 0.1.2 根治）', async () => {
    wslAPI.distros.list.mockResolvedValue([distro('Ubuntu')])
    const w = mountBackupView()
    await flushPromises()
    const rg = w.findComponent(NRadioGroup)
    await rg.vm.$emit('update:value', 'move')
    await flushPromises()
    w.findComponent(MoveWizard).vm.$emit('update:form', {
      name: 'Ubuntu',
      path: 'c:\\wsl\\ubuntu\\',
      terminateFirst: true,
    })
    await flushPromises()
    // step1 → 2
    await findBtn(w, '下一步')!.trigger('click')
    await flushPromises()
    expect(w.text()).toContain('迁移目标位置')
    // step2 → 3 的校验被硬拦截：停在 step2，不进入确认页
    await findBtn(w, '下一步')!.trigger('click')
    await flushPromises()
    expect(w.text()).toContain('迁移目标位置')
    expect(w.text()).not.toContain('确认信息')
  })

  it('日志抽屉只渲染尾部 ≤500 行并提示截断（review 0.1.2 根治）', async () => {
    const tasks = useTasksStore()
    tasks.track({ taskId: 'run-2' }, { type: 'export', distro: 'U', message: 'm' })
    for (let i = 0; i < 600; i++) {
      tasks.applyProgress({
        taskId: 'run-2',
        type: 'export',
        percent: 10,
        message: 'm',
        status: 'running',
        logLine: `行-${i}`,
      })
    }
    const w = mountBackupView()
    await flushPromises()
    await findBtn(w, '查看日志')!.trigger('click')
    await flushPromises()

    const pre = document.body.querySelector('pre.log')
    expect(pre).toBeTruthy()
    const text = pre!.textContent ?? ''
    // 只渲染尾部 500 行（行-100..行-599）
    expect(text.startsWith('行-100')).toBe(true)
    expect(text).toContain('行-599')
    expect(text).not.toContain('行-99\n')
    expect(document.body.textContent).toContain('仅显示最后 500 行')
  })

  it('步骤条当前步 aria-current="step" 且随步骤迁移（review 0.1.2 a11y）', async () => {
    const w = mountBackupView()
    await flushPromises()
    const steps = () => w.findAll('li.step-item')
    expect(steps()).toHaveLength(4)
    expect(steps()[0]!.attributes('aria-current')).toBe('step')
    expect(steps()[1]!.attributes('aria-current')).toBeUndefined()

    w.findComponent(ExportWizard).vm.$emit('update:form', {
      name: 'Ubuntu',
      path: 'D:\\b\\u.tar',
      format: 'tar',
    })
    await flushPromises()
    await findBtn(w, '下一步')!.trigger('click')
    await flushPromises()
    expect(steps()[1]!.attributes('aria-current')).toBe('step')
    expect(steps()[0]!.attributes('aria-current')).toBeUndefined()
  })

  it('导入流程走到确认并 start → io.import 收到全量精确字段（review 0.1.2）', async () => {
    wslAPI.io.import.mockResolvedValueOnce({ taskId: 'imp-1' })
    const w = mountBackupView()
    await flushPromises()

    const rg = w.findComponent(NRadioGroup)
    await rg.vm.$emit('update:value', 'import')
    await flushPromises()

    w.findComponent(ImportWizard).vm.$emit('update:form', {
      name: 'Restored',
      archivePath: 'D:\\picked\\in.tar',
      installPath: 'D:\\WSL\\Restored',
      format: 'tar',
      version: 1,
      inPlace: false,
    })
    await flushPromises()
    await findBtn(w, '下一步')!.trigger('click')
    await flushPromises()
    await findBtn(w, '下一步')!.trigger('click')
    await flushPromises()
    expect(w.text()).toContain('确认信息')

    const startBtn = findBtn(w, '开始导入恢复')
    expect(startBtn, '确认步应有开始导入恢复按钮').toBeTruthy()
    await startBtn!.trigger('click')
    await flushPromises()

    expect(wslAPI.io.import).toHaveBeenCalledWith({
      name: 'Restored',
      installPath: 'D:\\WSL\\Restored',
      archivePath: 'D:\\picked\\in.tar',
      format: 'tar',
      version: 1,
      inPlace: false,
    })
    expect(w.text()).toContain('查看日志')
  })
})
