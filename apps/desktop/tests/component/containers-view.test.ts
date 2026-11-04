import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { enableAutoUnmount, mount, flushPromises } from '@vue/test-utils'
import { defineComponent, nextTick } from 'vue'
import { NConfigProvider, NDialogProvider, NMessageProvider } from 'naive-ui'
import { createPinia, setActivePinia } from 'pinia'
import { createWslAPI, bodyText, type WslAPIMock } from './support'

enableAutoUnmount(afterEach)

const routerMock = { push: vi.fn() }
vi.mock('vue-router', () => ({
  useRouter: () => routerMock,
  useRoute: () => ({ name: 'containers', query: {}, path: '/containers' }),
}))

let wslAPI: WslAPIMock
;(globalThis as any).window.wslAPI = wslAPI = createWslAPI()

const { useContainersStore } = await import('../../src/renderer/stores/containers')
const { useSettingsStore } = await import('../../src/renderer/stores/settings')
const ContainersView = (await import('../../src/renderer/views/ContainersView.vue')).default

const Wrapper = defineComponent({
  components: { NConfigProvider, NMessageProvider, NDialogProvider, ContainersView },
  template: `
    <n-config-provider>
      <n-message-provider>
        <n-dialog-provider>
          <ContainersView />
        </n-dialog-provider>
      </n-message-provider>
    </n-config-provider>
  `,
})

async function mountView() {
  const w = mount(Wrapper, { attachTo: document.body })
  await flushPromises()
  await nextTick()
  return w
}

beforeEach(() => {
  vi.clearAllMocks()
  setActivePinia(createPinia())
  document.body.innerHTML = ''
  wslAPI = createWslAPI()
  ;(globalThis as any).window.wslAPI = wslAPI
})

afterEach(() => {
  document.body.innerHTML = ''
})

