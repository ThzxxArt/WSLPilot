<script setup lang="ts">
import { computed } from 'vue'
import { NButton, NCheckbox, NInput, NSelect, NAlert } from 'naive-ui'
import type { DistroView } from '@wslpilot/shared'
import type { MoveForm } from './forms'

const props = defineProps<{
  step: 1 | 2
  form: MoveForm
  distros: DistroView[]
  autoBackup: boolean
}>()

const emit = defineEmits<{ 'update:form': [MoveForm] }>()

const distroOptions = computed(() =>
  props.distros.map((d) => ({
    label: d.meta?.alias ? `${d.meta.alias}（${d.name}）` : d.name,
    value: d.name,
  })),
)

const name = computed(() => props.form.name)
const path = computed(() => props.form.path)
const terminateFirst = computed(() => props.form.terminateFirst)

function setName(v: string | number | null) {
  emit('update:form', { ...props.form, name: String(v ?? '') })
}

function setPath(v: string | number | null) {
  emit('update:form', { ...props.form, path: String(v ?? '') })
}

function setTerminateFirst(v: boolean) {
  emit('update:form', { ...props.form, terminateFirst: v === true })
}

const selectedDistro = computed(() => props.distros.find((d) => d.name === props.form.name) ?? null)
const isRunning = computed(() => selectedDistro.value?.state === 'Running')
const currentBasePath = computed(() => selectedDistro.value?.basePath ?? '')

async function browse() {
  const picked = await window.wslAPI.app.pickDirectory(currentBasePath.value || undefined)
  if (picked) emit('update:form', { ...props.form, path: picked })
}
</script>

<template>
  <div class="wizard-body">
    <!-- 步骤 1：选择发行版 -->
    <template v-if="step === 1">
      <div class="field">
        <div class="label">
          选择要迁移的发行版
        </div>
        <n-select
          :value="name"
          :options="distroOptions"
          placeholder="选择发行版"
          filterable
          @update:value="setName"
        />
        <div
          v-if="selectedDistro"
          class="hint"
        >
          当前位置：{{ currentBasePath || '（未知，注册表信息不可用）' }}
        </div>
      </div>

      <n-alert
        v-if="isRunning"
        type="warning"
      >
        该发行版正在运行。迁移需要先终止（terminate）会话，未保存的工作可能丢失。
        <div class="check-line">
          <n-checkbox
            :checked="terminateFirst"
            @update:checked="setTerminateFirst"
          >
            终止后继续迁移
          </n-checkbox>
        </div>
      </n-alert>
    </template>

    <!-- 步骤 2：目标位置 -->
    <template v-else>
      <div class="field">
        <div class="label">
          迁移目标位置
        </div>
        <div class="row">
          <n-input
            :value="path"
            placeholder="例如 D:\\WSL\\Ubuntu-22.04"
            @update:value="setPath"
          />
          <n-button
            secondary
            @click="browse"
          >
            浏览…
          </n-button>
        </div>
        <div class="hint">
          目标为目录（发行版虚拟磁盘将移动到该位置）。需要 WSL 2.0+ 的
          <code>wsl --manage --move</code> 支持。
        </div>
      </div>

      <n-alert
        v-if="autoBackup"
        type="info"
      >
        安全兜底已开启：迁移前会自动把「{{ form.name || '该发行版' }}」导出到备份目录，再执行迁移。
      </n-alert>
      <n-alert
        v-else
        type="warning"
      >
        迁移前自动备份已关闭。迁移失败可能导致发行版不可用，建议先手动导出一次。
      </n-alert>
    </template>
  </div>
</template>

<style scoped>
.wizard-body {
  display: flex;
  flex-direction: column;
  gap: 18px;
}

.field {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.label {
  font-size: 13px;
  font-weight: 600;
  color: var(--color-text-primary);
}

.hint {
  font-size: 12px;
  color: var(--color-text-secondary);
  line-height: 1.6;
}

.check-line {
  margin-top: 8px;
}

.row {
  display: flex;
  gap: 8px;
  align-items: center;
}

.row .n-input {
  flex: 1;
}

code {
  background: var(--color-bg-sunken);
  padding: 1px 5px;
  border-radius: 4px;
  font-size: 11px;
}
</style>
