/**
 * 动效令牌 — 唯一事实源在 @wslpilot/shared/tokens
 */
import { MOTION } from '@wslpilot/shared'

export const motion = {
  duration: {
    instant: MOTION['dur-instant'],
    fast: MOTION['dur-fast'],
    base: MOTION['dur-base'],
    slow: MOTION['dur-slow'],
    slower: MOTION['dur-slower'],
  },
  easing: {
    standard: MOTION['ease-standard'],
    decelerate: MOTION['ease-decelerate'],
    accelerate: MOTION['ease-accelerate'],
    spring: MOTION['ease-spring'],
    emphasized: MOTION['ease-emphasized'],
  },
} as const