describe('ContainersView（WSL 3 容器工作台）', () => {
  it('wslc 未安装：显示升级提示，运行按钮禁用', async () => {
    wslAPI.containers.status.mockResolvedValue({ installed: false, version: '' })
    const w = await mountView()
    expect(w.text()).toContain('未检测到 wslc')
    expect(w.text()).toContain('wsl --update')
    const runBtn = w.findAll('button').find((b) => b.text().includes('运行容器'))
    expect(runBtn?.attributes('disabled')).toBeDefined()
    // 不调用需要 wslc 的列表接口（避免错误态噪音）
    expect(wslAPI.containers.list).not.toHaveBeenCalled()
  })

  it('已安装：渲染容器列表、状态、端口与统计', async () => {
    wslAPI.containers.list.mockResolvedValue([
      {
        id: 'abc123456789',
        name: 'web',
        image: 'nginx:latest',
        state: 'running',
        status: 'Up 2 hours',
        health: 'healthy',
        ports: [{ host: 8080, container: 80 }],
        createdAt: '',
      },
      {
        id: 'def456789012',
        name: 'job',
        image: 'alpine:latest',
        state: 'exited',
        status: 'Exited (0)',
        health: 'none',
        ports: [],
        createdAt: '',
      },
    ])
    wslAPI.containers.stats.mockResolvedValue([
      {
        containerId: 'abc123456789',
        name: 'web',
        cpuPercent: 12.34,
        memUsedBytes: 1024 ** 2,
        memLimitBytes: 1024 ** 3,
        netRxBytes: 0,
        netTxBytes: 0,
        blockReadBytes: 0,
        blockWriteBytes: 0,
        pids: 3,
        sampledAt: '2026-01-01T00:00:00.000Z',
      },
    ])
    const w = await mountView()
    const text = w.text()
    expect(text).toContain('容器 2')
    expect(text).toContain('web')
    expect(text).toContain('nginx:latest')
    expect(text).toContain('12.3%')
    expect(text).toContain('1.0MB')
    expect(text).toContain('healthy')
    expect(text).toContain('8080 → 80')
    // 运行中 → 停止；已退出 → 启动
    expect(text).toContain('停止')
    expect(text).toContain('启动')
  })

  it('事件订阅：onChanged 触发节流重载；卸载后取消订阅', async () => {
    let changed: (() => void) | null = null
    const off = vi.fn()
    wslAPI.containers.onChanged.mockImplementation((cb: () => void) => {
      changed = cb
      return off
    })
    const w = await mountView()
    expect(wslAPI.containers.onChanged).toHaveBeenCalled()
    const before = wslAPI.containers.list.mock.calls.length
    changed!()
    await vi.waitFor(() => expect(wslAPI.containers.list.mock.calls.length).toBeGreaterThan(before))
    w.unmount()
    expect(off).toHaveBeenCalled()
  })

  it('运行向导：预览等价 argv；非法端口给出错误提示', async () => {
    const w = await mountView()
    const runBtn = w.findAll('button').find((b) => b.text().includes('运行容器'))
    expect(runBtn).toBeTruthy()
    await runBtn!.trigger('click')
    await nextTick()
    await flushPromises()
    // NModal teleport 到 body
    await vi.waitFor(() => expect(bodyText()).toContain('等价命令'))
    expect(bodyText()).toContain('wslc.exe run -d')
    expect(bodyText()).toContain('ubuntu:latest')

    const portInput = document.querySelector(
      'textarea[placeholder="8080:80（每行一条）"]',
    ) as HTMLTextAreaElement | null
    expect(portInput).toBeTruthy()
    portInput!.value = 'bad-port'
    portInput!.dispatchEvent(new Event('input', { bubbles: true }))
    await nextTick()
    await vi.waitFor(() => expect(bodyText()).toContain('端口映射格式'))
  })

  it('选择运行容器并提交：调用 containers.run 并跟踪任务', async () => {
    wslAPI.containers.run.mockResolvedValue({ taskId: 'c-run' })
    const w = await mountView()
    const runBtn = w.findAll('button').find((b) => b.text().includes('运行容器'))
    await runBtn!.trigger('click')
    await nextTick()
    await vi.waitFor(() => expect(bodyText()).toContain('等价命令'))
    const confirm = Array.from(document.querySelectorAll('button')).find(
      (b) => b.textContent?.trim() === '运行',
    ) as HTMLButtonElement
    expect(confirm).toBeTruthy()
    confirm.click()
    await flushPromises()
    expect(wslAPI.containers.run).toHaveBeenCalledWith(
      expect.objectContaining({ image: 'ubuntu:latest', detach: true }),
    )
  })

  it('镜像 / 网络 / 卷 Tab 展示空态', async () => {
    const w = await mountView()
    expect(w.text()).toContain('镜像 0')
    expect(w.text()).toContain('网络 0')
    expect(w.text()).toContain('卷 0')
    const text = w.text()
    expect(text).toContain('还没有容器')
  })

  it('loadAll 失败：错误横幅可见且页面不崩', async () => {
    wslAPI.containers.list.mockRejectedValue({
      code: 'TASK_FAILED',
      message: 'wslc 会话不可用',
      recoverable: true,
    })
    const w = await mountView()
    expect(w.text()).toContain('wslc 会话不可用')
    // 工具栏仍可用
    expect(w.text()).toContain('刷新')
  })

  it('store 默认状态与 getter 契约（正反例）', async () => {
    const store = useContainersStore()
    const settings = useSettingsStore()
    expect(store.installed).toBe(false)
    expect(store.running).toEqual([])
    expect(store.statsFor('x')).toBeNull()
    await store.loadAll()
    expect(store.installed).toBe(true)
    expect(settings.containersStatsIntervalMs).toBeGreaterThanOrEqual(500)
  })
})

