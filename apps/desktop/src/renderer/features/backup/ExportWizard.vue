<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { NButton, NInput, NRadioGroup, NRadioButton, NSelect, NAlert, NCheckbox } from 'naive-ui'
import type { DistroView } from '@wslpilot/shared'
import type { ExportForm } from './forms'
import { suggestedBackupPath } from './forms'
import { useWslEnvStore } from '../../stores/wsl-env'

const props = defineProps<{
  step: 1 | 2
  form: ExportForm
  distros: DistroView[]
  defaultDir: string
  keepRecent: number
}>()

const emit = defineEmits<{ 'update:form': [ExportForm] }>()

const wslEnv = useWslEnvStore()
onMounted(() => {
  void wslEnv.load()
})

/** 浏览对话框失败的非模态提示（不依赖全局 message provider，向导可独立挂载） */
const browseError = ref('')

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

/**
 * 上一次自动建议的路径：用户没手改（当前值仍等于建议值或为空）时，
 * name/format 变化会跟随刷新建议；手改过则一律不动（review 0.1.2 根治）。
 */
const lastSuggested = ref('')

/** 未手改状态下重新生成建议路径；返回 null 表示应保持用户当前值 */
function syncSuggestedPath(nextName: string, nextFormat: 'tar' | 'tar.gz' | 'vhd'): string | null {
  if (props.form.path && props.form.path !== lastSuggested.value) return null
  if (!nextName) return ''
  const suggested = suggestedBackupPath(props.defaultDir, nextName, nextFormat)
  lastSuggested.value = suggested
  return suggested
}

function setName(v: string | number | null) {
  const s = typeof v === 'string' ? v : String(v ?? '')
  const picked = props.distros.find((d) => d.name === s)
  // 选到 WSL1 时 vhd 不可用：切换为 tar，避免 disabled 的 radio 仍是选中态
  const nextFormat =
    picked?.version === 1 && props.form.format === 'vhd' ? 'tar' : props.form.format
  const synced = syncSuggestedPath(s, nextFormat)
  emit('update:form', {
    ...props.form,
    name: s,
    format: nextFormat,
    path: synced ?? props.form.path,
  })
}

function setPath(v: string | number | null) {
  emit('update:form', { ...props.form, path: String(v ?? '') })
}

function setFormat(v: string | number | null) {
  const f = v === 'vhd' ? 'vhd' : v === 'tar.gz' ? 'tar.gz' : 'tar'
  // 已建议后缀同步切换（tar ↔ tar.gz ↔ vhdx）：避免建议文件与所选格式不一致
  const synced = syncSuggestedPath(props.form.name, f)
  emit('update:form', { ...props.form, format: f, path: synced ?? props.form.path })
}

function setTerminateFirst(v: boolean) {
  emit('update:form', { ...props.form, terminateFirst: v })
}

async function browse() {
  const suggested =
    props.form.path ||
    (props.form.name
      ? suggestedBackupPath(props.defaultDir, props.form.name, props.form.format)
      : undefined)
  const filters =
    props.form.format === 'vhd'
      ? [
          { name: 'WSL 虚拟磁盘', extensions: ['vhdx'] },
          { name: '所有文件', extensions: ['*'] },
        ]
      : props.form.format === 'tar.gz'
        ? [
            { name: 'gzip 压缩归档', extensions: ['gz', 'tar.gz'] },
            { name: '所有文件', extensions: ['*'] },
          ]
        : [
            { name: 'TAR 归档', extensions: ['tar'] },
            { name: '所有文件', extensions: ['*'] },
          ]
  try {
    const picked = await window.wslAPI.app.pickSaveFile({
      defaultPath: suggested,
      suggestedName: suggested,
      filters,
    })
    if (picked) emit('update:form', { ...props.form, path: picked })
  } catch (e) {
    browseError.value = e instanceof Error ? e.message : '选择保存位置失败'
  }
}
const selectedDistro = computed(() => props.distros.find((d) => d.name === props.form.name) ?? null)
const selectedRunning = computed(() => selectedDistro.value?.state === 'Running')
const selectedWsl1 = computed(() => selectedDistro.value?.version === 1)
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
          当前状态：{{ selectedRunning ? '运行中' : '已停止' }} · WSL{{ selectedDistro.version }}
          · 导出会停止运行中的发行版（WSL 语义），不会在导出期间保留其终端会话
        </div>
        <n-alert v-if="selectedRunning" type="warning" class="mt">
          该发行版正在运行。继续导出会先执行 <code>wsl --terminate</code>，其中的终端、编辑器与
          未保存进程都会被关闭。请勾选下方确认，或先去「发行版」页停止它。
          <div class="confirm-row">
            <n-checkbox :checked="form.terminateFirst" @update:checked="setTerminateFirst">
              我已知晓，导出前先停止该发行版
            </n-checkbox>
          </div>
        </n-alert>
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
        <div v-if="browseError" class="hint error">{{ browseError }}</div>
      </div>

      <div class="field">
        <div class="label">导出格式</div>
        <n-radio-group :value="format" @update:value="setFormat">
          <n-radio-button value="tar"> tar 归档 </n-radio-button>
          <n-radio-button value="tar.gz" :disabled="!wslEnv.can('exportFormats')">
            tar.gz 压缩归档
          </n-radio-button>
          <n-radio-button value="vhd" :disabled="selectedWsl1"> vhd 虚拟磁盘 </n-radio-button>
        </n-radio-group>
        <div class="hint">
          tar 可在任意 WSL 版本间迁移；tar.gz 体积更小（WSL 2.4.4+，导入时自动识别）；vhd 仅支持
          WSL2，导入时更快且可就地挂载。
        </div>
        <div v-if="!wslEnv.can('exportFormats')" class="hint warn">
          {{ wslEnv.requirement('exportFormats') }}，当前导出请用 tar 或 vhd。
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

.hint.error {
  color: var(--color-danger);
}

.hint.warn {
  color: var(--color-warning);
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

.confirm-row {
  margin-top: 8px;
}
</style>
