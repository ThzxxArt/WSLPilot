import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { NSwitch } from 'naive-ui'
import type {
  DistroView,
  NetworkStatus,
  PortForwardRule,
  ProxyConfig,
  UsbDevice,
  UsbipdStatus,
} from '@wslpilot/shared'

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

const wslAPI = {
  network: {
    listRules: vi.fn(async (): Promise<PortForwardRule[]> => []),
    saveRules: vi.fn(async () => ({})),
    getProxy: vi.fn(async (): Promise<ProxyConfig> => ({
      useWindowsProxy: false,
      httpProxy: '',
      httpsProxy: '',
      noProxy: 'localhost',
    })),
    saveProxy: vi.fn(async () => ({})),
    status: vi.fn(async (): Promise<NetworkStatus | null> => null),
    apply: vi.fn(async () => ({ taskId: 'a' })),
    applyAll: vi.fn(async () => ({ taskId: 'b' })),
    remove: vi.fn(async () => ({ taskId: 'c' })),
    proxyApply: vi.fn(async () => ({ distro: 'Ubuntu' })),
    proxyClear: vi.fn(async () => ({ distro: 'Ubuntu' })),
    proxyState: vi.fn(async () => ({ path: '/x', exists: false, content: '' })),
  },
  devices: {
    status: vi.fn(async (): Promise<UsbipdStatus> => ({ installed: false, version: '' })),
    list: vi.fn(async (): Promise<UsbDevice[]> => []),
    bind: vi.fn(async () => ({ taskId: 'd' })),
    unbind: vi.fn(async () => ({ taskId: 'e' })),
    attach: vi.fn(async () => {}),
    detach: vi.fn(async () => {}),
  },
  distros: { list: vi.fn(async (): Promise<DistroView[]> => []) },
  task: { cancel: vi.fn(async () => true), onProgress: vi.fn(() => () => {}) },
  app: { openPath: vi.fn(async () => {}) },
  config: { get: vi.fn(async () => ({})), set: vi.fn(async () => ({})) },
}
;(globalThis as any).window.wslAPI = wslAPI

const MirrorModeCard = (await import('../../src/renderer/features/network/MirrorModeCard.vue'))
  .default
const PortForwardTable = (await import('../../src/renderer/features/network/PortForwardTable.vue'))
  .default
const PortForwardForm = (await import('../../src/renderer/features/network/PortForwardForm.vue'))
  .default
const ProxyPanel = (await import('../../src/renderer/features/network/ProxyPanel.vue')).default
const DevicesView = (await import('../../src/renderer/views/DevicesView.vue')).default
const NetworkView = (await import('../../src/renderer/views/NetworkView.vue')).default

const { createPinia, setActivePinia } = await import('pinia')

