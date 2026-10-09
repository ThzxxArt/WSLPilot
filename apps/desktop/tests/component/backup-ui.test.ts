import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { NSelect, NRadioGroup, NCheckbox } from 'naive-ui'
import ProgressRing from '@ui/components/ProgressRing.vue'
import ExportWizard from '../../src/renderer/features/backup/ExportWizard.vue'
import ImportWizard from '../../src/renderer/features/backup/ImportWizard.vue'
import MoveWizard from '../../src/renderer/features/backup/MoveWizard.vue'
import type { DistroView } from '@wslpilot/shared'

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
}
// happy-dom 已提供 window：只挂 wslAPI，绝不整体覆盖（覆盖会破坏 DOM 事件）
;(globalThis as any).window.wslAPI = wslAPI

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
})
