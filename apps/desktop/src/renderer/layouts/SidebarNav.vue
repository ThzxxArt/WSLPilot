<script setup lang="ts">
import { computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { NTooltip } from 'naive-ui'

const props = defineProps<{ collapsed: boolean }>()
const emit = defineEmits<{ 'update:collapsed': [boolean] }>()

const route = useRoute()
const router = useRouter()

const navItems = [
  { name: 'dashboard', title: '驾驶舱', icon: '🛫' },
  { name: 'distros', title: '发行版', icon: '🐧' },
  { name: 'terminal', title: '终端', icon: '⌨️' },
  { name: 'network', title: '网络', icon: '🌐' },
  { name: 'backup', title: '备份迁移', icon: '💾' },
  { name: 'settings', title: '设置', icon: '⚙️' },
]

const activeName = computed(() => route.name as string)

function go(name: string) {
  void router.push({ name })
}

function toggle() {
  emit('update:collapsed', !props.collapsed)
}
</script>

<template>
  <aside class="sidebar" :class="{ collapsed }">
    <nav class="nav">
      <n-tooltip v-for="item in navItems" :key="item.name" placement="right" :disabled="!collapsed">
        <template #trigger>
          <button
            class="nav-item"
            :class="{ active: activeName === item.name }"
            :aria-label="item.title"
            @click="go(item.name)"
          >
            <span class="nav-icon">{{ item.icon }}</span>
            <span v-if="!collapsed" class="nav-title">{{ item.title }}</span>
          </button>
        </template>
        {{ item.title }}
      </n-tooltip>
    </nav>

    <button class="collapse-btn" :aria-label="collapsed ? '展开侧栏' : '折叠侧栏'" @click="toggle">
      <span class="chevron" :class="{ flipped: collapsed }">‹</span>
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

.nav-item {
  display: flex;
  align-items: center;
  gap: 10px;
  height: 40px;
  padding: 0 12px;
  border-radius: 10px;
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
