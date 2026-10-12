<script setup lang="ts">
import { computed, onErrorCaptured, onMounted, onUnmounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import {
  NConfigProvider,
  NMessageProvider,
  NNotificationProvider,
  NDialogProvider,
  NSpin,
  zhCN,
  enUS,
  dateZhCN,
  dateEnUS,
} from 'naive-ui'
import DefaultLayout from './layouts/DefaultLayout.vue'
import ConflictResolver from './features/config/ConflictResolver.vue'
import CommandPalette from './features/command/CommandPalette.vue'
import { useSettingsStore } from './stores/settings'
import { useTerminalStore } from './stores/terminal'
import { useUpdateStore } from './stores/update'
import { attachTaskProgress } from './composables/useTaskProgress'
import { useNaiveTheme, applyAccentToDom } from '@wslpilot/ui'
import type { AccentName } from '@wslpilot/ui'

const settings = useSettingsStore()
const router = useRouter()
const accent = computed(() => settings.accent as AccentName)
const { themeOverrides } = useNaiveTheme(accent)

/** 语言（settings.general.locale）：system 按浏览器语言判定 */
const naiveLocale = computed(() => {
  if (settings.locale === 'en-US') return enUS
  if (settings.locale === 'zh-CN') return zhCN
  return navigator.language.toLowerCase().startsWith('zh') ? zhCN : enUS
})
const naiveDateLocale = computed(() => (naiveLocale.value === enUS ? dateEnUS : dateZhCN))

const ready = ref(false)

/**
 * 主进程桥接缺失（preload 失败）：启动时显式渲染错误屏，
 * 而不是照常调用全为 undefined 的 wslAPI 后「全页静默失能」（review 0.1.2 根治）。
 */
const bridgeMissing = ref(typeof window === 'undefined' || !window.wslAPI)

/**
 * 子组件未捕获异常：onErrorCaptured 渲染降级错误面板（返回应用/重新加载）。
 * review 0.1.2 审计修复：不再 `return false` 阻断传播——此前注释宣称与 main.ts
 * errorHandler 两级兜底，但阻断后全局 handler 永不执行（名不副实）。
 * 现让错误继续上报，职责收敛为一处记录 + 一处降级：main.ts errorHandler 负责
 * console.error + wslAPI 可用性诊断，本组件负责面向用户的降级面板。
 */
const fatalError = ref<unknown>(null)
onErrorCaptured((err, _instance, info) => {
  console.error('[WSLPilot] 组件错误已捕获:', err, info)
  fatalError.value = err
})

const fatalMessage = computed(() => {
  if (bridgeMissing.value) {
    return '主进程桥接不可用（window.wslAPI 缺失），应用功能无法启用。请重启应用；若问题持续，请检查安装完整性。'
  }
  const e = fatalError.value
  if (e instanceof Error && e.message) return e.message
  if (typeof e === 'string' && e) return e
  return '界面渲染发生未知错误'
})

/**
 * 返回应用（review 0.1.2 审计修复）：清除降级态复位重渲染，
 * 瞬时异常不再只能整壳重载；若子树再次抛出会重新进入降级面板。
 */
function dismissFatal() {
  fatalError.value = null
}

function reload() {
  try {
    window.location.reload()
  } catch (e) {
    console.error('[WSLPilot] 重载失败:', e)
  }
}

watch(
  () => settings.accent,
  (a) => applyAccentToDom(a as AccentName),
  { immediate: true },
)

watch(
  () => settings.reduceMotion,
  (on) => {
    document.documentElement.dataset.reduceMotion = on ? 'true' : 'false'
  },
  { immediate: true },
)

let unsubConfig: (() => void) | undefined
let unsubNavigate: (() => void) | undefined
let unsubPtyData: (() => void) | undefined
let unsubPtyExit: (() => void) | undefined
let unsubTaskProgress: (() => void) | undefined
let unsubUpdate: (() => void) | undefined

onMounted(async () => {
  // preload 缺失：不触碰全 undefined 的桥接面，错误屏已由 bridgeMissing 渲染
  if (bridgeMissing.value) return
  // load 内部已降级兜底；此处 finally 保证界面一定走出 loading（review C11）
  try {
    await settings.load()
  } finally {
    ready.value = true
  }

  unsubConfig = window.wslAPI?.config.onChanged(({ fileKey }) => {
    if (fileKey === 'settings') void settings.load()
  })

  // 托盘菜单导航
  unsubNavigate = window.wslAPI?.app.onNavigate((path) => {
    void router.push(path)
  })

  // ★ PTY 数据应用级常驻：离开终端页也不丢输出（评审 I1）
  const terminal = useTerminalStore()
  // 窗口重载后找回主进程中仍存活的会话（含动作临时 PTY）
  void terminal.recover()
  unsubPtyData = window.wslAPI?.terminal.onData((p) => {
    terminal.appendOutput(p.ptyId, p.chunk)
  })
  unsubPtyExit = window.wslAPI?.terminal.onExit((p) => {
    terminal.handleExit(p.ptyId, p.code)
  })

  // ★ 长任务进度应用级常驻：离开备份页也不丢进度（M4）
  unsubTaskProgress = attachTaskProgress()

  // ★ 自动更新状态应用级常驻（M7）：设置页/托盘以外也能收到 update:changed
  unsubUpdate = useUpdateStore().attach()

  // ★ 全局快捷键已下沉到 DefaultLayout（message provider 内，失败可 toast）
  // 外部配置冲突由 ConflictResolver（NDialog）处理，语义见该组件（review C3）
})

onUnmounted(() => {
  unsubConfig?.()
  unsubNavigate?.()
  unsubPtyData?.()
  unsubPtyExit?.()
  unsubTaskProgress?.()
  unsubUpdate?.()
})
</script>

<template>
  <n-config-provider
    :theme-overrides="themeOverrides"
    :locale="naiveLocale"
    :date-locale="naiveDateLocale"
    class="h-full"
  >
    <n-message-provider>
      <n-notification-provider>
        <n-dialog-provider>
          <!-- 启动兜底：桥接缺失 / 子组件未捕获错误 → 显式降级面板（review 0.1.2 根治） -->
          <div v-if="bridgeMissing || fatalError" class="fatal-screen" role="alert">
            <div class="fatal-card">
              <div class="fatal-badge" aria-hidden="true">!</div>
              <h1 class="fatal-title">WSLPilot 初始化失败</h1>
              <p class="fatal-message">{{ fatalMessage }}</p>
              <div class="fatal-actions">
                <!-- 桥接缺失时无应用可回：只保留重载（review 0.1.2 审计修复） -->
                <button
                  v-if="!bridgeMissing"
                  class="fatal-back"
                  type="button"
                  @click="dismissFatal"
                >
                  返回应用
                </button>
                <button class="fatal-reload" type="button" @click="reload">重新加载</button>
              </div>
            </div>
          </div>
          <template v-else>
            <ConflictResolver />
            <CommandPalette />
            <div v-if="ready" class="pilot-shell">
              <DefaultLayout />
            </div>
            <div v-else class="loading-screen">
              <n-spin size="large" />
            </div>
          </template>
        </n-dialog-provider>
      </n-notification-provider>
    </n-message-provider>
  </n-config-provider>
</template>

<style scoped>
.loading-screen {
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--color-bg-canvas);
}

