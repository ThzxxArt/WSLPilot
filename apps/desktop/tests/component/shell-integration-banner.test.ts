import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import { NButton } from 'naive-ui'
import ShellIntegrationBanner from '../../src/renderer/features/terminal/ShellIntegrationBanner.vue'

const base = {
  distro: 'Ubuntu',
  shell: 'bash' as const,
  supported: true,
  version: '1',
  expectedVersion: '1',
  path: '/home/me/.wslpilot/shell-integration',
  files: { bashrc: true, zshrc: true },
}

describe('ShellIntegrationBanner（0.2.0）', () => {
  it('status 为空 / 已安装时不渲染', () => {
    expect(
      mount(ShellIntegrationBanner, { props: { status: null } })
        .find('.shell-banner')
        .exists(),
    ).toBe(false)
    expect(
      mount(ShellIntegrationBanner, {
        props: { status: { ...base, state: 'installed' } },
      })
        .find('.shell-banner')
        .exists(),
    ).toBe(false)
  })

  it('unsupported：说明支持范围且不给安装按钮', () => {
    const w = mount(ShellIntegrationBanner, {
      props: {
        status: { ...base, shell: 'fish', supported: false, state: 'unsupported' },
      },
    })
    expect(w.text()).toContain('暂不支持 Shell 集成')
    expect(w.text()).toContain('支持 bash / zsh')
    expect(w.findAllComponents(NButton)).toHaveLength(0)
  })

  it('missing：安装按钮触发 install；关闭触发 dismiss', async () => {
    const w = mount(ShellIntegrationBanner, {
      props: { status: { ...base, state: 'missing', files: { bashrc: false, zshrc: false } } },
    })
    expect(w.text()).toContain('Shell 集成未安装')
    await w
      .findAll('button')
      .find((b) => b.text().includes('安装 Shell 集成'))!
      .trigger('click')
    expect(w.emitted('install')).toHaveLength(1)
    await w.find('.banner-close').trigger('click')
    expect(w.emitted('dismiss')).toHaveLength(1)
  })

  it('partial：显示修复 + 移除，并透传 busy', async () => {
    const w = mount(ShellIntegrationBanner, {
      props: {
        status: { ...base, state: 'partial', version: '0', files: { bashrc: true, zshrc: false } },
        busy: true,
      },
    })
    expect(w.text()).toContain('修复 Shell 集成')
    const repair = w.findAll('button').find((b) => b.text().includes('修复 Shell 集成'))!
    expect(repair.exists()).toBe(true)
  })
})