function distro(name: string): DistroView {
  return {
    name,
    state: 'Stopped',
    version: 2,
    isDefault: false,
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

const RULE: PortForwardRule = {
  id: 'dev-3000',
  distro: 'Ubuntu',
  listenAddress: '0.0.0.0',
  listenPort: 3000,
  connectAddress: '127.0.0.1',
  connectPort: 3000,
  enabled: true,
  protocol: 'tcp',
}

function statusOf(over: Partial<NetworkStatus> = {}): NetworkStatus {
  return {
    wslconfigPath: 'C:\\Users\\u\\.wslconfig',
    wslconfigExists: true,
    mode: 'nat',
    modeRaw: 'nat',
    mirrorRecommended: true,
    portProxy: [],
    windowsProxy: null,
    ...over,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  setActivePinia(createPinia())
  // NModal 会 teleport 到 body：清空上一用例残留，避免 findButton 命中旧节点
  document.body.innerHTML = ''
})

describe('MirrorModeCard', () => {
  it('镜像模式已开启时展示成功态', () => {
    const w = mount(MirrorModeCard, {
      props: { status: statusOf({ mode: 'mirrored', mirrorRecommended: false }) },
    })
    expect(w.text()).toContain('镜像 mirrored')
    expect(w.text()).toContain('镜像模式已开启')
    expect(w.find('.mirror-card').classes()).toContain('ok')
  })

  it('非镜像模式展示引导与配置片段', async () => {
    const w = mount(MirrorModeCard, { props: { status: statusOf() } })
    expect(w.text()).toContain('推荐开启镜像网络模式')
    expect(w.text()).toContain('networkingMode=mirrored')
    expect(w.text()).toContain('NAT')

    const copy = w.findAll('button').find((b) => b.text().includes('复制配置片段'))
    await copy!.trigger('click')
    expect(message.success).toHaveBeenCalled()

    const dir = w.findAll('button').find((b) => b.text().includes('打开 .wslconfig 所在目录'))
    await dir!.trigger('click')
    expect(w.emitted('openDir')).toHaveLength(1)
  })

  it('文件缺失时标注', () => {
    const w = mount(MirrorModeCard, {
      props: { status: statusOf({ wslconfigExists: false, mode: 'unknown' }) },
    })
    expect(w.text()).toContain('文件不存在')
  })
})

describe('PortForwardTable', () => {
  it('空状态引导新建', async () => {
    const w = mount(PortForwardTable, { props: { rules: [], status: null } })
    expect(w.text()).toContain('还没有端口转发规则')
    const btn = w.findAll('button').find((b) => b.text().includes('新建第一条规则'))
    await btn!.trigger('click')
    expect(w.emitted('create')).toHaveLength(1)
  })

  it('渲染规则行并派发动作', async () => {
    const w = mount(PortForwardTable, {
      props: {
        rules: [RULE, { ...RULE, id: 'udp-rule', protocol: 'udp', listenPort: 5353 }],
        status: statusOf({
          portProxy: [
            {
              listenAddress: '0.0.0.0',
              listenPort: 3000,
              connectAddress: '127.0.0.1',
              connectPort: 3000,
              kind: 'v4tov4',
            },
          ],
        }),
      },
    })
    expect(w.text()).toContain('dev-3000')
    expect(w.text()).toContain('已生效')
    expect(w.text()).toContain('仅记录')

    const rows = w.findAll('tbody tr')
    expect(rows).toHaveLength(2)

    const apply = rows[0]!.findAll('button').find((b) => b.text().includes('应用'))
    await apply!.trigger('click')
    expect(w.emitted('apply')![0]).toEqual([RULE])

    const edit = rows[0]!.findAll('button').find((b) => b.text().includes('编辑'))
    await edit!.trigger('click')
    expect(w.emitted('edit')).toHaveLength(1)

    const del = rows[0]!.findAll('button').find((b) => b.text().includes('删除'))
    await del!.trigger('click')
    expect(w.emitted('remove')).toHaveLength(1)

    const rmSys = rows[0]!.findAll('button').find((b) => b.text().includes('从系统移除'))
    await rmSys!.trigger('click')
    expect(w.emitted('removeSystem')).toHaveLength(1)

    // udp 规则的「应用」被禁用
    const udpApply = rows[1]!.findAll('button').find((b) => b.text().includes('应用'))
    expect(udpApply!.attributes('disabled')).toBeDefined()
  })

  it('启用开关与全部应用', async () => {
    const w = mount(PortForwardTable, { props: { rules: [RULE], status: null } })
    const sw = w.findComponent(NSwitch)
    await sw.vm.$emit('update:value', false)
    expect(w.emitted('toggle')![0]).toEqual([RULE, false])

    const all = w.findAll('button').find((b) => b.text().includes('全部应用'))
    await all!.trigger('click')
    expect(w.emitted('applyAll')).toHaveLength(1)
  })
})

describe('PortForwardForm', () => {
  /** NModal 内容走 teleport 到 body，断言一律查 document.body */
  function bodyText(): string {
    return document.body.textContent ?? ''
  }

  function findButton(label: string): HTMLButtonElement | null {
    const list = Array.from(document.body.querySelectorAll('button'))
    return (list.find((b) => (b.textContent ?? '').includes(label)) as HTMLButtonElement) ?? null
  }

  it('新建时预填 id 与发行版', async () => {
    mount(PortForwardForm, {
      props: {
        show: true,
        rule: null,
        rules: [],
        distros: [distro('Ubuntu'), distro('Debian')],
      },
      attachTo: document.body,
    })
    await flushPromises()
    expect(bodyText()).toContain('新建转发规则')
    const ids = Array.from(document.body.querySelectorAll('input')).map((i) => i.value)
    expect(ids).toContain('dev-3000')
  })

  it('编辑时载入规则并可保存', async () => {
    const w = mount(PortForwardForm, {
      props: { show: true, rule: RULE, rules: [RULE], distros: [distro('Ubuntu')] },
      attachTo: document.body,
    })
    await flushPromises()
    expect(bodyText()).toContain('编辑转发规则')
    expect(bodyText()).toContain('应用时执行')

    const save = findButton('保存修改')
    expect(save).toBeTruthy()
    await w.vm.$nextTick()
    save!.click()
    await flushPromises()
    const emitted = w.emitted('save')
    expect(emitted).toHaveLength(1)
    expect((emitted![0]![0] as PortForwardRule).id).toBe('dev-3000')
    expect(w.emitted('update:show')![0]).toEqual([false])
  })

  it('校验失败时展示原因并禁用保存', async () => {
    mount(PortForwardForm, {
      props: {
        show: true,
        rule: { ...RULE, id: 'a/b' },
        rules: [RULE],
        distros: [distro('Ubuntu')],
      },
      attachTo: document.body,
    })
    await flushPromises()
    expect(bodyText()).toContain('规则 id 非法')
    const save = findButton('保存修改') as HTMLButtonElement | null
    expect(save).toBeTruthy()
    expect(save!.disabled).toBe(true)
  })
})

describe('ProxyPanel', () => {
  const proxy = {
    useWindowsProxy: false,
    httpProxy: 'http://127.0.0.1:7890',
    httpsProxy: '',
    noProxy: 'localhost',
  }

  it('展示配置与脚本预览', () => {
    const w = mount(ProxyPanel, {
      props: {
        proxy,
        distros: [distro('Ubuntu')],
        windowsProxy: { enabled: true, server: 'p:8080', override: '' },
        proxyScript: null,
      },
      attachTo: document.body,
    })
    expect(w.text()).toContain('代理配置')
    expect(w.text()).toContain('跟随 Windows 系统代理')
    expect(w.text()).toContain('Windows 系统代理：http://p:8080')
    expect(w.text()).toContain('/etc/profile.d/wslpilot-proxy.sh')
  })

  it('保存 / 应用 / 清除 / 查看派发事件', async () => {
    const w = mount(ProxyPanel, {
      props: {
        proxy,
        distros: [distro('Ubuntu')],
        windowsProxy: null,
        proxyScript: { path: '/etc/profile.d/wslpilot-proxy.sh', exists: true, content: 'x' },
      },
      attachTo: document.body,
    })
    await flushPromises()

    const save = w.findAll('button').find((b) => b.text().includes('保存配置'))
    await save!.trigger('click')
    expect(w.emitted('save')).toHaveLength(1)

    const apply = w.findAll('button').find((b) => b.text().includes('写入代理脚本'))
    await apply!.trigger('click')
    await flushPromises()
    expect(w.emitted('apply')).toHaveLength(1)

    const clear = w.findAll('button').find((b) => b.text().includes('清除代理脚本'))
    await clear!.trigger('click')
    expect(w.emitted('clear')).toHaveLength(1)

    const inspect = w.findAll('button').find((b) => b.text().includes('查看当前脚本'))
    await inspect!.trigger('click')
    expect(w.emitted('inspect')).toHaveLength(1)

    expect(w.text()).toContain('已写入')
  })

  it('空代理配置时展示校验提示并禁用保存', async () => {
    const w = mount(ProxyPanel, {
      props: {
        proxy: { useWindowsProxy: false, httpProxy: '', httpsProxy: '', noProxy: '' },
        distros: [distro('Ubuntu')],
        windowsProxy: null,
        proxyScript: null,
      },
      attachTo: document.body,
    })
    await flushPromises()
    expect(w.text()).toContain('请填写 HTTP/HTTPS 代理地址')
    const save = w.findAll('button').find((b) => b.text().includes('保存配置'))
    expect(save!.attributes('disabled')).toBeDefined()
  })
})

describe('DevicesView', () => {
  const device: UsbDevice = {
    busId: '1-2',
    vid: '046d',
    pid: 'c534',
    description: 'USB Receiver',
    state: 'shared',
  }

  it('未安装 usbipd 时展示安装引导', async () => {
    wslAPI.devices.status.mockResolvedValue({ installed: false, version: '' })
    const w = mount(DevicesView, { attachTo: document.body })
    await flushPromises()
    expect(w.text()).toContain('未检测到 usbipd')
    expect(w.text()).toContain('winget install usbipd')

    const copy = w.findAll('button').find((b) => b.text().includes('复制安装命令'))
    await copy!.trigger('click')
    expect(message.success).toHaveBeenCalled()
  })

  it('已安装时渲染设备表并派发开关', async () => {
    wslAPI.devices.status.mockResolvedValue({ installed: true, version: '2.4.1' })
    wslAPI.devices.list.mockResolvedValue([device, { ...device, busId: '2-1', state: 'attached' }])
    const w = mount(DevicesView, { attachTo: document.body })
    await flushPromises()
    expect(w.text()).toContain('USB Receiver')
    expect(w.text()).toContain('已共享')
    expect(w.text()).toContain('已附加')
    expect(w.text()).toContain('usbipd 2.4.1')

    const rows = w.findAll('tbody tr')
    expect(rows).toHaveLength(2)

    const shareSwitch = rows[0]!.findAllComponents(NSwitch)[0]!
    await shareSwitch.vm.$emit('update:value', false)
    await flushPromises()
    expect(wslAPI.devices.unbind).toHaveBeenCalledWith('1-2')

    const attachSwitch = rows[0]!.findAllComponents(NSwitch)[1]!
    await attachSwitch.vm.$emit('update:value', true)
    await flushPromises()
    expect(wslAPI.devices.attach).toHaveBeenCalled()
  })

  it('空设备列表展示空状态', async () => {
    wslAPI.devices.status.mockResolvedValue({ installed: true, version: '' })
    wslAPI.devices.list.mockResolvedValue([])
    const w = mount(DevicesView, { attachTo: document.body })
    await flushPromises()
    expect(w.text()).toContain('没有发现 USB 设备')
  })

  it('操作失败给出错误提示', async () => {
    wslAPI.devices.status.mockResolvedValue({ installed: true, version: '' })
    wslAPI.devices.list.mockResolvedValue([device])
    wslAPI.devices.bind.mockRejectedValue(new Error('需要管理员权限'))
    const w = mount(DevicesView, { attachTo: document.body })
    await flushPromises()
    const shareSwitch = w.findAllComponents(NSwitch)[0]!
    await shareSwitch.vm.$emit('update:value', true)
    await flushPromises()
    expect(message.error).toHaveBeenCalled()
  })
})

describe('NetworkView', () => {
  it('渲染三大面板并可打开新建规则弹窗', async () => {
    wslAPI.network.listRules.mockResolvedValue([RULE])
    wslAPI.network.getProxy.mockResolvedValue({
      useWindowsProxy: false,
      httpProxy: 'http://127.0.0.1:7890',
      httpsProxy: '',
      noProxy: 'localhost',
    })
    wslAPI.network.status.mockResolvedValue(
      statusOf({ mode: 'mirrored', mirrorRecommended: false }),
    )
    wslAPI.distros.list.mockResolvedValue([distro('Ubuntu')])

    const w = mount(NetworkView, { attachTo: document.body })
    await flushPromises()

    expect(w.text()).toContain('网络')
    expect(w.text()).toContain('网络模式')
    expect(w.text()).toContain('端口转发')
    expect(w.text()).toContain('代理配置')
    expect(w.text()).toContain('系统当前转发')
    expect(w.text()).toContain('dev-3000')

    const create = w.findAll('button').find((b) => b.text().includes('新建规则'))
    await create!.trigger('click')
    await flushPromises()
    expect(document.body.textContent).toContain('新建转发规则')
  })

  it('应用单条规则先弹确认框（展示等价命令）', async () => {
    wslAPI.network.listRules.mockResolvedValue([RULE])
    wslAPI.network.getProxy.mockResolvedValue({
      useWindowsProxy: false,
      httpProxy: '',
      httpsProxy: '',
      noProxy: 'localhost',
    })
    wslAPI.network.status.mockResolvedValue(statusOf())
    wslAPI.distros.list.mockResolvedValue([distro('Ubuntu')])

    const w = mount(NetworkView, { attachTo: document.body })
    await flushPromises()

    const apply = w
      .findAll('button')
      .find((b) => b.text().trim() === '应用' && !b.attributes('disabled'))
    await apply!.trigger('click')
    await flushPromises()
    expect(dialog.warning).toHaveBeenCalledWith(
      expect.objectContaining({
        title: '应用转发规则',
        content: expect.stringContaining('netsh.exe interface portproxy add'),
      }),
    )
  })

  it('无启用规则时全部应用给出提示', async () => {
    wslAPI.network.listRules.mockResolvedValue([{ ...RULE, enabled: false }])
    wslAPI.network.getProxy.mockResolvedValue({
      useWindowsProxy: false,
      httpProxy: '',
      httpsProxy: '',
      noProxy: 'localhost',
    })
    wslAPI.network.status.mockResolvedValue(statusOf())
    wslAPI.distros.list.mockResolvedValue([])

    const w = mount(NetworkView, { attachTo: document.body })
    await flushPromises()

    const applyAll = w.findAll('button').find((b) => b.text().includes('全部应用'))
    await applyAll!.trigger('click')
    await flushPromises()
    expect(message.warning).toHaveBeenCalledWith('没有启用中的转发规则')
    expect(dialog.warning).not.toHaveBeenCalled()
  })
})