async function richMount() {
  wslAPI.containers.list.mockResolvedValue([
    {
      id: 'c1',
      name: 'web',
      image: 'nginx:latest',
      state: 'running',
      status: 'Up',
      health: 'healthy',
      ports: [{ host: 8080, container: 80 }],
      createdAt: '',
    },
    {
      id: 'c2',
      name: 'job',
      image: 'alpine:latest',
      state: 'exited',
      status: 'Exited',
      health: 'none',
      ports: [],
      createdAt: '',
    },
  ])
  wslAPI.images.list.mockResolvedValue([
    {
      id: 'i1',
      repository: 'nginx',
      tag: 'latest',
      sizeBytes: 1024,
      createdAt: '',
      containers: 1,
    },
  ])
  wslAPI.networks.list.mockResolvedValue([
    {
      id: 'n1',
      name: 'net',
      driver: 'bridge',
      subnet: '172.18.0.0/16',
      containers: ['web'],
      internal: false,
    },
  ])
  wslAPI.volumes.list.mockResolvedValue([{ name: 'vol', driver: 'local', mountpoint: '/mnt/vol' }])
  wslAPI.containers.sessionList.mockResolvedValue([
    { name: 'default', state: 'running', storagePath: '/data' },
  ])
  wslAPI.containers.systemInfo.mockResolvedValue({
    version: '2.9.3',
    storagePath: '/data',
    storageBytes: 2048,
  })
  wslAPI.containers.settingsRead.mockResolvedValue({
    path: '%LOCALAPPDATA%\\wslc\\settings.yaml',
    exists: true,
    content: 'session:\n  cpuCount: 2\n',
    model: { session: { cpuCount: 2 } },
  })
  return mountView()
}

function visiblePane(): ParentNode {
  const panes = Array.from(document.querySelectorAll('.n-tab-pane')) as HTMLElement[]
  return panes.find((p) => getComputedStyle(p).display !== 'none') ?? document
}

function buttons(text: string): HTMLButtonElement[] {
  return Array.from(visiblePane().querySelectorAll('button')).filter(
    (b) => b.textContent?.trim() === text,
  ) as HTMLButtonElement[]
}

async function clickTab(label: string) {
  const tab = Array.from(document.querySelectorAll('.n-tabs-tab')).find((t) =>
    t.textContent?.includes(label),
  ) as HTMLElement | null
  expect(tab, `tab ${label}`).toBeTruthy()
  tab!.click()
  await flushPromises()
  await nextTick()
}

async function confirmDialog() {
  await flushPromises()
  await nextTick()
  const dialogs = (Array.from(document.querySelectorAll('.n-dialog')) as HTMLElement[]).filter(
    (d) => d.offsetParent !== null || getComputedStyle(d).display !== 'none',
  )
  const scope = dialogs.at(-1) ?? document
  const ok = Array.from(scope.querySelectorAll('button')).find((b) =>
    b.textContent?.includes('确定'),
  ) as HTMLButtonElement | null
  expect(ok, '确认对话框应有确定按钮').toBeTruthy()
  ok!.click()
  await flushPromises()
}

