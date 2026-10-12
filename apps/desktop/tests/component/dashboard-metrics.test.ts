import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { enableAutoUnmount, mount, flushPromises } from '@vue/test-utils'
import { createWslAPI, configGetImpl, distro, type WslAPIMock } from './support'

enableAutoUnmount(afterEach)

/**
 * DashboardView 指标概览（WP7 组件盲区补测）：
 * 采样成功渲染真实数值 / 采样失败 lastError 可见 / autoRefreshOnStart 决定是否发起轮询。
 */

const message = { success: vi.fn(), warning: vi.fn(), error: vi.fn(), info: vi.fn() }
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

vi.mock('vue-router', () => ({
  useRouter: () => ({ push: vi.fn() }),
  useRoute: () => ({ query: {} }),
}))

let wslAPI: WslAPIMock
;(globalThis as any).window.wslAPI = wslAPI = createWslAPI()

const { createPinia, setActivePinia } = await import('pinia')
const { useSettingsStore } = await import('../../src/renderer/stores/settings')
const { useDistrosStore } = await import('../../src/renderer/stores/distros')
const DashboardView = (await import('../../src/renderer/views/DashboardView.vue')).default

const dashStubs = { InstallDistroModal: true, DistroDetailModal: true }

/** 找到 label 对应的指标卡（MetricCard 根节点 .metric） */
function metricCard(label: string): HTMLElement | null {
  return (
    (Array.from(document.body.querySelectorAll<HTMLElement>('.metric')).find((el) =>
      (el.querySelector('.metric-label')?.textContent ?? '').includes(label),
    ) as HTMLElement | undefined) ?? null
  )
}

function metricValue(label: string): string {
  return metricCard(label)?.querySelector('.metric-value')?.textContent?.trim() ?? ''
}

beforeEach(() => {
  vi.clearAllMocks()
  setActivePinia(createPinia())
  document.body.innerHTML = ''
  wslAPI.config.get.mockImplementation(configGetImpl())
  wslAPI.distros.list.mockResolvedValue([])
  // 关闭数值滚动动画：走应用自身的减弱动效机制，断言真实数值立即可见
  document.documentElement.dataset.reduceMotion = 'true'
})

afterEach(() => {
  delete document.documentElement.dataset.reduceMotion
  vi.restoreAllMocks()
})

describe('DashboardView 指标概览（采样成功/失败/轮询开关）', () => {
  it('采样成功：按 OverviewMetrics 真实形状渲染数值与提示', async () => {
    wslAPI.metrics.sampleOverview.mockResolvedValueOnce({
      runningCount: 3,
      totalCount: 4,
      memUsedKB: 2 * 1024 * 1024,
      memTotalKB: 8 * 1024 * 1024,
      diskUsedKB: 1024 * 1024,
      diskTotalKB: 4 * 1024 * 1024,
      cpuPercent: 37.5,
      sampledAt: '2026-10-12T00:00:00.000Z',
      perDistro: {},
    })
    mount(DashboardView, { attachTo: document.body, global: { stubs: dashStubs } })
    await flushPromises()

    expect(wslAPI.metrics.sampleOverview).toHaveBeenCalledTimes(1)
    expect(metricValue('运行中')).toBe('3')
    expect(metricCard('运行中')!.textContent).toContain('共 4 个发行版')
    expect(metricCard('内存占用')!.textContent).toContain('2.0G / 8.0G')
    expect(metricCard('磁盘占用')!.textContent).toContain('1.0G / 4.0G')
    expect(metricCard('CPU 负载')!.textContent).toContain('37.5%')
  })

  it('采样失败：错误经 metrics.lastError 展示在错误横幅（不静默吞错）', async () => {
    wslAPI.metrics.sampleOverview.mockRejectedValueOnce({
      code: 'TASK_FAILED',
      message: '采样失败：WSL 未响应',
      recoverable: true,
    })
    const w = mount(DashboardView, { attachTo: document.body, global: { stubs: dashStubs } })
    await flushPromises()
    const banner = w.find('.error-banner')
    expect(banner.exists()).toBe(true)
    expect(banner.text()).toContain('采样失败：WSL 未响应')
  })

  it('autoRefreshOnStart=false：不发起采样也不建轮询定时器（review M-2）', async () => {
    useSettingsStore().autoRefreshOnStart = false
    // 列表非空：避开「尚无数据时兜底首刷」路径，验证真正的「不请求」
    useDistrosStore().items = [distro()]
    const intervalSpy = vi.spyOn(window, 'setInterval')
    mount(DashboardView, { attachTo: document.body, global: { stubs: dashStubs } })
    await flushPromises()

    expect(wslAPI.metrics.sampleOverview).not.toHaveBeenCalled()
    expect(intervalSpy).not.toHaveBeenCalled()
  })

  it('autoRefreshOnStart=true：挂载即采样一次并建立轮询定时器', async () => {
    useSettingsStore().autoRefreshOnStart = true
    useDistrosStore().items = [distro()]
    const intervalSpy = vi.spyOn(window, 'setInterval')
    mount(DashboardView, { attachTo: document.body, global: { stubs: dashStubs } })
    await flushPromises()

    expect(wslAPI.metrics.sampleOverview).toHaveBeenCalledTimes(1)
    expect(intervalSpy).toHaveBeenCalled()
  })
})
