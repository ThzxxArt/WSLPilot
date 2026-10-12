<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { NTooltip } from 'naive-ui'

const props = defineProps<{ collapsed: boolean }>()
const emit = defineEmits<{ 'update:collapsed': [boolean] }>()

const route = useRoute()
const router = useRouter()

/** 窄窗口断点：小于该宽度时强制折叠展示（不覆盖用户偏好） */
const NARROW_BREAKPOINT = 960
const narrow = ref(typeof window !== 'undefined' && window.innerWidth < NARROW_BREAKPOINT)

function onResize() {
  narrow.value = window.innerWidth < NARROW_BREAKPOINT
}

onMounted(() => window.addEventListener('resize', onResize))
onUnmounted(() => window.removeEventListener('resize', onResize))

/**
 * 实际折叠态 = 窄屏强制折叠 || 用户偏好折叠；
 * 窗口恢复宽于断点后回到用户偏好（review 0.1.2 根治：窄屏不再撑破布局）。
 */
const effectiveCollapsed = computed(() => props.collapsed || narrow.value)

const navItems = [
  { name: 'dashboard', title: '驾驶舱', icon: '🛫' },
  { name: 'distros', title: '发行版', icon: '🐧' },
  { name: 'terminal', title: '终端', icon: '⌨️' },
  { name: 'network', title: '网络', icon: '🌐' },
  { name: 'backup', title: '备份迁移', icon: '💾' },
  { name: 'devices', title: 'USB 设备', icon: '🔌' },
  { name: 'settings', title: '设置', icon: '⚙️' },
]

const activeName = computed(() => route.name as string)

function go(name: string) {
  void router.push({ name })
}

function toggle() {
  // review 0.1.2 审计修复：窄屏为强制折叠态（不覆盖用户偏好），此时 toggle
  // 既展不开侧栏、还会把用户偏好写反；禁用入口，拉宽后自然恢复可切换。
  if (narrow.value) return
  emit('update:collapsed', !props.collapsed)
}
</script>

<template>
  <aside class="sidebar" :class="{ collapsed: effectiveCollapsed }">
    <nav class="nav">
      <n-tooltip
        v-for="item in navItems"
        :key="item.name"
        placement="right"
        :disabled="!effectiveCollapsed"
      >
        <template #trigger>
          <button
            class="nav-item"
            :class="{ active: activeName === item.name }"
            :aria-label="item.title"
            :aria-current="activeName === item.name ? 'page' : undefined"
            @click="go(item.name)"
          >
            <span class="nav-icon">{{ item.icon }}</span>
            <span v-if="!effectiveCollapsed" class="nav-title">{{ item.title }}</span>
          </button>
        </template>
        {{ item.title }}
      </n-tooltip>
    </nav>

    <button
      class="collapse-btn"
      :disabled="narrow"
      :title="narrow ? '窗口过窄，侧栏自动折叠' : effectiveCollapsed ? '展开侧栏' : '折叠侧栏'"
      :aria-label="effectiveCollapsed ? '展开侧栏' : '折叠侧栏'"
      :aria-expanded="!effectiveCollapsed"
      @click="toggle"
    >
      <span class="chevron" :class="{ flipped: effectiveCollapsed }">‹</span>
    </button>
  </aside>
</template>

<style scoped>
.sidebar {
  width: 232px;
  display: flex;
  flex-direction: column;
  padding: 12px 10px;
  background: var(--color-bg-surface);
  border-right: 1px solid var(--color-border-subtle);
  user-select: none;
  transition: width var(--dur-base) var(--ease-standard);
}

.sidebar.collapsed {
  width: 64px;
}

.nav {
  display: flex;
  flex-direction: column;
  gap: 4px;
  flex: 1;
}

/* review 0.1.2 审计修复：硬编码 10px 与 ui 包 radius-md 令牌（12px）不一致，统一令牌化 */
.nav-item {
  display: flex;
  align-items: center;
  gap: 10px;
  height: 40px;
  padding: 0 12px;
  border-radius: var(--radius-md, 12px);
  color: var(--color-text-secondary);
  font-size: 13.5px;
  font-weight: 500;
  transition:
    background var(--dur-fast) var(--ease-standard),
    color var(--dur-fast) var(--ease-standard);
}

.nav-item:hover {
  background: var(--color-bg-hover);
  color: var(--color-text-primary);
}

.nav-item.active {
  background: var(--color-accent-soft);
  color: var(--color-accent);
  font-weight: 600;
}

.nav-icon {
  font-size: 16px;
  width: 20px;
  text-align: center;
  flex-shrink: 0;
}

.nav-title {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.collapse-btn {
  height: 32px;
  border-radius: 8px;
  color: var(--color-text-tertiary);
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background var(--dur-fast) var(--ease-standard);
}

.collapse-btn:hover {
  background: var(--color-bg-hover);
  color: var(--color-text-primary);
}

/* 窄屏强制折叠：toggle 不可用（review 0.1.2 审计修复） */
.collapse-btn:disabled {
  cursor: not-allowed;
  opacity: 0.55;
}

.collapse-btn:disabled:hover {
  background: none;
  color: var(--color-text-tertiary);
}

.chevron {
  font-size: 18px;
  line-height: 1;
  transition: transform var(--dur-base) var(--ease-standard);
  display: inline-block;
}

.chevron.flipped {
  transform: rotate(180deg);
}
</style>