describe('ContainersView 全 Tab 交互（0.2.0 覆盖面）', () => {
  it('容器操作：inspect / 日志 / 启停 / 重启 / 终端 / 删除', async () => {
    const w = await richMount()
    // inspect
    const nameBtn = w.findAll('button').find((b) => b.text() === 'web')!
    await nameBtn.trigger('click')
    await flushPromises()
    expect(bodyText()).toContain('容器详情')

    // 日志
    buttons('日志')[0]!.click()
    await flushPromises()
    expect(wslAPI.containers.logs).toHaveBeenCalledWith('c1', true)

    // 停止 / 启动 / 重启
    buttons('停止')[0]!.click()
    await flushPromises()
    expect(wslAPI.containers.stop.mock.calls[0]?.[0]).toBe('c1')
    buttons('启动')[0]!.click()
    await flushPromises()
    expect(wslAPI.containers.start).toHaveBeenCalledWith('c2')
    buttons('重启')[0]!.click()
    await flushPromises()
    expect(wslAPI.containers.restart).toHaveBeenCalledWith('c1')

    // 终端：容器运行中 → 打开并跳转
    wslAPI.terminal.createProfile.mockResolvedValue({
      ptyId: 'ct1',
      distro: 'web',
      shell: '/bin/sh',
      createdAt: 1,
    })
    buttons('终端')[0]!.click()
    await flushPromises()
    expect(routerMock.push).toHaveBeenCalledWith('/terminal')

    // 删除 → 确认
    buttons('删除')[0]!.click()
    await confirmDialog()
    expect(wslAPI.containers.remove).toHaveBeenCalledWith('c1', true)
  })

  it('镜像/网络/卷/系统 Tab：拉取、构建、创建、清理、保存设置、终止会话', async () => {
    await richMount()
    // 镜像
    await clickTab('镜像')
    const pullInput = document.querySelector(
      'input[placeholder="镜像引用，如 nginx:latest"]',
    ) as HTMLInputElement
    expect(pullInput).toBeTruthy()
    pullInput.value = 'alpine:latest'
    pullInput.dispatchEvent(new Event('input', { bubbles: true }))
    await nextTick()
    buttons('拉取')[0]!.click()
    await flushPromises()
    expect(wslAPI.images.pull).toHaveBeenCalledWith('alpine:latest')

    const tagInput = document.querySelector('input[placeholder="镜像 tag"]') as HTMLInputElement
    tagInput.value = 'app:dev'
    tagInput.dispatchEvent(new Event('input', { bubbles: true }))
    const ctxInput = document.querySelector(
      'input[placeholder="Containerfile 所在 Windows 目录"]',
    ) as HTMLInputElement
    ctxInput.value = 'D:\\ctx'
    ctxInput.dispatchEvent(new Event('input', { bubbles: true }))
    await nextTick()
    buttons('构建')[0]!.click()
    await flushPromises()
    expect(wslAPI.images.build.mock.calls[0]?.[0]).toBe('app:dev')
    expect(String(wslAPI.images.build.mock.calls[0]?.[1])).toContain('ctx')
    buttons('清理')[0]!.click()
    await confirmDialog()
    expect(wslAPI.images.prune).toHaveBeenCalled()
    buttons('删除')[0]!.click()
    await confirmDialog()
    expect(wslAPI.images.remove).toHaveBeenCalledWith('nginx:latest')

    // 网络
    await clickTab('网络')
    const netInput = document.querySelector('input[placeholder="网络名"]') as HTMLInputElement
    netInput.value = 'net2'
    netInput.dispatchEvent(new Event('input', { bubbles: true }))
    await nextTick()
    buttons('创建网络')[0]!.click()
    await flushPromises()
    expect(wslAPI.networks.create).toHaveBeenCalledWith({ name: 'net2' })
    buttons('清理')[0]!.click()
    await confirmDialog()
    expect(wslAPI.networks.prune).toHaveBeenCalled()
    buttons('删除')[0]!.click()
    await confirmDialog()
    expect(wslAPI.networks.remove).toHaveBeenCalled()

    // 卷
    await clickTab('卷')
    const volInput = document.querySelector('input[placeholder="卷名"]') as HTMLInputElement
    volInput.value = 'vol2'
    volInput.dispatchEvent(new Event('input', { bubbles: true }))
    await nextTick()
    buttons('创建卷')[0]!.click()
    await flushPromises()
    expect(wslAPI.volumes.create).toHaveBeenCalledWith('vol2')
    buttons('清理')[0]!.click()
    await confirmDialog()
    expect(wslAPI.volumes.prune).toHaveBeenCalled()
    buttons('删除')[0]!.click()
    await confirmDialog()
    expect(wslAPI.volumes.remove).toHaveBeenCalled()

    // 系统
    await clickTab('系统')
    buttons('保存')[0]!.click()
    await flushPromises()
    expect(wslAPI.containers.settingsWrite).toHaveBeenCalled()
    buttons('重置为默认')[0]!.click()
    await confirmDialog()
    expect(wslAPI.containers.settingsReset).toHaveBeenCalled()
    ;(Array.from(visiblePane().querySelectorAll('button')) as HTMLButtonElement[])
      .find((b) => b.textContent?.includes('终止会话'))!
      .click()
    await confirmDialog()
    expect(wslAPI.containers.sessionTerminate).toHaveBeenCalled()
  })
})

