import { describe, it, expect } from 'vitest'
import { decideClose } from '../../src/main/window/close-policy'

describe('decideClose', () => {
  it('quitting always allows close', () => {
    expect(decideClose('minimizeToTray', true)).toEqual({ action: 'allow', reason: 'quitting' })
    expect(decideClose('quit', true)).toEqual({ action: 'allow', reason: 'quitting' })
  })

  it('minimizeToTray hides window', () => {
    expect(decideClose('minimizeToTray', false)).toEqual({
      action: 'hide',
      reason: 'minimizeToTray',
    })
  })

  it('quit behavior exits app', () => {
    expect(decideClose('quit', false)).toEqual({
      action: 'quit',
      reason: 'closeBehavior:quit',
    })
  })
})
