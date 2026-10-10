<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useMessage } from 'naive-ui'
import { Kbd } from '@ui/components'
import { useDistrosStore } from '../../stores/distros'
import { useActionsStore } from '../../stores/actions'
import { useSettingsStore } from '../../stores/settings'
import { useTerminalStore } from '../../stores/terminal'
import { useCommandPalette } from '../../composables/useCommandPalette'
import { errorLine } from '../../composables/useAppError'
import {
  filterPaletteItems,
  groupPaletteItems,
  pushRecentId,
  recentPaletteItems,
  type PaletteItem,
} from './palette'
import { stateLabel } from '../../composables/state-label'

const router = useRouter()
const distros = useDistrosStore()
const actions = useActionsStore()
const settings = useSettingsStore()
const terminal = useTerminalStore()
const message = useMessage()
const { open, closePalette } = useCommandPalette()

const query = ref('')
const activeIndex = ref(0)
const inputEl = ref<HTMLInputElement | null>(null)
const recentIds = ref<string[]>([])
/** 打开前的焦点元素：关闭后归还焦点（无障碍 §11.4） */
const lastFocused = ref<HTMLElement | null>(null)

/** 当前动作目标发行版：上次选中 → 默认 → 第一个 */
function targetDistro(): string | null {
  return distros.defaultDistro?.name ?? distros.items[0]?.name ?? null
}

function navItem(
  id: string,
  label: string,
  path: string,
  hint?: string,
  query2?: Record<string, string>,
  icon = '🧭',
): PaletteItem {
  return {
    id,
    group: '导航',
    label: `前往：${label}`,
    hint,
    icon,
    run: () => router.push(query2 ? { path, query: query2 } : path),
  }
}

function settingsItem(id: string, label: string, run: () => unknown, hint?: string): PaletteItem {
  return {
    id,
    group: '设置',
    label: `设置：${label}`,
    hint,
    icon: '⚙️',
    keywords: 'shezhi config',
    run,
  }
}

