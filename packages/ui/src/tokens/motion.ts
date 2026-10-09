/** 动效令牌 */
export const motion = {
  duration: {
    instant: '80ms',
    fast: '140ms',
    base: '220ms',
    slow: '320ms',
    slower: '480ms',
  },
  easing: {
    standard: 'cubic-bezier(.2, 0, 0, 1)',
    decelerate: 'cubic-bezier(0, 0, 0, 1)',
    accelerate: 'cubic-bezier(.3, 0, 1, 1)',
    spring: 'cubic-bezier(.34, 1.56, .64, 1)',
    emphasized: 'cubic-bezier(.2, 0, 0, 1)',
  },
} as const
