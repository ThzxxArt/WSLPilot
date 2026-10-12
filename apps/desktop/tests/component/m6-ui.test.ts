import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { NSelect, NSwitch } from 'naive-ui'
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
let dialogResult: 'positive' | 'negative' | 'close' = 'positive'
const dialog = {
  /**
   * 可编程回放：确认后真实执行 onPositiveClick（此前纯 vi.fn() 永不回放，
   * NetworkView 的 应用/删除/代理系列动作链路从未在组件层执行过 — review 假信心根治）。
   */
  warning: vi.fn(
    (opts: {
      onPositiveClick?: () => void | Promise<void>
      onNegativeClick?: () => void
      onClose?: () => void
    }) => {
      if (dialogResult === 'positive') return opts.onPositiveClick?.()
      if (dialogResult === 'negative') opts.onNegativeClick?.()
      else opts.onClose?.()
      return undefined
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
const { useNetworkStore } = await import('../../src/renderer/stores/network')

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
  dialogResult = 'positive'
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

  it('loading 时渲染骨架，不先闪推荐卡（review 0.1.2 根治）', () => {
    const w = mount(MirrorModeCard, { props: { status: null, loading: true } })
    expect(w.find('[data-testid="mirror-skeleton"]').exists()).toBe(true)
    expect(w.text()).not.toContain('推荐开启镜像网络模式')
    // 状态 tag 不闪：loading 时也走骨架
    expect(w.find('.n-skeleton').exists()).toBe(true)
  })

  it('未知 mode 值走兜底文案（IPC 数据超枚举不崩 — review 0.1.2 根治）', () => {
    const w = mount(MirrorModeCard, {
      props: {
        status: statusOf({ mode: 'weird-mode' as never }),
      },
    })
    expect(w.text()).toContain('未知')
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
      // FLIP 列表（M7）用 transition-group 渲染 tbody：关闭 stub 才能看到真实行
      global: { stubs: { TransitionGroup: false } },
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
    // udp-only（canApply=false）行的「从系统移除」同样禁用：netsh 只认 TCP
    const udpRemove = rows[1]!.findAll('button').find((b) => b.text().includes('从系统移除'))
    expect(udpRemove!.attributes('disabled')).toBeDefined()
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

  it('停用规则的「应用」禁用；系统中无监听时「从系统移除」禁用（review 0.1.2 根治）', () => {
    const w = mount(PortForwardTable, {
      global: { stubs: { TransitionGroup: false } },
      props: {
        rules: [
          { ...RULE, id: 'off-1', enabled: false, listenPort: 4000 },
          { ...RULE, id: 'none-1', listenPort: 5000 },
        ],
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
    const rows = w.findAll('tbody tr')
    expect(rows).toHaveLength(2)
    // 停用规则：不单独应用
    const applyOff = rows[0]!.findAll('button').find((b) => b.text().includes('应用'))!
    expect(applyOff.attributes('disabled')).toBeDefined()
    // state=none（系统无该监听）：无物可移除
    const rmNone = rows[1]!.findAll('button').find((b) => b.text().includes('从系统移除'))!
    expect(rmNone.attributes('disabled')).toBeDefined()
    // 已应用规则仍可用
    const applied = mount(PortForwardTable, {
      global: { stubs: { TransitionGroup: false } },
      props: {
        rules: [RULE],
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
    const rmApplied = applied.findAll('button').find((b) => b.text().includes('从系统移除'))!
    expect(rmApplied.attributes('disabled')).toBeUndefined()
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
    // 编辑态保存必须交出原 id（upsert 据此重命名，而非静默另插一条）
    expect(emitted![0]![1]).toBe('dev-3000')
    // 受控关闭：save 不自行 close，等父级 upsert 成功后再关（失败保留表单 — review 0.1.2 根治）
    expect(w.emitted('update:show')).toBeUndefined()
  })

  it('saving 期间按钮 loading 且不可重复提交（review 0.1.2 根治）', async () => {
    const w = mount(PortForwardForm, {
      props: {
        show: true,
        rule: RULE,
        rules: [RULE],
        distros: [distro('Ubuntu')],
        saving: true,
      },
      attachTo: document.body,
    })
    await flushPromises()
    const save = findButton('保存修改') as HTMLButtonElement | null
    expect(save).toBeTruthy()
    expect(save!.disabled).toBe(true)
    save!.click()
    await flushPromises()
    expect(w.emitted('save')).toBeUndefined()
  })

  it('编辑态改 id = 重命名：save 携带原 id 与新 id', async () => {
    const w = mount(PortForwardForm, {
      props: { show: true, rule: RULE, rules: [RULE], distros: [distro('Ubuntu')] },
      attachTo: document.body,
    })
    await flushPromises()
    const idInput = Array.from(document.body.querySelectorAll('input'))[0]!
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
    setter.call(idInput, 'renamed-3000')
    idInput.dispatchEvent(new Event('input', { bubbles: true }))
    await flushPromises()

    const save = findButton('保存修改')
    save!.click()
    await flushPromises()
    const payload = w.emitted('save')![0]!
    expect((payload[0] as PortForwardRule).id).toBe('renamed-3000')
    expect(payload[1]).toBe('dev-3000')
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

  it('新建保存路径：创建规则携带表单值且不携带原 id', async () => {
    const w = mount(PortForwardForm, {
      props: { show: true, rule: null, rules: [], distros: [distro('Ubuntu')] },
      attachTo: document.body,
    })
    await flushPromises()
    const create = findButton('创建规则')
    expect(create).toBeTruthy()
    create!.click()
    await flushPromises()
    const emitted = w.emitted('save')
    expect(emitted).toHaveLength(1)
    const rule = emitted![0]![0] as PortForwardRule
    expect(rule.id).toBe('dev-3000')
    expect(rule.distro).toBe('Ubuntu')
    expect(rule.protocol).toBe('tcp')
    expect(emitted![0]![1]).toBeUndefined()
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

  it('切换目标发行版立即隐藏旧脚本并触发重载（消除跨发行版串台 — review 0.1.2 根治）', async () => {
    const w = mount(ProxyPanel, {
      props: {
        proxy,
        distros: [distro('Ubuntu'), distro('Debian')],
        windowsProxy: null,
        proxyScript: {
          path: '/etc/profile.d/wslpilot-proxy.sh',
          exists: true,
          content: '旧发行版脚本',
        },
      },
      attachTo: document.body,
    })
    await flushPromises()
    expect(w.text()).toContain('旧发行版脚本')

    const select = w.findComponent(NSelect)
    await select.vm.$emit('update:value', 'Debian')
    await flushPromises()
    // 旧脚本立即隐藏 + 触发按新发行版重载
    expect(w.text()).not.toContain('旧发行版脚本')
    expect(w.emitted('inspect')!.at(-1)).toEqual(['Debian'])

    // 新发行版结果到达 → 重新展示
    await w.setProps({
      proxyScript: {
        path: '/etc/profile.d/wslpilot-proxy.sh',
        exists: true,
        content: '新发行版脚本',
      },
    })
    await flushPromises()
    expect(w.text()).toContain('新发行版脚本')
  })

  it('applying 期间整个操作区禁用（review 0.1.2 根治）', async () => {
    const w = mount(ProxyPanel, {
      props: {
        proxy,
        distros: [distro('Ubuntu')],
        windowsProxy: null,
        proxyScript: null,
        applying: true,
      },
      attachTo: document.body,
    })
    await flushPromises()
    const save = w.findAll('button').find((b) => b.text().includes('保存配置'))!
    const apply = w.findAll('button').find((b) => b.text().includes('写入代理脚本'))!
    const clear = w.findAll('button').find((b) => b.text().includes('清除代理脚本'))!
    const inspect = w.findAll('button').find((b) => b.text().includes('查看当前脚本'))!
    for (const b of [save, apply, clear, inspect]) {
      expect(b.attributes('disabled')).toBeDefined()
    }
  })

  it('HTTP 代理形态非法时展示错误并禁用保存（review 0.1.2 根治）', async () => {
    const w = mount(ProxyPanel, {
      props: {
        proxy: { useWindowsProxy: false, httpProxy: 'http://no-port', httpsProxy: '', noProxy: '' },
        distros: [distro('Ubuntu')],
        windowsProxy: null,
        proxyScript: null,
      },
      attachTo: document.body,
    })
    await flushPromises()
    expect(w.text()).toContain('格式应为 host:port')
    const save = w.findAll('button').find((b) => b.text().includes('保存配置'))!
    expect(save.attributes('disabled')).toBeDefined()
  })

  it('跟随 Windows 系统代理时展示 ProxyOverride（no_proxy 回退）摘要', () => {
    const w = mount(ProxyPanel, {
      props: {
        proxy: { useWindowsProxy: true, httpProxy: '', httpsProxy: '', noProxy: '' },
        distros: [distro('Ubuntu')],
        windowsProxy: {
          enabled: true,
          server: 'p:8080',
          override: 'localhost;127.0.0.1;<local>',
        },
        proxyScript: null,
      },
      attachTo: document.body,
    })
    expect(w.text()).toContain('Windows 系统代理：http://p:8080')
    expect(w.text()).toContain('不代理列表（no_proxy 回退）：localhost;127.0.0.1;<local>')
  })

  it('空代理配置 = 显式关闭（可保存，不再逼用户留假地址）', async () => {
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
    expect(w.text()).not.toContain('请填写 HTTP/HTTPS 代理地址')
    const save = w.findAll('button').find((b) => b.text().includes('保存配置'))
    expect(save!.attributes('disabled')).toBeUndefined()
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
    // 参数契约：busId 必须正确、未选目标发行版时传 undefined（不是空串 / 错位）
    expect(wslAPI.devices.attach).toHaveBeenCalledWith('1-2', undefined)
  })

  it('load 失败展示错误态而非「没有发现 USB 设备」', async () => {
    wslAPI.devices.status.mockResolvedValue({ installed: true, version: '2.4.1' })
    wslAPI.devices.list.mockRejectedValue(
      new Error('WSLPILOT:{"code":"TASK_FAILED","message":"usbipd 调用炸了","recoverable":true}'),
    )
    const w = mount(DevicesView, { attachTo: document.body })
    await flushPromises()
    expect(w.text()).toContain('读取设备列表失败')
    expect(w.text()).toContain('usbipd 调用炸了')
    expect(w.text()).not.toContain('没有发现 USB 设备')
  })

  it('bind 在途时禁用该行开关（防重复提交）', async () => {
    wslAPI.devices.status.mockResolvedValue({ installed: true, version: '2.4.1' })
    wslAPI.devices.list.mockResolvedValue([{ ...device, state: 'not-shared' }])
    let resolveBind!: (v: { taskId: string }) => void
    wslAPI.devices.bind.mockReturnValueOnce(
      new Promise<{ taskId: string }>((r) => (resolveBind = r)),
    )
    const w = mount(DevicesView, { attachTo: document.body })
    await flushPromises()
    const rows = w.findAll('tbody tr')
    const shareSwitch = rows[0]!.findAllComponents(NSwitch)[0]!
    expect(shareSwitch.props('disabled')).toBe(false)

    await shareSwitch.vm.$emit('update:value', true)
    await flushPromises()
    // 在途：行内开关禁用，重复提交进不来
    expect(shareSwitch.props('disabled')).toBe(true)
    await shareSwitch.vm.$emit('update:value', true)
    await flushPromises()
    expect(wslAPI.devices.bind).toHaveBeenCalledTimes(1)

    resolveBind({ taskId: 'd' })
    await flushPromises()
    expect(shareSwitch.props('disabled')).toBe(false)
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

  it('应用单条规则先弹确认框（展示等价命令 + 复制按钮 — review 0.1.2 根治）', async () => {
    setupNetwork([RULE])
    const w = mount(NetworkView, { attachTo: document.body })
    await flushPromises()

    await applyButton(w)!.trigger('click')
    await flushPromises()

    const call = dialog.warning.mock.calls.find(
      (c) => (c[0] as { title?: string }).title === '应用转发规则',
    )![0] as { content: () => unknown }
    expect(call).toBeTruthy()
    // content 是 render 函数：渲染后检查命令文本与复制按钮
    const belt = mount({ render: () => call.content() as never })
    expect(belt.text()).toContain('netsh.exe interface portproxy add')
    const copy = belt.findAll('button').find((b) => b.text().includes('复制'))
    expect(copy).toBeTruthy()
    await copy!.trigger('click')
    await flushPromises()
    expect(message.success).toHaveBeenCalledWith('命令已复制')
  })

  it('load 失败展示错误横幅（不静默）', async () => {
    const boom = new Error(
      'WSLPILOT:{"code":"IO_ERROR","message":"network.jsonc 读不动","recoverable":true}',
    )
    wslAPI.network.listRules.mockRejectedValue(boom)
    wslAPI.network.getProxy.mockRejectedValue(boom)
    wslAPI.network.status.mockRejectedValue(boom)
    wslAPI.distros.list.mockResolvedValue([])
    const w = mount(NetworkView, { attachTo: document.body })
    await flushPromises()
    const banner = w.find('.error-banner')
    expect(banner.exists()).toBe(true)
    expect(banner.text()).toContain('network.jsonc 读不动')
  })

  it('头部展示系统已生效规则数（appliedCount 落地）', async () => {
    wslAPI.network.listRules.mockResolvedValue([RULE])
    wslAPI.network.getProxy.mockResolvedValue({
      useWindowsProxy: false,
      httpProxy: '',
      httpsProxy: '',
      noProxy: 'localhost',
    })
    wslAPI.network.status.mockResolvedValue(
      statusOf({
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
    )
    wslAPI.distros.list.mockResolvedValue([])
    const w = mount(NetworkView, { attachTo: document.body })
    await flushPromises()
    expect(w.find('.page-header').text()).toContain('系统已生效 1 条')
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

  function setupNetwork(rules: PortForwardRule[], status = statusOf()) {
    wslAPI.network.listRules.mockResolvedValue(rules)
    wslAPI.network.getProxy.mockResolvedValue({
      useWindowsProxy: false,
      httpProxy: '',
      httpsProxy: '',
      noProxy: 'localhost',
    })
    wslAPI.network.status.mockResolvedValue(status)
    wslAPI.distros.list.mockResolvedValue([distro('Ubuntu')])
  }

  function applyButton(w: ReturnType<typeof mount>) {
    return w.findAll('button').find((b) => b.text().trim() === '应用' && !b.attributes('disabled'))
  }

  it('应用单条规则确认后真实执行 network.apply 并刷新状态（dialog 回放 — review 假信心根治）', async () => {
    setupNetwork([RULE])
    const w = mount(NetworkView, { attachTo: document.body })
    await flushPromises()
    const statusCallsBefore = wslAPI.network.status.mock.calls.length
    await applyButton(w)!.trigger('click')
    await flushPromises()
    expect(wslAPI.network.apply).toHaveBeenCalledWith('dev-3000')
    expect(message.success).toHaveBeenCalledWith(expect.stringContaining('已提交应用'))
    expect(wslAPI.network.status.mock.calls.length).toBeGreaterThan(statusCallsBefore)
  })

  it('应用确认框取消则不执行', async () => {
    setupNetwork([RULE])
    dialogResult = 'negative'
    const w = mount(NetworkView, { attachTo: document.body })
    await flushPromises()
    await applyButton(w)!.trigger('click')
    await flushPromises()
    expect(dialog.warning).toHaveBeenCalled()
    expect(wslAPI.network.apply).not.toHaveBeenCalled()
  })

  it('删除规则确认后落盘，并通过通知撤销恢复', async () => {
    setupNetwork([RULE])
    let captured: { action?: () => { props: { onClick: () => void } } } | null = null
    notification.warning.mockImplementationOnce((opts: unknown) => {
      captured = opts as { action?: () => { props: { onClick: () => void } } }
      return { destroy: vi.fn() }
    })
    const w = mount(NetworkView, { attachTo: document.body })
    await flushPromises()
    const del = w.findAll('button').find((b) => b.text().includes('删除'))
    await del!.trigger('click')
    await flushPromises()
    expect(wslAPI.network.saveRules).toHaveBeenCalledWith([])
    expect(captured).toBeTruthy()
    captured!.action!().props.onClick()
    await flushPromises()
    expect(wslAPI.network.saveRules).toHaveBeenLastCalledWith([RULE])
    expect(message.success).toHaveBeenCalledWith('已恢复规则')
  })

  it('连续删除两条规则：各自撤销恢复各自快照（review 0.1.2 根治）', async () => {
    const RULE2 = { ...RULE, id: 'dev-4000', listenPort: 4000 }
    setupNetwork([RULE, RULE2])
    const captured: Array<{ action?: () => { props: { onClick: () => void } } }> = []
    notification.warning.mockImplementation((opts: unknown) => {
      captured.push(opts as { action?: () => { props: { onClick: () => void } } })
      return { destroy: vi.fn() }
    })
    const w = mount(NetworkView, { attachTo: document.body })
    await flushPromises()
    const store = useNetworkStore()

    // 删第一条 → 删第二条（确认框自动回放）
    let del = w.findAll('button').find((b) => b.text().includes('删除'))
    await del!.trigger('click')
    await flushPromises()
    del = w.findAll('button').find((b) => b.text().includes('删除'))
    await del!.trigger('click')
    await flushPromises()
    expect(store.rules).toHaveLength(0)
    expect(captured).toHaveLength(2)

    // 点第一条的撤销：恢复 A 而不是被 B 的 lastRemoved 覆盖
    captured[0]!.action!().props.onClick()
    await flushPromises()
    expect(store.rules.map((r) => r.id)).toEqual(['dev-3000'])
    // 点第二条的撤销：恢复 B
    captured[1]!.action!().props.onClick()
    await flushPromises()
    expect(store.rules.map((r) => r.id).sort()).toEqual(['dev-3000', 'dev-4000'])
  })

  it('系统状态在页面可见时按 12s 轻量轮询（silent 不闪 loading — review 0.1.2 根治）', async () => {
    vi.useFakeTimers()
    try {
      setupNetwork([RULE])
      const w = mount(NetworkView, { attachTo: document.body })
      await vi.advanceTimersByTimeAsync(20)
      const before = wslAPI.network.status.mock.calls.length
      await vi.advanceTimersByTimeAsync(12_000)
      expect(wslAPI.network.status.mock.calls.length).toBeGreaterThan(before)
      // silent 轮询不点亮 statusLoading
      expect(useNetworkStore().statusLoading).toBe(false)
      w.unmount()
    } finally {
      vi.useRealTimers()
    }
  })

  it('保存规则失败时编辑弹窗保留（受控关闭 — review 0.1.2 根治）', async () => {
    setupNetwork([RULE])
    wslAPI.network.saveRules.mockRejectedValueOnce(new Error('disk full'))
    const w = mount(NetworkView, { attachTo: document.body })
    await flushPromises()
    const edit = w.findAll('button').find((b) => b.text().includes('编辑'))
    await edit!.trigger('click')
    await flushPromises()
    expect(document.body.textContent).toContain('编辑转发规则')

    const save = Array.from(document.body.querySelectorAll('button')).find((b) =>
      (b.textContent ?? '').includes('保存修改'),
    )!
    save.click()
    await flushPromises()
    // 失败：弹窗保留（表单不丢），错误如实提示
    expect(document.body.textContent).toContain('编辑转发规则')
    expect(message.error).toHaveBeenCalledWith(expect.stringContaining('disk full'))
  })

  it('写入代理脚本串行「保存配置 → 写入发行版」（不写旧代理 — review M-9）', async () => {
    setupNetwork([])
    const w = mount(NetworkView, { attachTo: document.body })
    await flushPromises()
    const httpInput = w
      .findAll('input')
      .find((i) => (i.attributes('placeholder') ?? '').includes('7890'))
    expect(httpInput).toBeTruthy()
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
    setter.call(httpInput!.element, 'http://127.0.0.1:12345')
    httpInput!.element.dispatchEvent(new Event('input', { bubbles: true }))
    await flushPromises()

    const applyBtn = w.findAll('button').find((b) => b.text().includes('写入代理脚本'))
    await applyBtn!.trigger('click')
    await flushPromises()
    expect(wslAPI.network.saveProxy).toHaveBeenCalledWith(
      expect.objectContaining({ httpProxy: 'http://127.0.0.1:12345' }),
    )
    const saveOrder = wslAPI.network.saveProxy.mock.invocationCallOrder[0]!
    const applyOrder = wslAPI.network.proxyApply.mock.invocationCallOrder[0]!
    expect(saveOrder).toBeLessThan(applyOrder)
    expect(wslAPI.network.proxyApply).toHaveBeenCalledWith('Ubuntu')
  })
})
