import { describe, it, expect } from 'vitest'
import { stateLabel } from '../../src/renderer/composables/state-label'

describe('stateLabel', () => {
  it('translates all WSL states to Chinese', () => {
    expect(stateLabel('Running')).toBe('运行中')
    expect(stateLabel('Stopped')).toBe('已停止')
    expect(stateLabel('Installing')).toBe('安装中')
    expect(stateLabel('Uninstalling')).toBe('卸载中')
    expect(stateLabel('Converting')).toBe('转换中')
    expect(stateLabel('Unknown')).toBe('未知')
  })

  it('falls back to raw / 未知 for unexpected values', () => {
    expect(stateLabel('Weird')).toBe('Weird')
    expect(stateLabel('')).toBe('未知')
  })
})