.fatal-screen {
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  background: var(--color-bg-canvas);
}

.fatal-card {
  max-width: 460px;
  padding: 28px 30px;
  border-radius: var(--radius-lg);
  background: var(--color-bg-surface);
  border: 1px solid var(--color-border-subtle);
  text-align: center;
}

.fatal-badge {
  width: 40px;
  height: 40px;
  margin: 0 auto 12px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  background: color-mix(in srgb, var(--color-danger) 16%, transparent);
  color: var(--color-danger);
  font-size: 22px;
  font-weight: 700;
}

.fatal-title {
  margin: 0 0 8px;
  font-size: 18px;
  font-weight: 650;
  color: var(--color-text-primary);
}

.fatal-message {
  margin: 0 0 18px;
  font-size: 13px;
  line-height: 1.7;
  color: var(--color-text-secondary);
  word-break: break-word;
}

.fatal-actions {
  display: flex;
  gap: 10px;
  justify-content: center;
}

.fatal-reload,
.fatal-back {
  height: 34px;
  padding: 0 18px;
  border-radius: 9px;
  font-size: 13px;
  font-weight: 600;
  transition: background var(--dur-fast) var(--ease-standard);
}

.fatal-reload {
  background: var(--color-accent);
  color: var(--color-text-inverse);
}

.fatal-back {
  background: var(--color-bg-hover);
  color: var(--color-text-primary);
}

.fatal-reload:hover {
  background: var(--color-accent-hover);
}

.fatal-back:hover {
  background: var(--color-border-subtle);
}
</style>
