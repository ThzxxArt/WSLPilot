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

/** Ctrl/⌘ + K 全局快捷键（设计书 §11.5 / §13.3） */
export function bindCommandPaletteHotkey(): () => void {
  const { togglePalette } = useCommandPalette()
  const onKey = (e: KeyboardEvent) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
      e.preventDefault()
      togglePalette()
    }
  }
  window.addEventListener('keydown', onKey)
  return () => window.removeEventListener('keydown', onKey)
}
