/** 语义色彩令牌（浅色主题）— 设计令牌第二层 */
export const semanticLight = {
  // 背景层次
  bgCanvas: '#F7F8FB',
  bgSurface: '#FFFFFF',
  bgElevated: '#FFFFFF',
  bgSunken: '#EFF1F6',
  bgHover: 'rgba(15, 23, 42, 0.04)',
  bgActive: 'rgba(99, 102, 241, 0.10)',

  // 文字
  textPrimary: '#0F172A',
  textSecondary: '#475569',
  textTertiary: '#94A3B8',
  textInverse: '#FFFFFF',
  textLink: '#4F46E5',

  // 边框
  borderSubtle: '#EDEFF4',
  borderDefault: '#E2E5EC',
  borderStrong: '#CBD2DE',

  // 语义状态
  success: '#16A34A',
  warning: '#D97706',
  danger: '#DC2626',
  info: '#0EA5E9',

  // 强调（默认 Aurora）
  accent: '#6366F1',
  accentHover: '#4F46E5',
  accentSoft: 'rgba(99, 102, 241, 0.12)',
} as const

export type SemanticLightKey = keyof typeof semanticLight

/** 强调色主题映射 — 切换强调色时重映射 accent 系列 */
export const accentMaps = {
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

export type AccentName = keyof typeof accentMaps

/** 发行版品牌色 */
export const distroBrandColors = {
  Ubuntu: '#E95420',
  Debian: '#A80030',
  Fedora: '#51A2DA',
  Arch: '#1793D1',
  openSUSE: '#73BA25',
  Kali: '#557C94',
  Alpine: '#0D597F',
} as const
