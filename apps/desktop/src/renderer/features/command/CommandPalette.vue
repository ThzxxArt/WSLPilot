<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useMessage } from 'naive-ui'
import { useDistrosStore } from '../../stores/distros'
import { useCommandPalette } from '../../composables/useCommandPalette'
import { errorLine } from '../../composables/useAppError'

interface Command {
  id: string
  group: string
  label: string
  hint?: string
  run: () => unknown
}

const router = useRouter()
const distros = useDistrosStore()
const message = useMessage()
const { open, closePalette } = useCommandPalette()

const query = ref('')
const activeIndex = ref(0)
const inputEl = ref<HTMLInputElement | null>(null)

const NAV: Command[] = [
  {
    id: 'nav-dashboard',
    group: '导航',
    label: '驾驶舱',
    hint: '全局概览',
    run: () => router.push('/dashboard'),
  },
  {
    id: 'nav-distros',
    group: '导航',
    label: '发行版',
    hint: '列表与操作',
    run: () => router.push('/distros'),
  },
  {
    id: 'nav-terminal',
    group: '导航',
    label: '终端',
    hint: '多标签工作区',
    run: () => router.push('/terminal'),
  },
  { id: 'nav-network', group: '导航', label: '网络', run: () => router.push('/network') },
  { id: 'nav-backup', group: '导航', label: '备份与迁移', run: () => router.push('/backup') },
  { id: 'nav-settings', group: '导航', label: '设置', run: () => router.push('/settings') },
]

const ACTIONS: Command[] = [
  {
    id: 'act-shutdown',
    group: '动作',
    label: '全部关机',
    hint: 'wsl --shutdown',
    run: async () => {
      await distros.shutdownAll()
    },
  },
  {
    id: 'act-refresh',
    group: '动作',
    label: '刷新发行版列表',
    run: () => distros.refresh(),
  },
  {
    id: 'act-config-dir',
    group: '动作',
    label: '打开配置目录',
    run: () => window.wslAPI.app.openConfigDir(),
  },
]

const commands = computed<Command[]>(() => {
  const items: Command[] = [...NAV, ...ACTIONS]
  for (const d of distros.items) {
    const display = d.meta?.alias ? `${d.meta.alias}（${d.name}）` : d.name
    items.push({
      id: `term-${d.name}`,
      group: '发行版',
      label: `打开终端：${display}`,
      hint: `WSL${d.version}`,
      run: () => router.push({ path: '/terminal', query: { distro: d.name } }),
    })
    items.push({
      id: `view-${d.name}`,
      group: '发行版',
      label: `查看发行版：${display}`,
      run: () => router.push({ path: '/distros', query: { focus: d.name } }),
    })
  }
  return items
})

const filtered = computed<Command[]>(() => {
  const q = query.value.trim().toLowerCase()
  if (!q) return commands.value
  return commands.value.filter(
    (c) => c.label.toLowerCase().includes(q) || (c.hint ?? '').toLowerCase().includes(q),
  )
})

const grouped = computed(() => {
  const map = new Map<string, Command[]>()
  for (const c of filtered.value) {
    const list = map.get(c.group) ?? []
    list.push(c)
    map.set(c.group, list)
  }
  return [...map.entries()].map(([group, list]) => ({ group, list }))
})

const flat = computed<Command[]>(() => grouped.value.flatMap((g) => g.list))

watch(
  () => open.value,
  async (isOpen) => {
    if (isOpen) {
      query.value = ''
      activeIndex.value = 0
      if (distros.items.length === 0) void distros.refresh()
      await nextTick()
      inputEl.value?.focus()
    }
  },
)

watch(query, () => {
  activeIndex.value = 0
})

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape') {
    e.preventDefault()
    closePalette()
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

async function execute(cmd: Command | undefined) {
  if (!cmd) return
  closePalette()
  try {
    await cmd.run()
  } catch (e) {
    // 执行失败必须有反馈，禁止静默（核验修复）
    message.error(errorLine(e, `执行失败：${cmd.label}`))
  }
}

onMounted(() => {
  if (distros.items.length === 0) void distros.refresh()
})
</script>

<template>
  <Teleport to="body">
    <div v-if="open" class="palette-mask" @click.self="closePalette">
      <div class="palette" role="dialog" aria-label="命令面板" @keydown="onKeydown">
        <input
          ref="inputEl"
          v-model="query"
          class="palette-input"
          type="text"
          placeholder="搜索命令、发行版…（↑↓ 选择 · Enter 执行 · Esc 关闭）"
          aria-label="命令面板搜索"
        />
        <div class="palette-list">
          <template v-for="g in grouped" :key="g.group">
            <div class="palette-group">
              {{ g.group }}
            </div>
            <button
              v-for="cmd in g.list"
              :key="cmd.id"
              class="palette-item"
              :class="{ active: flat[activeIndex]?.id === cmd.id }"
              @mousemove="activeIndex = flat.findIndex((c) => c.id === cmd.id)"
              @click="execute(cmd)"
            >
              <span class="palette-label">{{ cmd.label }}</span>
              <span v-if="cmd.hint" class="palette-hint">{{ cmd.hint }}</span>
            </button>
          </template>
          <div v-if="flat.length === 0" class="palette-empty">没有匹配的命令</div>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.palette-mask {
  position: fixed;
  inset: 0;
  z-index: 1000;
  background: rgba(15, 23, 42, 0.28);
  backdrop-filter: blur(6px);
  display: flex;
  justify-content: center;
  padding-top: 14vh;
}

.palette {
  width: min(560px, 92vw);
  max-height: 60vh;
  display: flex;
  flex-direction: column;
  background: var(--color-bg-elevated);
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
}

.palette-group {
  padding: 8px 10px 4px;
  font-size: 11px;
  font-weight: 650;
  color: var(--color-text-tertiary);
  text-transform: uppercase;
  letter-spacing: 0.04em;
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
}

.palette-hint {
  flex-shrink: 0;
  font-size: 11px;
  color: var(--color-text-tertiary);
}

.palette-empty {
  padding: 24px 12px;
  text-align: center;
  color: var(--color-text-tertiary);
  font-size: 13px;
}
</style>