function buildItems(): PaletteItem[] {
  const items: PaletteItem[] = []

  // ── 动作 ──
  const target = targetDistro()
  for (const a of actions.items) {
    items.push({
      id: `action:${a.id}`,
      group: '动作',
      label: `运行动作：${a.label}`,
      hint: a.description || (a.terminal ? '终端中运行' : a.id),
      icon: '⚡',
      keywords: `${a.id} action`,
      run: async () => {
        if (a.confirm) {
          const ok = window.confirm(`执行动作「${a.label}」？（确认后运行）`)
          if (!ok) return
        }
        const handle = await actions.run(
          a.id,
          a.scope === 'global' ? undefined : (target ?? undefined),
        )
        message.success(handle.ptyId ? `已在终端中运行「${a.label}」` : `已开始执行「${a.label}」`)
      },
    })
  }
  items.push({
    id: 'new-terminal',
    group: '动作',
    label: '新建终端标签',
    hint: '为默认发行版开会话',
    icon: '⌨️',
    keys: ['Ctrl', 'N'],
    run: async () => {
      const name = targetDistro()
      if (!name) {
        message.warning('没有可用的发行版')
        return
      }
      const id = await terminal.open(name)
      if (!id) {
        message.error(errorLine(terminal.lastError, '新建终端失败'))
        return
      }
      await router.push('/terminal')
    },
  })
  items.push(
    settingsItem('open-config-dir', '打开配置目录', () => window.wslAPI.app.openConfigDir()),
  )
  items.push({
    id: 'toggle-raw-command',
    group: '动作',
    label: settings.showRawCommand ? '隐藏等价命令行' : '显示等价命令行',
    hint: 'advanced.showRawCommand',
    icon: '👁',
    keys: ['Ctrl', 'Shift', 'P'],
    run: () => settings.setShowRawCommand(!settings.showRawCommand),
  })
  items.push({
    id: 'shutdown-all',
    group: '动作',
    label: '全部关机',
    hint: 'wsl --shutdown',
    icon: '🔌',
    run: async () => {
      await distros.shutdownAll()
      message.success('已关闭全部发行版')
    },
  })

  // ── 发行版 ──
  for (const d of distros.items) {
    const display = d.meta?.alias ? `${d.meta.alias}（${d.name}）` : d.name
    items.push({
      id: `term:${d.name}`,
      group: '发行版',
      label: `打开终端：${display}`,
      hint: `WSL${d.version} · ${stateLabel(d.state)}`,
      icon: '⌨️',
      keywords: 'terminal zhongduan',
      run: () => router.push({ path: '/terminal', query: { distro: d.name } }),
    })
    items.push({
      id: `detail:${d.name}`,
      group: '发行版',
      label: `查看发行版：${display}`,
      hint: '配置 / 动作 / 文件',
      icon: '🐧',
      run: () => router.push({ path: '/distros', query: { focus: d.name } }),
    })
    if (d.state !== 'Running') {
      items.push({
        id: `start:${d.name}`,
        group: '发行版',
        label: `启动：${display}`,
        icon: '▶️',
        run: async () => {
          await distros.start(d.name)
          message.success(`已启动 ${d.name}`)
        },
      })
    } else {
      items.push({
        id: `stop:${d.name}`,
        group: '发行版',
        label: `停止：${display}`,
        icon: '⏹️',
        run: async () => {
          await distros.terminate(d.name)
          message.success(`已停止 ${d.name}`)
        },
      })
    }
    if (!d.isDefault) {
      items.push({
        id: `default:${d.name}`,
        group: '发行版',
        label: `设为默认：${display}`,
        icon: '⭐',
        run: async () => {
          await distros.setDefault(d.name)
          message.success(`已设 ${d.name} 为默认`)
        },
      })
    }
  }

  // ── 导航 ──
  items.push(navItem('nav-dashboard', '驾驶舱', '/dashboard', '全局概览', undefined, '🛫'))
  items.push(navItem('nav-distros', '发行版', '/distros', '列表与操作', undefined, '🐧'))
  items.push(navItem('nav-terminal', '终端', '/terminal', '多标签工作区', undefined, '🖥️'))
  items.push(navItem('nav-network', '网络', '/network', '端口转发 / 镜像 / 代理', undefined, '🌐'))
  items.push(navItem('nav-backup', '备份与迁移', '/backup', undefined, undefined, '💾'))
  items.push(navItem('nav-devices', 'USB 设备', '/devices', 'usbipd 绑定管理', undefined, '🔌'))
  items.push(navItem('nav-settings', '设置', '/settings', undefined, undefined, '⚙️'))

  // ── 设置 ──
  items.push(settingsItem('goto-settings', '打开设置页', () => router.push('/settings')))
  items.push(
    settingsItem('toggle-reduce-motion', settings.reduceMotion ? '恢复动效' : '减弱动效', () =>
      settings.setReduceMotion(!settings.reduceMotion),
    ),
  )
  items.push(
    settingsItem(
      'toggle-confirm-destructive',
      settings.confirmDestructive ? '关闭破坏性确认' : '开启破坏性确认',
      () => settings.setConfirmDestructive(!settings.confirmDestructive),
    ),
  )
  for (const [key, label] of [
    ['settings', '打开 settings.jsonc'],
    ['distros', '打开 distros.jsonc'],
    ['actions', '打开 actions.jsonc'],
    ['network', '打开 network.jsonc'],
  ] as const) {
    items.push(
      settingsItem(`open-file:${key}`, label, () => window.wslAPI.config.openExternal(key)),
    )
  }

  return items
}

const allItems = computed<PaletteItem[]>(() => buildItems())

const filtered = computed(() => filterPaletteItems(allItems.value, query.value))
const grouped = computed(() => groupPaletteItems(filtered.value))
const flat = computed<PaletteItem[]>(() => filtered.value)
const recents = computed(() =>
  query.value.trim() === '' ? recentPaletteItems(allItems.value, recentIds.value) : [],
)

/** 当前高亮项的 DOM id（aria-activedescendant，供屏幕阅读器跟随） */
const activeDescendant = computed(() => {
  const item = flat.value[activeIndex.value]
  return item ? `palette-item-${item.id}` : undefined
})