describe('ContainersView 运行向导（0.2.0 review 回归）', () => {
  it('Windows 盘符挂载路径正确解析并出现在等价命令中', async () => {
    const w = await mountView()
    const runBtn = w.findAll('button').find((b) => b.text().includes('运行容器'))
    await runBtn!.trigger('click')
    await flushPromises()
    const mounts = Array.from(document.querySelectorAll('textarea')).find(
      (t) => t.placeholder.includes('每行一条') && t.placeholder.includes('nginx'),
    ) as HTMLTextAreaElement | undefined
    expect(mounts).toBeTruthy()
    mounts!.value = 'D:\\www:/usr/share/nginx/html:ro'
    mounts!.dispatchEvent(new Event('input', { bubbles: true }))
    await nextTick()
    await vi.waitFor(() => {
      expect(bodyText()).toContain('D:/www:/usr/share/nginx/html:ro')
    })
  })
})

describe('ContainersView 配方 / 环境变量遮挡 / 资源字段（0.2.0 review）', () => {
  it('保存配方到 containers.jsonc；运行容器使用默认停止超时', async () => {
    const w = await richMount()
    const store = useContainersStore()
    await vi.waitFor(() => expect(store.loading).toBe(false))
    const runBtn = w.findAll('button').find((b) => b.text().includes('运行容器'))
    await runBtn!.trigger('click')
    await flushPromises()
    const inputs = Array.from(document.querySelectorAll('input')) as HTMLInputElement[]
    const idInput = inputs.find((i) => i.placeholder === '配方 id')!
    const labelInput = inputs.find((i) => i.placeholder === '配方名称')!
    idInput.value = 'web'
    idInput.dispatchEvent(new Event('input', { bubbles: true }))
    labelInput.value = 'Web'
    labelInput.dispatchEvent(new Event('input', { bubbles: true }))
    await nextTick()
    const save = Array.from(document.querySelectorAll('button')).find(
      (b) => b.textContent?.trim() === '保存配方',
    ) as HTMLButtonElement
    save.click()
    await flushPromises()
    expect(wslAPI.config.set).toHaveBeenCalledWith(
      'containers',
      expect.objectContaining({ recipes: [expect.objectContaining({ id: 'web', label: 'Web' })] }),
    )
    expect(Array.isArray(store.recipes)).toBe(true)

    buttons('停止')[0]!.click()
    await flushPromises()
    expect(wslAPI.containers.stop).toHaveBeenCalledWith('c1', 10)
  })

  it('inspect 遮挡环境变量值；显示后可查看；原始 JSON 同样遮挡', async () => {
    const w = await richMount()
    wslAPI.containers.inspect.mockResolvedValue({
      id: 'c1',
      name: 'web',
      image: 'nginx',
      state: 'running',
      status: 'Up',
      health: 'healthy',
      ports: [],
      createdAt: '',
      env: { SECRET: 's3cr3t' },
      raw: { ID: 'c1', Config: { Env: ['SECRET=s3cr3t'] } },
    })
    const nameBtn = w.findAll('button').find((b) => b.text() === 'web')!
    await nameBtn.trigger('click')
    await flushPromises()
    expect(bodyText()).toContain('SECRET=••••••')
    expect(bodyText()).not.toContain('SECRET=s3cr3t')
    const toggle = Array.from(document.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('显示值'),
    ) as HTMLButtonElement
    toggle.click()
    await flushPromises()
    expect(bodyText()).toContain('SECRET=s3cr3t')
  })
})

describe('ContainersView 内置网络保护（0.2.0）', () => {
  it('bridge/host/none 的删除按钮禁用', async () => {
    wslAPI.networks.list.mockResolvedValue([
      { id: 'n1', name: 'bridge', driver: 'bridge', internal: false, containers: [] },
      { id: 'n2', name: 'host', driver: 'host', internal: false, containers: [] },
      { id: 'n3', name: 'none', driver: 'null', internal: false, containers: [] },
    ])
    await mountView()
    await flushPromises()
    await clickTab('网络')
    const rows = Array.from(document.querySelectorAll('.table tbody tr')) as HTMLElement[]
    expect(rows).toHaveLength(3)
    for (const row of rows) {
      const btn = Array.from(row.querySelectorAll('button')).find((b) =>
        b.textContent?.includes('删除'),
      ) as HTMLButtonElement
      expect(btn.disabled).toBe(true)
    }
  })
})
