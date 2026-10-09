/** 原始色板 / 渐变 — 设计令牌第一层 */
export const primitiveColors = {
  gradientAurora: 'linear-gradient(135deg, #22D3EE 0%, #6366F1 50%, #A855F7 100%)',
  gradientSunset: 'linear-gradient(135deg, #FB7185 0%, #F59E0B 100%)',
  gradientOcean: 'linear-gradient(135deg, #38BDF8 0%, #0EA5E9 50%, #2563EB 100%)',
  gradientForest: 'linear-gradient(135deg, #34D399 0%, #10B981 50%, #059669 100%)',
} as const

export type PrimitiveColorKey = keyof typeof primitiveColors
