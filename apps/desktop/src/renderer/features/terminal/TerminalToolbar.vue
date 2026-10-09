<script setup lang="ts">
import { ref } from 'vue'
import { NButton, NInput, NPopover, NTooltip } from 'naive-ui'

defineProps<{
  canZoom: boolean
  fontSize: number
}>()

const emit = defineEmits<{
  clear: []
  search: [q: string]
  searchNext: []
  searchPrev: []
  copy: []
  export: []
  zoom: [delta: number]
}>()

const query = ref('')
</script>

<template>
  <div class="terminal-toolbar">
    <n-tooltip trigger="hover">
      <template #trigger>
        <n-button size="tiny" secondary @click="emit('clear')"> 清屏 </n-button>
      </template>
      清空当前终端
    </n-tooltip>

    <n-popover trigger="click" placement="bottom-end">
      <template #trigger>
        <n-button size="tiny" secondary> 搜索 </n-button>
      </template>
      <div class="search-box">
        <n-input
          v-model:value="query"
          size="small"
          placeholder="在终端中查找"
          clearable
          @keyup.enter="emit('search', query)"
        />
        <div class="search-row">
          <n-button size="tiny" secondary @click="emit('searchPrev')"> 上一个 </n-button>
          <n-button size="tiny" secondary @click="emit('searchNext')"> 下一个 </n-button>
        </div>
      </div>
    </n-popover>

    <div class="zoom">
      <n-button size="tiny" secondary :disabled="!canZoom" @click="emit('zoom', -1)"> A- </n-button>
      <span class="fs">{{ fontSize }}</span>
      <n-button size="tiny" secondary :disabled="!canZoom" @click="emit('zoom', 1)"> A+ </n-button>
    </div>

    <n-tooltip trigger="hover">
      <template #trigger>
        <n-button size="tiny" secondary @click="emit('copy')"> 复制 </n-button>
      </template>
      复制选中内容
    </n-tooltip>

    <n-tooltip trigger="hover">
      <template #trigger>
        <n-button size="tiny" secondary @click="emit('export')"> 导出 </n-button>
      </template>
      导出当前会话缓冲
    </n-tooltip>
  </div>
</template>

<style scoped>
.terminal-toolbar {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}

.search-box {
  width: 220px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.search-row {
  display: flex;
  gap: 6px;
}

.zoom {
  display: inline-flex;
  align-items: center;
  gap: 2px;
}

.fs {
  min-width: 22px;
  text-align: center;
  font-size: 12px;
  color: var(--color-text-secondary);
  font-variant-numeric: tabular-nums;
}
</style>