watch(
  () => open.value,
  async (isOpen) => {
    if (isOpen) {
      lastFocused.value =
        (document.activeElement as HTMLElement | null) ?? (document.body as HTMLElement)
      query.value = ''
      activeIndex.value = 0
      if (distros.items.length === 0) void distros.refresh()
      if (!actions.loaded) void actions.load()
      await loadRecent()
      await nextTick()
      inputEl.value?.focus()
    } else {
      // 归还焦点到打开前的元素（无障碍：模态关闭后焦点不得丢失）
      await nextTick()
      lastFocused.value?.focus?.()
      lastFocused.value = null
    }
  },
)

watch(query, () => {
  activeIndex.value = 0
})

async function loadRecent() {
  try {
    const ui = await window.wslAPI.config.get('uiState')
    recentIds.value = Array.isArray(ui.recentCommands) ? ui.recentCommands : []
  } catch {
    recentIds.value = []
  }
}

async function persistRecent(id: string) {
  recentIds.value = pushRecentId(recentIds.value, id)
  try {
    await window.wslAPI.config.set('uiState', { recentCommands: recentIds.value })
  } catch {
    /* 最近使用持久化失败不阻断执行 */
  }
}

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape') {
    e.preventDefault()
    closePalette()
  } else if (e.key === 'Tab') {
    // 焦点陷阱（aria-modal 的语义义务）：Tab/Shift+Tab 循环限制在面板内
    e.preventDefault()
    const root = e.currentTarget as HTMLElement | null
    if (!root) return
    const focusables = [
      ...root.querySelectorAll<HTMLElement>(
        'input, button, [href], [tabindex]:not([tabindex="-1"])',
      ),
    ].filter((el) => !el.hasAttribute('disabled'))
    if (focusables.length === 0) return
    const current = document.activeElement as HTMLElement | null
    const idx = current ? focusables.indexOf(current) : -1
    const next = e.shiftKey
      ? idx <= 0
        ? focusables.length - 1
        : idx - 1
      : idx >= focusables.length - 1
        ? 0
        : idx + 1
    focusables[next]?.focus()
  } else if (e.key === 'ArrowDown') {
    e.preventDefault()
    activeIndex.value =
      flat.value.length === 0 ? 0 : Math.min(activeIndex.value + 1, flat.value.length - 1)
  } else if (e.key === 'ArrowUp') {
    e.preventDefault()
    activeIndex.value = Math.max(activeIndex.value - 1, 0)
  } else if (e.key === 'Enter') {
    e.preventDefault()
    void execute(flat.value[activeIndex.value])
  }
}

async function execute(cmd: PaletteItem | undefined) {
  if (!cmd) return
  closePalette()
  void persistRecent(cmd.id)
  try {
    await cmd.run()
  } catch (e) {
    message.error(errorLine(e, `执行失败：${cmd.label}`))
  }
}

onMounted(() => {
  if (distros.items.length === 0) void distros.refresh()
  if (!actions.loaded) void actions.load()
})
</script>

