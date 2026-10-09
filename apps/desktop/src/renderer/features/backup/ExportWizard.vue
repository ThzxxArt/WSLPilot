<script setup lang="ts">
import { computed } from 'vue'
import { NButton, NInput, NRadioGroup, NRadioButton, NSelect, NAlert } from 'naive-ui'
import type { DistroView } from '@wslpilot/shared'
import type { ExportForm } from './forms'
import { suggestedBackupPath } from './forms'

const props = defineProps<{
  step: 1 | 2
  form: ExportForm
  distros: DistroView[]
  defaultDir: string
  keepRecent: number
}>()

const emit = defineEmits<{ 'update:form': [ExportForm] }>()

const distroOptions = computed(() =>
  props.distros.map((d) => ({
    label: d.meta?.alias ? `${d.meta.alias}（${d.name}）` : d.name,
    value: d.name,
    disabled: false,
  })),
)

const name = computed(() => props.form.name)
const path = computed(() => props.form.path)
const format = computed(() => props.form.format)

function setName(v: string | number | null) {
  const s = typeof v === 'string' ? v : String(v ?? '')
  const nextPath =
    !props.form.path && s
      ? suggestedBackupPath(props.defaultDir, s, props.form.format)
      : props.form.path
  emit('update:form', { ...props.form, name: s, path: nextPath })
}

function setPath(v: string | number | null) {
  emit('update:form', { ...props.form, path: String(v ?? '') })
}

function setFormat(v: string | number | null) {
  emit('update:form', { ...props.form, format: v === 'vhd' ? 'vhd' : 'tar' })
}

async function browse() {
  const suggested =
    props.form.path ||
    (props.form.name
      ? suggestedBackupPath(props.defaultDir, props.form.name, props.form.format)
      : undefined)
  const picked = await window.wslAPI.app.pickSaveFile({
    defaultPath: suggested,
    suggestedName: suggested,
    filters:
      props.form.format === 'vhd'
        ? [
            { name: 'WSL 虚拟磁盘', extensions: ['vhdx'] },
            { name: '所有文件', extensions: ['*'] },
          ]
        : [
            { name: 'TAR 归档', extensions: ['tar'] },
            { name: '所有文件', extensions: ['*'] },
          ],
  })
  if (picked) emit('update:form', { ...props.form, path: picked })
}

const selectedDistro = computed(() => props.distros.find((d) => d.name === props.form.name) ?? null)
</script>

<template>
  <div class="wizard-body">
    <!-- 步骤 1：选择发行版 -->
    <template v-if="step === 1">
      <div class="field">
        <div class="label">选择要导出的发行版</div>
        <n-select
          :value="name"
          :options="distroOptions"
          placeholder="选择发行版"
          filterable
          @update:value="setName"
        />
        <div v-if="selectedDistro" class="hint">
          当前状态：{{ selectedDistro.state === 'Running' ? '运行中' : '已停止' }} · WSL{{
            selectedDistro.version
          }}
          · 导出过程中可以继续使用该发行版
        </div>
        <n-alert v-if="distros.length === 0" type="warning" class="mt">
          尚未检测到发行版，请先在「发行版」页刷新。
        </n-alert>
      </div>
    </template>

    <!-- 步骤 2：位置与格式 -->
    <template v-else>
      <div class="field">
        <div class="label">保存位置</div>
        <div class="row">
          <n-input
            :value="path"
            placeholder="例如 %USERPROFILE%\\WSL-Backups\\Ubuntu_20260101-120000.tar"
            @update:value="setPath"
          />
          <n-button secondary @click="browse"> 浏览… </n-button>
        </div>
        <div class="hint">
          支持 %USERPROFILE%
          等环境变量；缺扩展名时按格式自动补齐。同目录旧备份按「保留份数」轮转（当前
          {{ keepRecent }} 份）。
        </div>
      </div>

      <div class="field">
        <div class="label">导出格式</div>
        <n-radio-group :value="format" @update:value="setFormat">
          <n-radio-button value="tar"> tar 归档 </n-radio-button>
          <n-radio-button value="vhd"> vhd 虚拟磁盘 </n-radio-button>
        </n-radio-group>
        <div class="hint">
          tar 可在任意 WSL 版本间迁移；vhd 仅支持 WSL2，导入时更快且可就地挂载。
        </div>
      </div>
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

.row {
  display: flex;
  gap: 8px;
  align-items: center;
}

.row .n-input {
  flex: 1;
}

.mt {
  margin-top: 4px;
}
</style>
