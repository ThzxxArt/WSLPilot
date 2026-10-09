import type { GlobalThemeOverrides } from 'naive-ui'
import { semanticLight, accentMaps, typography, radius, type AccentName } from '../tokens'

/**
 * 语义令牌 → Naive UI themeOverrides
 * 始终以亮色主题 + 本 overrides 运行，不引入 darkTheme。
 */
export function buildThemeOverrides(accent: AccentName = 'aurora'): GlobalThemeOverrides {
  const a = accentMaps[accent] ?? accentMaps.aurora
  const s = semanticLight

  return {
    common: {
      primaryColor: a.accent,
      primaryColorHover: a.accentHover,
      // 必须跟随当前强调色（review：此前误用 semantic 的固定靛蓝）
      primaryColorPressed: a.accentHover,
      primaryColorSuppl: a.accent,
      successColor: s.success,
      warningColor: s.warning,
      errorColor: s.danger,
      infoColor: s.info,
      borderRadius: radius.md,
      borderRadiusSmall: radius.sm,
      fontFamily: typography.sans,
      fontSize: '14px',
      textColorBase: s.textPrimary,
      textColor1: s.textPrimary,
      textColor2: s.textSecondary,
      textColor3: s.textTertiary,
      bodyColor: s.bgCanvas,
      cardColor: s.bgSurface,
      modalColor: s.bgElevated,
      popoverColor: s.bgElevated,
      borderColor: s.borderDefault,
      dividerColor: s.borderSubtle,
      hoverColor: s.bgHover,
      pressedColor: a.bgActive,
    },
    Button: {
      fontWeight: '600',
      borderRadiusMedium: '10px',
    },
    Card: {
      borderRadius: radius.lg,
    },
    DataTable: {
      thColor: s.bgSunken,
      tdColorHover: a.bgActive,
    },
  }
}

export const themeOverrides = buildThemeOverrides('aurora')
