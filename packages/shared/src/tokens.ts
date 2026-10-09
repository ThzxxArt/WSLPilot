/**
 * 设计令牌 · 唯一事实源（TypeScript 侧）
 * - packages/ui 消费（Naive theme、CSS 变量）
 * - scripts/gen-tokens.ts 消费（生成 SCSS/CSS）
 * - apps/desktop 消费（强调色渐变）
 * 禁止在其他位置手写色值。
 */

/** 原始渐变 */
export const PRIMITIVE_GRADIENTS = {
  aurora: 'linear-gradient(135deg, #22D3EE 0%, #6366F1 50%, #A855F7 100%)',
  sunset: 'linear-gradient(135deg, #FB7185 0%, #F59E0B 100%)',
  ocean: 'linear-gradient(135deg, #38BDF8 0%, #0EA5E9 50%, #2563EB 100%)',
  forest: 'linear-gradient(135deg, #34D399 0%, #10B981 50%, #059669 100%)',
  custom: 'linear-gradient(135deg, #22D3EE 0%, #6366F1 50%, #A855F7 100%)',
} as const

export type AccentName = keyof typeof PRIMITIVE_GRADIENTS

/** 语义色（浅色主题） */
export const SEMANTIC_LIGHT = {
  bgCanvas: '#F7F8FB',
  bgSurface: '#FFFFFF',
  bgElevated: '#FFFFFF',
  bgSunken: '#EFF1F6',
  bgHover: 'rgba(15, 23, 42, 0.04)',
  bgActive: 'rgba(99, 102, 241, 0.10)',

  textPrimary: '#0F172A',
  textSecondary: '#475569',
  textTertiary: '#94A3B8',
  textInverse: '#FFFFFF',
  textLink: '#4F46E5',

  borderSubtle: '#EDEFF4',
  borderDefault: '#E2E5EC',
  borderStrong: '#CBD2DE',

  success: '#16A34A',
  warning: '#D97706',
  danger: '#DC2626',
  info: '#0EA5E9',

  accent: '#6366F1',
  accentHover: '#4F46E5',
  accentSoft: 'rgba(99, 102, 241, 0.12)',
} as const

/** 强调色 → accent 系列重映射 */
export const ACCENT_MAPS = {
  aurora: {
    accent: '#6366F1',
    accentHover: '#4F46E5',
    accentSoft: 'rgba(99, 102, 241, 0.12)',
    bgActive: 'rgba(99, 102, 241, 0.10)',
  },
  sunset: {
    accent: '#F59E0B',
    accentHover: '#D97706',
    accentSoft: 'rgba(245, 158, 11, 0.12)',
    bgActive: 'rgba(245, 158, 11, 0.10)',
  },
  ocean: {
    accent: '#0EA5E9',
    accentHover: '#0284C7',
    accentSoft: 'rgba(14, 165, 233, 0.12)',
    bgActive: 'rgba(14, 165, 233, 0.10)',
  },
  forest: {
    accent: '#10B981',
    accentHover: '#059669',
    accentSoft: 'rgba(16, 185, 129, 0.12)',
    bgActive: 'rgba(16, 185, 129, 0.10)',
  },
  custom: {
    accent: '#6366F1',
    accentHover: '#4F46E5',
    accentSoft: 'rgba(99, 102, 241, 0.12)',
    bgActive: 'rgba(99, 102, 241, 0.10)',
  },
} as const

/** 发行版品牌色 */
export const DISTRO_BRAND_COLORS: Record<string, string> = {
  Ubuntu: '#E95420',
  Debian: '#A80030',
  Fedora: '#51A2DA',
  Arch: '#1793D1',
  openSUSE: '#73BA25',
  Kali: '#557C94',
  Alpine: '#0D597F',
}

/** 间距 / 圆角 / 阴影 / 层级 / 动效 — 与 gen-tokens 输出保持一致 */
export const SPACING = {
  'space-1': '4px',
  'space-2': '8px',
  'space-3': '12px',
  'space-4': '16px',
  'space-5': '20px',
  'space-6': '24px',
  'space-8': '32px',
  'space-10': '40px',
  'space-16': '64px',
} as const

export const RADIUS = {
  'radius-xs': '6px',
  'radius-sm': '8px',
  'radius-md': '12px',
  'radius-lg': '16px',
  'radius-xl': '20px',
  'radius-full': '9999px',
} as const

export const SHADOW = {
  'shadow-xs': '0 1px 2px rgba(15,23,42,.06)',
  'shadow-sm': '0 2px 6px rgba(15,23,42,.08)',
  'shadow-md': '0 6px 16px -4px rgba(15,23,42,.12), 0 2px 6px -2px rgba(15,23,42,.08)',
  'shadow-lg': '0 16px 40px -12px rgba(15,23,42,.22)',
  'shadow-glow': '0 0 0 1px var(--color-border-default), 0 8px 32px -8px var(--color-accent-soft)',
} as const

export const Z_INDEX = {
  'z-base': '0',
  'z-dropdown': '1000',
  'z-sticky': '1100',
  'z-drawer': '1200',
  'z-modal': '1300',
  'z-toast': '1400',
  'z-tooltip': '1500',
  'z-command': '1600',
} as const

export const MOTION = {
  'dur-instant': '80ms',
  'dur-fast': '140ms',
  'dur-base': '220ms',
  'dur-slow': '320ms',
  'dur-slower': '480ms',
  'ease-standard': 'cubic-bezier(.2, 0, 0, 1)',
  'ease-decelerate': 'cubic-bezier(0, 0, 0, 1)',
  'ease-accelerate': 'cubic-bezier(.3, 0, 1, 1)',
  'ease-spring': 'cubic-bezier(.34, 1.56, .64, 1)',
  'ease-emphasized': 'cubic-bezier(.2, 0, 0, 1)',
} as const

export const TYPOGRAPHY = {
  'font-sans':
    "'Inter Variable','HarmonyOS Sans SC','PingFang SC','Microsoft YaHei UI',system-ui,sans-serif",
  'font-mono': "'Cascadia Mono','JetBrains Mono','Fira Code',Consolas,monospace",
} as const

/** 语义色 → CSS 变量名映射（gen-tokens 使用） */
export const SEMANTIC_TO_CSS = {
  bgCanvas: 'color-bg-canvas',
  bgSurface: 'color-bg-surface',
  bgElevated: 'color-bg-elevated',
  bgSunken: 'color-bg-sunken',
  bgHover: 'color-bg-hover',
  bgActive: 'color-bg-active',
  textPrimary: 'color-text-primary',
  textSecondary: 'color-text-secondary',
  textTertiary: 'color-text-tertiary',
  textInverse: 'color-text-inverse',
  textLink: 'color-text-link',
  borderSubtle: 'color-border-subtle',
  borderDefault: 'color-border-default',
  borderStrong: 'color-border-strong',
  success: 'color-success',
  warning: 'color-warning',
  danger: 'color-danger',
  info: 'color-info',
  accent: 'color-accent',
  accentHover: 'color-accent-hover',
  accentSoft: 'color-accent-soft',
} as const
