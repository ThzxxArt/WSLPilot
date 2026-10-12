<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from 'vue'
import Sparkline from './Sparkline.vue'
import { useReducedMotion } from '../composables/useReducedMotion'

const props = withDefaults(
  defineProps<{
    label: string
    value: string | number
    hint?: string
    history?: number[]
    gradient?: string
    /** 离散计数卡（如「运行中」）：给脉冲点而非趋势线（设计书 §12.3） */
    pulse?: boolean
  }>(),
  { hint: '', history: () => [], gradient: '', pulse: false },
)

const display = ref<string>(String(props.value))
const { reduced } = useReducedMotion()
let rafId: number | null = null

watch(
  () => props.value,
  (v) => {
    const target = typeof v === 'number' ? v : Number(v)
    if (Number.isFinite(target) && typeof v === 'number') {
      animateTo(target)
    } else {
      cancelAnimation()
      display.value = String(v)
    }
  },
)

function cancelAnimation() {
  if (rafId !== null) {
    cancelAnimationFrame(rafId)
    rafId = null
  }
}

function animateTo(target: number) {
  cancelAnimation()
  // 应用内「减弱动效」与系统偏好都必须生效（review M5；M7 统一走 useReducedMotion）
  if (reduced.value) {
    display.value = String(target)
    return
  }
  const from = Number(display.value.replace(/[^\d.-]/g, '')) || 0
  const start = performance.now()
  const dur = 600
  const step = (now: number) => {
    const t = Math.min(1, (now - start) / dur)
    const eased = 1 - Math.pow(1 - t, 3)
    display.value = String(Math.round(from + (target - from) * eased))
    if (t < 1) {
      rafId = requestAnimationFrame(step)
    } else {
      rafId = null
    }
  }
  rafId = requestAnimationFrame(step)
}

onUnmounted(cancelAnimation)

const hasHistory = computed(() => (props.history?.length ?? 0) >= 2)
</script>

<template>
  <div class="metric card">
    <div class="metric-label">
      {{ label }}
    </div>
    <div class="metric-value-row">
      <div class="metric-value">
        {{ display }}
      </div>
      <span v-if="pulse" class="metric-pulse" aria-hidden="true" />
      <Sparkline
        v-if="hasHistory"
        :values="history"
        :stroke="gradient || undefined"
        :width="72"
        :height="26"
      />
    </div>
    <div v-if="hint" class="metric-hint">
      {{ hint }}
    </div>
  </div>
</template>

<style scoped>
.metric {
  padding: 18px 20px;
}

.metric-label {
  font-size: 12px;
  font-weight: 500;
  color: var(--color-text-tertiary);
}

.metric-value-row {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 8px;
  margin-top: 6px;
}

.metric-value {
  font-size: 28px;
  font-weight: 700;
  line-height: 1.15;
  letter-spacing: -0.02em;
  color: var(--color-text-primary);
  font-variant-numeric: tabular-nums;
}

.metric-hint {
  margin-top: 4px;
  font-size: 12px;
  color: var(--color-text-tertiary);
}

/* 脉冲点（reduced-motion 由 motion.scss 全局降级接管） */
.metric-pulse {
  position: relative;
  width: 10px;
  height: 10px;
  margin-bottom: 6px;
  border-radius: 50%;
  background: var(--color-success, #16a34a);
  flex: none;
}

.metric-pulse::after {
  content: '';
  position: absolute;
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: inherit;
  animation: metric-pulse 2s ease-out infinite;
}

@keyframes metric-pulse {
  0% {
    transform: scale(1);
    opacity: 0.55;
  }

  100% {
    transform: scale(2.4);
    opacity: 0;
  }
}
</style>
