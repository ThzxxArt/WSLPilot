import { describe, it, expect, vi, afterEach } from 'vitest'
import { getEnvInfo } from '../src/env'

describe('getEnvInfo', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
  })

  it('reports platform and versions', () => {
    const info = getEnvInfo('1.2.3')
    expect(info.platform).toBe(process.platform)
    expect(info.isWindows).toBe(process.platform === 'win32')
    expect(info.appVersion).toBe('1.2.3')
    expect(info.nodeVersion).toBe(process.versions.node)
  })

  it('isDev true when VITE_DEV_SERVER_URL set', () => {
    vi.stubEnv('VITE_DEV_SERVER_URL', 'http://localhost:5173')
    // NODE_ENV may already be test; both conditions OR together
    const info = getEnvInfo('0.1.0')
    expect(info.isDev).toBe(true)
  })
})
