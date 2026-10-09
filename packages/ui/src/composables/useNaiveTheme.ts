import { computed, type Ref } from 'vue'
import type { GlobalThemeOverrides } from 'naive-ui'
import { buildThemeOverrides } from '../naive'
import type { AccentName } from '../tokens'

/** 根据强调色生成 Naive UI themeOverrides（响应式） */
export function useNaiveTheme(accent: Ref<AccentName>) {
  const themeOverrides = computed<GlobalThemeOverrides>(() => buildThemeOverrides(accent.value))
  return { themeOverrides }
}