<template>
  <Teleport to="body">
    <div v-if="open" class="palette-mask" @click.self="closePalette">
      <div
        class="palette palette-pop"
        role="dialog"
        aria-modal="true"
        aria-label="命令面板"
        @keydown="onKeydown"
      >
        <input
          ref="inputEl"
          v-model="query"
          class="palette-input"
          type="text"
          role="combobox"
          aria-expanded="true"
          aria-controls="palette-results"
          :aria-activedescendant="activeDescendant"
          placeholder="搜索命令、发行版、动作、设置…（> 命令 · @ 发行版 · # 设置）"
          aria-label="命令面板搜索"
        />
        <div id="palette-results" class="palette-list" role="listbox" aria-label="命令结果">
          <template v-if="recents.length">
            <div class="palette-group" role="presentation">最近使用</div>
            <button
              v-for="cmd in recents"
              :id="`palette-item-recent-${cmd.id}`"
              :key="`recent-${cmd.id}`"
              class="palette-item"
              role="option"
              :aria-selected="false"
              @click="execute(cmd)"
            >
              <span class="palette-label">
                <span v-if="cmd.icon" class="palette-icon" aria-hidden="true">{{ cmd.icon }}</span>
                {{ cmd.label }}
              </span>
              <span v-if="cmd.hint" class="palette-hint">{{ cmd.hint }}</span>
            </button>
            <div class="palette-divider" role="presentation" />
          </template>

          <template v-for="g in grouped" :key="g.group">
            <div class="palette-group" role="presentation">{{ g.group }}</div>
            <button
              v-for="cmd in g.items"
              :id="`palette-item-${cmd.id}`"
              :key="cmd.id"
              class="palette-item"
              role="option"
              :aria-selected="flat[activeIndex]?.id === cmd.id"
              :class="{ active: flat[activeIndex]?.id === cmd.id }"
              @mousemove="activeIndex = flat.findIndex((c) => c.id === cmd.id)"
              @click="execute(cmd)"
            >
              <span class="palette-label">
                <span v-if="cmd.icon" class="palette-icon" aria-hidden="true">{{ cmd.icon }}</span>
                {{ cmd.label }}
              </span>
              <span class="palette-right">
                <span v-if="cmd.hint" class="palette-hint">{{ cmd.hint }}</span>
                <Kbd v-if="cmd.keys" :keys="cmd.keys" />
              </span>
            </button>
          </template>

          <div v-if="flat.length === 0" class="palette-empty" role="status" aria-live="polite">
            没有匹配的命令 · 试试 <code>&gt; </code> 动作 / <code>@ </code> 发行版 /
            <code># </code> 设置
          </div>
        </div>
        <div class="palette-foot">
          <span><Kbd :keys="['↑', '↓']" /> 选择</span>
          <span><Kbd :keys="['Enter']" /> 执行</span>
          <span><Kbd :keys="['Esc']" /> 关闭</span>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.palette-mask {
  position: fixed;
  inset: 0;
  z-index: 1600;
  background: rgba(15, 23, 42, 0.28);
  backdrop-filter: blur(6px);
  display: flex;
  justify-content: center;
  padding-top: 12vh;
}

.palette {
  width: min(600px, 92vw);
  max-height: 64vh;
  display: flex;
  flex-direction: column;
  background: var(--glass-bg, var(--color-bg-elevated));
  backdrop-filter: blur(20px);
  border: 1px solid var(--color-border-default);
  border-radius: 14px;
  box-shadow: 0 24px 64px rgba(15, 23, 42, 0.22);
  overflow: hidden;
}

.palette-input {
  height: 48px;
  padding: 0 16px;
  font-size: 15px;
  border: none;
  border-bottom: 1px solid var(--color-border-subtle);
  outline: none;
  background: transparent;
  color: var(--color-text-primary);
}

.palette-input::placeholder {
  color: var(--color-text-tertiary);
}

.palette-list {
  overflow-y: auto;
  padding: 8px;
  flex: 1;
}

.palette-group {
  padding: 8px 10px 4px;
  font-size: 11px;
  font-weight: 650;
  color: var(--color-text-tertiary);
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.palette-divider {
  height: 1px;
  margin: 6px 10px;
  background: var(--color-border-subtle);
}

.palette-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  width: 100%;
  padding: 9px 12px;
  border-radius: 9px;
  font-size: 13.5px;
  color: var(--color-text-primary);
  text-align: left;
}

.palette-item.active {
  background: var(--color-accent-soft);
  color: var(--color-accent);
}

.palette-label {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  display: inline-flex;
  align-items: center;
  gap: 8px;
}

.palette-icon {
  flex-shrink: 0;
  font-size: 13px;
}

.palette-right {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}

.palette-hint {
  font-size: 11px;
  color: var(--color-text-tertiary);
}

.palette-empty {
  padding: 24px 12px;
  text-align: center;
  color: var(--color-text-tertiary);
  font-size: 12.5px;
}

.palette-foot {
  display: flex;
  gap: 16px;
  padding: 8px 14px;
  border-top: 1px solid var(--color-border-subtle);
  font-size: 11px;
  color: var(--color-text-tertiary);
}

.palette-foot span {
  display: inline-flex;
  align-items: center;
  gap: 5px;
}
</style>
