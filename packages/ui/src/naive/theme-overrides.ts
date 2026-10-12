import type { GlobalThemeOverrides } from 'naive-ui'
import {
  semanticLight,
  accentMaps,
  typography,
  textScale,
  radius,
  shadow,
  type AccentName,
} from '../tokens'

/**
 * 从 hover 档派生更深一档的按压色（令牌无 pressed 档，review 0.1.2 根治 hover 复用）。
 * 纯函数：仅处理 #RRGGBB，非法输入原样返回。
 */
function deepenHex(hex: string, ratio = 0.16): string {
  const m = /^#([0-9a-f]{6})$/i.exec(hex)
  if (!m) return hex
  const n = Number.parseInt(m[1]!, 16)
  const channel = (shift: number) => Math.max(0, Math.round(((n >> shift) & 0xff) * (1 - ratio)))
  return `#${((channel(16) << 16) | (channel(8) << 8) | channel(0)).toString(16).padStart(6, '0')}`
}

/**
 * 语义令牌 → Naive UI themeOverrides
 * 始终以亮色主题 + 本 overrides 运行，不引入 darkTheme。
 */
export function buildThemeOverrides(accent: AccentName = 'aurora'): GlobalThemeOverrides {
  const a = accentMaps[accent] ?? accentMaps.aurora
  const s = semanticLight
  const pressed = deepenHex(a.accentHover)
  const focusShadow = `0 0 0 2px ${a.accentSoft}`

  return {
    common: {
      primaryColor: a.accent,
      primaryColorHover: a.accentHover,
      // 必须跟随当前强调色（review：此前误用 semantic 的固定靛蓝）；
      // 按压档不再复用 hover（review 0.1.2 根治）：从 ACCENT_MAPS hover 派生更深一档
      primaryColorPressed: pressed,
      primaryColorSuppl: a.accent,
      successColor: s.success,
      warningColor: s.warning,
      errorColor: s.danger,
      infoColor: s.info,
      borderRadius: radius.md,
      borderRadiusSmall: radius.sm,
      fontFamily: typography.sans,
      // 字号不再硬编码 14px（review 0.1.2 根治）：引用排版令牌 body 档
      fontSize: textScale.body.size,
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
      // 不再硬编码 10px（review 0.1.2 根治）：控件圆角统一引用半径令牌
      borderRadiusMedium: radius.md,
    },
    Input: {
      borderRadius: radius.md,
      color: s.bgSurface,
      colorFocus: s.bgSurface,
      textColor: s.textPrimary,
      placeholderColor: s.textTertiary,
      caretColor: a.accent,
      border: `1px solid ${s.borderDefault}`,
      borderHover: `1px solid ${s.borderStrong}`,
      borderFocus: `1px solid ${a.accent}`,
      borderError: `1px solid ${s.danger}`,
      boxShadowFocus: focusShadow,
    },
    Select: {
      peers: {
        InternalSelection: {
          borderRadius: radius.md,
          color: s.bgSurface,
          colorActive: s.bgSurface,
          textColor: s.textPrimary,
          placeholderColor: s.textTertiary,
          caretColor: a.accent,
          border: `1px solid ${s.borderDefault}`,
          borderHover: `1px solid ${s.borderStrong}`,
          borderActive: `1px solid ${a.accent}`,
          borderFocus: `1px solid ${a.accent}`,
          boxShadowActive: focusShadow,
          boxShadowFocus: focusShadow,
        },
        InternalSelectMenu: {
          borderRadius: radius.md,
          color: s.bgElevated,
          optionTextColor: s.textPrimary,
          optionTextColorPressed: a.accent,
          optionTextColorActive: a.accent,
          optionCheckColor: a.accent,
          optionColorPending: s.bgHover,
          optionColorActive: a.bgActive,
          optionColorActivePending: a.bgActive,
        },
      },
    },
    Dropdown: {
      borderRadius: radius.md,
      color: s.bgElevated,
      optionTextColor: s.textPrimary,
      optionTextColorHover: a.accent,
      optionTextColorActive: a.accent,
      optionColorHover: s.bgHover,
      optionColorActive: a.bgActive,
      dividerColor: s.borderSubtle,
    },
    Tag: {
      borderRadius: radius.sm,
      color: s.bgSunken,
      textColor: s.textSecondary,
      border: `1px solid ${s.borderDefault}`,
      closeIconColor: s.textTertiary,
      closeIconColorHover: s.textSecondary,
      closeIconColorPressed: s.textPrimary,
    },
    Tooltip: {
      borderRadius: radius.sm,
      color: s.textPrimary,
      textColor: s.textInverse,
    },
    Message: {
      borderRadius: radius.md,
      color: s.bgElevated,
      textColor: s.textPrimary,
      boxShadow: shadow.md,
      iconColorInfo: s.info,
      iconColorSuccess: s.success,
      iconColorWarning: s.warning,
      iconColorError: s.danger,
      closeColorHover: s.bgHover,
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
