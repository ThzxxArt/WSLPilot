/** 字体系统 */
export const typography = {
  sans: "'Inter Variable','HarmonyOS Sans SC','PingFang SC','Microsoft YaHei UI',system-ui,sans-serif",
  mono: "'Cascadia Mono','JetBrains Mono','Fira Code',Consolas,monospace",
} as const

/** 字号阶梯（1.25 比例） */
export const textScale = {
  display: { size: '32px', lineHeight: '1.15', weight: 700 },
  h1: { size: '24px', lineHeight: '1.25', weight: 650 },
  h2: { size: '19px', lineHeight: '1.3', weight: 600 },
  h3: { size: '16px', lineHeight: '1.4', weight: 600 },
  body: { size: '14px', lineHeight: '1.55', weight: 400 },
  sm: { size: '13px', lineHeight: '1.5', weight: 400 },
  xs: { size: '12px', lineHeight: '1.45', weight: 500 },
  mono: { size: '13px', lineHeight: '1.6', weight: 400 },
} as const
