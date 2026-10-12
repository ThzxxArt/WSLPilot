import { ref } from 'vue'

/** 全局命令面板开合状态（模块级单例，跨组件共享） */
const open = ref(false)

export function useCommandPalette() {
  function openPalette() {
    open.value = true
  }
  function closePalette() {
    open.value = false
  }
  function togglePalette() {
    open.value = !open.value
  }
  return { open, openPalette, closePalette, togglePalette }
}

/**
 * @internal 仅供测试：重置面板开合状态。
 * 模块级单例必须可逐用例隔离（参照 terminal store 的 __terminalBuffersForTest 风格）。
 */
export function __resetUseCommandPaletteForTest(): void {
  open.value = false
}
