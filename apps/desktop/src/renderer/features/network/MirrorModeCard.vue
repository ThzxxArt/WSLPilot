<script setup lang="ts">
import { computed } from 'vue'
import { NButton, NTag, useMessage } from 'naive-ui'
import {
  mirrorModeGuidance,
  mirrorModeSnippet,
  NETWORK_MODE_LABEL,
  type NetworkStatus,
} from '@wslpilot/shared'

/**
 * 镜像网络模式状态卡（M6 · 设计书 §12.6）：
 * 检测 `%UserProfile%\.wslconfig` 的 `[wsl2] networkingMode`；
 * 非 mirrored 时展示「推荐」提示卡与配置片段（一键复制 + 打开所在目录）。
 */
const props = defineProps<{ status: NetworkStatus | null; loading?: boolean }>()
const emit = defineEmits<{ openDir: [] }>()

const message = useMessage()

const mode = computed(() => props.status?.mode ?? 'unknown')
const mirrored = computed(() => mode.value === 'mirrored')
const guidance = computed(() => mirrorModeGuidance(mode.value))

const modeLabel = computed(() => NETWORK_MODE_LABEL[mode.value])
const modeType = computed(() => (mirrored.value ? 'success' : 'warning'))

async function copySnippet() {
  try {
    await navigator.clipboard.writeText(mirrorModeSnippet())
    message.success('配置片段已复制')
  } catch {
    message.warning('复制失败，请手动选择文本')
  }
}
</script>

<template>
  <section class="card mirror-card" :class="{ ok: mirrored }">
    <div class="head">
      <div>
        <h2 class="panel-title">网络模式</h2>
        <p class="sub">
          读取 <code>{{ status?.wslconfigPath || '%USERPROFILE%\\.wslconfig' }}</code>
          <n-tag
            v-if="status && !status.wslconfigExists"
            size="tiny"
            :bordered="false"
            type="warning"
          >
            文件不存在
          </n-tag>
        </p>
      </div>
      <n-tag size="small" :bordered="false" :type="modeType">
        {{ modeLabel }}
      </n-tag>
    </div>

    <div v-if="mirrored" class="body ok-body">
      <p>
        镜像模式已开启：Windows 与 WSL 共用网络栈，宿主机可直接访问 Linux 服务的
        localhost，通常无需端口转发。
      </p>
    </div>

    <div v-else class="body">
      <p class="title">{{ guidance.title }}</p>
      <p class="text">{{ guidance.body }}</p>
      <pre class="snippet">{{ guidance.snippet }}</pre>
      <p class="text">
        写入后执行 <code>wsl --shutdown</code> 并重新启动发行版（完全停止约 8 秒后配置才生效）。
      </p>
      <div class="actions">
        <n-button size="small" type="primary" secondary @click="copySnippet">复制配置片段</n-button>
        <n-button size="small" secondary @click="emit('openDir')"
          >打开 .wslconfig 所在目录</n-button
        >
      </div>
    </div>
  </section>
</template>

<style scoped>
.mirror-card {
  padding: 18px 22px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}

.panel-title {
  font-size: 15px;
  font-weight: 600;
  margin: 0;
  color: var(--color-text-primary);
}

.sub {
  margin: 4px 0 0;
  font-size: 12px;
  color: var(--color-text-secondary);
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.sub code {
  background: var(--color-bg-sunken);
  padding: 1px 6px;
  border-radius: 4px;
  font-size: 11px;
  word-break: break-all;
}

.body {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.ok-body p {
  margin: 0;
  font-size: 13px;
  color: var(--color-text-secondary);
}

.title {
  margin: 0;
  font-size: 13.5px;
  font-weight: 600;
  color: var(--color-text-primary);
}

.text {
  margin: 0;
  font-size: 12.5px;
  line-height: 1.7;
  color: var(--color-text-secondary);
}

.text code {
  background: var(--color-bg-sunken);
  padding: 1px 6px;
  border-radius: 4px;
  font-size: 11px;
}

.snippet {
  margin: 0;
  padding: 12px 14px;
  border-radius: var(--radius-md);
  background: var(--color-bg-sunken);
  font-family: var(--font-mono);
  font-size: 12px;
  line-height: 1.7;
  color: var(--color-text-primary);
}

.actions {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
}

.mirror-card.ok {
  border-color: color-mix(in srgb, var(--color-success) 35%, transparent);
}
</style>
