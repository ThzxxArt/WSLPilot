<script setup lang="ts">
import { computed } from 'vue'
import { NButton } from 'naive-ui'
import { useRouter } from 'vue-router'
import { useSettingsStore } from '../stores/settings'
import { ACCENT_GRADIENTS } from '@shared/constants'

const router = useRouter()
const settings = useSettingsStore()

const hour = new Date().getHours()
const greeting = hour < 12 ? '早上好' : hour < 18 ? '下午好' : '晚上好'
const gradient = computed(() => ACCENT_GRADIENTS[settings.accent] ?? ACCENT_GRADIENTS.aurora)

const metrics = [
  { label: '运行中', value: '—', hint: '等待 M2' },
  { label: '内存占用', value: '—', hint: '等待 M2' },
  { label: '磁盘占用', value: '—', hint: '等待 M2' },
  { label: 'CPU 负载', value: '—', hint: '等待 M2' },
]
</script>

<template>
  <div class="dashboard">
    <header class="hero">
      <div>
        <h1 class="greeting">{{ greeting }}，指挥官</h1>
        <p class="sub">WSLPilot 骨架已就绪 · 强调色：{{ settings.accent }}</p>
      </div>
      <div class="hero-actions">
        <n-button secondary @click="router.push('/settings')">打开设置</n-button>
        <n-button type="primary" :style="{ background: gradient, border: 'none' }">
          + 安装发行版
        </n-button>
      </div>
    </header>

    <section class="metrics">
      <div v-for="m in metrics" :key="m.label" class="metric card">
        <div class="metric-label">{{ m.label }}</div>
        <div class="metric-value">{{ m.value }}</div>
        <div class="metric-hint">{{ m.hint }}</div>
      </div>
    </section>

    <section class="panel card">
      <h2 class="panel-title">我的发行版</h2>
      <div class="empty">
        <div class="empty-illustration" :style="{ background: gradient }" />
        <p>还没有发行版数据 — M2 将接入 <code>wsl --list --verbose</code></p>
      </div>
    </section>

    <section class="panel card">
      <h2 class="panel-title">快捷操作</h2>
      <div class="quick">
        <n-button secondary disabled>🔌 全部关机</n-button>
        <n-button secondary disabled>📦 备份</n-button>
        <n-button secondary disabled>🧹 清理</n-button>
        <n-button secondary disabled>🧭 网络配置</n-button>
      </div>
    </section>
  </div>
</template>

<style scoped>
.dashboard {
  padding: 24px;
  display: flex;
  flex-direction: column;
  gap: 20px;
  max-width: 1200px;
  margin: 0 auto;
}

.hero {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 16px;
}

.greeting {
  font-size: 24px;
  font-weight: 650;
  line-height: 1.25;
  color: var(--color-text-primary);
}

.sub {
  margin-top: 4px;
  color: var(--color-text-secondary);
  font-size: 13px;
}

.hero-actions {
  display: flex;
  gap: 10px;
}

.metrics {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 16px;
}

@media (max-width: 1100px) {
  .metrics {
    grid-template-columns: repeat(2, 1fr);
  }
}

.metric {
  padding: 18px 20px;
}

.metric-label {
  font-size: 12px;
  font-weight: 500;
  color: var(--color-text-tertiary);
  text-transform: none;
}

.metric-value {
  margin-top: 6px;
  font-size: 32px;
  font-weight: 700;
  line-height: 1.15;
  letter-spacing: -0.02em;
  color: var(--color-text-primary);
}

.metric-hint {
  margin-top: 4px;
  font-size: 12px;
  color: var(--color-text-tertiary);
}

.panel {
  padding: 20px 22px;
}

.panel-title {
  font-size: 16px;
  font-weight: 600;
  margin-bottom: 14px;
  color: var(--color-text-primary);
}

.empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  padding: 28px 0;
  color: var(--color-text-secondary);
  font-size: 13px;
}

.empty-illustration {
  width: 64px;
  height: 64px;
  border-radius: 18px;
  opacity: 0.85;
  box-shadow: var(--shadow-glow);
}

.quick {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}
</style>
