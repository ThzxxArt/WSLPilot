<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import {
  NButton,
  NCard,
  NRadioGroup,
  NRadio,
  NSwitch,
  NSpace,
  NDivider,
  NTag,
  useMessage,
} from 'naive-ui'
import { useSettingsStore } from '../stores/settings'
import { ACCENT_GRADIENTS, ACCENT_PRIMARY } from '@shared/constants'
import type { AccentName } from '@shared/types'
import { applyAccentToDom } from '@wslpilot/ui'

const settings = useSettingsStore()
const message = useMessage()

const accents: { name: AccentName; label: string }[] = [
  { name: 'aurora', label: '极光 Aurora' },
  { name: 'sunset', label: '日落 Sunset' },
  { name: 'ocean', label: '海洋 Ocean' },
  { name: 'forest', label: '森林 Forest' },
]

const selectedAccent = ref<AccentName>(settings.accent)

watch(
  () => settings.accent,
  (a) => (selectedAccent.value = a),
  { immediate: true },
)

const previewGradient = computed(() => ACCENT_GRADIENTS[selectedAccent.value] ?? ACCENT_GRADIENTS.aurora)
const previewPrimary = computed(() => ACCENT_PRIMARY[selectedAccent.value] ?? ACCENT_PRIMARY.aurora)

async function onAccentChange(name: AccentName) {
  selectedAccent.value = name
  applyAccentToDom(name) // 实时预览，无需保存
  await settings.setAccent(name)
  message.success(`强调色已切换为 ${accents.find((a) => a.name === name)?.label ?? name}`)
}

function openConfigDir() {
  void window.wslAPI.app.openConfigDir()
}
</script>

<template>
  <div class="settings">
    <header class="page-header">
      <h1>设置</h1>
      <p class="sub">
        应用偏好与配置管理 · 所有修改即时写入 <code>settings.jsonc</code>
      </p>
    </header>

    <n-card
      title="外观"
      class="block"
      :bordered="true"
    >
      <div class="accent-row">
        <div class="accent-picker">
          <div class="label">
            强调色
          </div>
          <n-radio-group
            v-model:value="selectedAccent"
            @update:value="onAccentChange"
          >
            <n-space>
              <n-radio
                v-for="a in accents"
                :key="a.name"
                :value="a.name"
              >
                {{ a.label }}
              </n-radio>
            </n-space>
          </n-radio-group>
        </div>

        <div class="accent-preview">
          <div class="label">
            实时预览
          </div>
          <div class="preview-card">
            <div
              class="preview-swatch"
              :style="{ background: previewGradient }"
            />
            <div class="preview-body">
              <div class="preview-title">
                WSLPilot
              </div>
              <div class="preview-text">
                按钮与高亮将使用此强调色
              </div>
              <button
                class="preview-btn"
                :style="{ background: previewPrimary }"
              >
                主要按钮
              </button>
            </div>
          </div>
        </div>
      </div>

      <n-divider />

      <div class="setting-line">
        <div>
          <div class="label">
            减弱动效
          </div>
          <div class="hint">
            开启后动画时长降为即时切换
          </div>
        </div>
        <n-switch
          :value="settings.reduceMotion"
          @update:value="(v: boolean) => settings.setReduceMotion(v)"
        />
      </div>
    </n-card>

    <n-card
      title="高级"
      class="block"
    >
      <div class="setting-line">
        <div>
          <div class="label">
            显示等价命令行
          </div>
          <div class="hint">
            操作时展示将执行的 wsl.exe 命令
          </div>
        </div>
        <n-switch
          :value="settings.showRawCommand"
          @update:value="(v: boolean) => settings.setShowRawCommand(v)"
        />
      </div>

      <div class="setting-line">
        <div>
          <div class="label">
            破坏性操作二次确认
          </div>
          <div class="hint">
            注销、迁移等操作前弹出确认框
          </div>
        </div>
        <n-switch
          :value="settings.confirmDestructive"
          @update:value="(v: boolean) => settings.setConfirmDestructive(v)"
        />
      </div>
    </n-card>

    <n-card
      title="配置目录"
      class="block"
    >
      <p class="hint">
        所有持久化状态为人类可读 JSONC，路径可见、内容可改、可纳入 Git。
      </p>
      <n-space style="margin-top: 12px">
        <n-button @click="openConfigDir">
          打开配置目录
        </n-button>
        <n-tag
          :bordered="false"
          type="info"
        >
          settings.jsonc
        </n-tag>
        <n-tag :bordered="false">
          distros.jsonc
        </n-tag>
        <n-tag :bordered="false">
          actions.jsonc
        </n-tag>
        <n-tag :bordered="false">
          network.jsonc
        </n-tag>
      </n-space>
    </n-card>

    <n-card
      title="关于"
      class="block"
    >
      <p class="hint">
        WSLPilot v{{ settings.version || '0.1.0' }} · MIT License
      </p>
      <p class="hint">
        让 WSL 管理像驾驶一样从容。
      </p>
    </n-card>
  </div>
</template>

<style scoped>
.settings {
  padding: 24px;
  max-width: 720px;
  margin: 0 auto;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.page-header h1 {
  font-size: 24px;
  font-weight: 650;
  color: var(--color-text-primary);
}

.sub {
  margin-top: 4px;
  color: var(--color-text-secondary);
  font-size: 13px;
}

.block {
  border-radius: var(--radius-lg);
}

.label {
  font-size: 13px;
  font-weight: 600;
  color: var(--color-text-primary);
  margin-bottom: 6px;
}

.hint {
  font-size: 12px;
  color: var(--color-text-secondary);
  line-height: 1.5;
}

.accent-row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 24px;
}

@media (width <= 640px) {
  .accent-row {
    grid-template-columns: 1fr;
  }
}

.preview-card {
  display: flex;
  gap: 12px;
  padding: 14px;
  border-radius: var(--radius-md);
  background: var(--color-bg-sunken);
  border: 1px solid var(--color-border-subtle);
}

.preview-swatch {
  width: 48px;
  height: 48px;
  border-radius: 12px;
  flex-shrink: 0;
  transition: background var(--dur-slow) var(--ease-standard);
}

.preview-title {
  font-weight: 650;
  font-size: 14px;
  color: var(--color-text-primary);
}

.preview-text {
  font-size: 12px;
  color: var(--color-text-secondary);
  margin: 2px 0 8px;
}

.preview-btn {
  height: 28px;
  padding: 0 12px;
  border-radius: 8px;
  color: #fff;
  font-size: 12px;
  font-weight: 600;
  transition: background var(--dur-base) var(--ease-standard);
}

.setting-line {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 10px 0;
}

.setting-line + .setting-line {
  border-top: 1px solid var(--color-border-subtle);
}
</style>
