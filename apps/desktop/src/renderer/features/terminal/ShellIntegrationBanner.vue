<script setup lang="ts">
import { computed } from 'vue'
import { NButton } from 'naive-ui'
import type { ShellIntegrationStatus } from '@wslpilot/shared'

/**
 * Shell 集成横幅（0.2.0）：只在设置开启、且未安装/版本不匹配时出现。
 * 不自动修改用户 rc —— 安装写入固定目录 `~/.wslpilot/shell-integration/`，可一键移除。
 */
const props = defineProps<{
  status: ShellIntegrationStatus | null
  busy?: boolean
}>()

const emit = defineEmits<{
  install: []
  remove: []
  dismiss: []
}>()

const visibility = computed(() => {
  if (!props.status) return null
  if (props.status.state === 'installed') return null
  if (props.status.state === 'unsupported') return 'unsupported'
  return props.status.state
})
</script>

<template>
  <div v-if="visibility" class="shell-banner" role="status">
    <span class="shell-icon" aria-hidden="true">⌘</span>
    <div class="shell-text">
      <template v-if="visibility === 'unsupported'">
        当前 shell（{{ status?.shell }}）暂不支持 Shell 集成；支持 bash / zsh。
      </template>
      <template v-else>
        <strong>Shell 集成未安装</strong>
        <span class="muted">
          安装后可获得命令块、退出码、耗时与 cwd；文件只写入
          <code>~/.wslpilot/shell-integration/</code>，不会修改你的 rc。
        </span>
      </template>
    </div>
    <div class="shell-actions">
      <n-button
        v-if="visibility !== 'unsupported'"
        size="tiny"
        type="primary"
        :loading="busy"
        @click="emit('install')"
      >
        {{ visibility === 'partial' ? '修复 Shell 集成' : '安装 Shell 集成' }}
      </n-button>
      <n-button
        v-if="visibility === 'partial' && status?.state !== 'missing'"
        size="tiny"
        quaternary
        :disabled="busy"
        @click="emit('remove')"
      >
        移除
      </n-button>
      <button class="banner-close" type="button" aria-label="关闭提示" @click="emit('dismiss')">
        ×
      </button>
    </div>
  </div>
</template>

<style scoped>
.shell-banner {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-shrink: 0;
  padding: 6px 10px;
  border-bottom: 1px solid var(--color-border-subtle);
  background: var(--color-accent-soft, #eef2ff);
  color: var(--color-text-secondary);
  font-size: 11.5px;
}

.shell-icon {
  display: grid;
  place-items: center;
  width: 22px;
  height: 22px;
  flex-shrink: 0;
  border-radius: 6px;
  background: var(--color-bg-surface);
  color: var(--color-accent);
}

.shell-text {
  flex: 1;
  min-width: 0;
  display: flex;
  gap: 8px;
  align-items: baseline;
  flex-wrap: wrap;
}

.shell-text strong {
  color: var(--color-text-primary);
  font-weight: 650;
}

.muted {
  color: var(--color-text-tertiary);
}

code {
  font-family: var(--font-mono);
  font-size: 10.5px;
}

.shell-actions {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
}

.banner-close {
  width: 22px;
  height: 22px;
  border-radius: 5px;
  color: var(--color-text-tertiary);
  line-height: 1;
}

.banner-close:hover {
  background: var(--color-bg-hover);
  color: var(--color-text-primary);
}
</style>
