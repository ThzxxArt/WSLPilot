<script setup lang="ts">
import { computed } from 'vue'
import { NButton, NInput, NRadioGroup, NRadioButton, NSelect, NAlert } from 'naive-ui'
import type { DistroView } from '@wslpilot/shared'
import type { ImportForm } from './forms'
import { isValidDistroName } from './forms'

const props = defineProps<{
  step: 1 | 2
  form: ImportForm
  distros: DistroView[]
  defaultDir: string
}>()

const emit = defineEmits<{ 'update:form': [ImportForm] }>()

type ImportMode = 'tar' | 'vhd-copy' | 'vhd-inplace'

const mode = computed<ImportMode>(() => {
  if (props.form.inPlace) return 'vhd-inplace'
  return props.form.format === 'vhd' ? 'vhd-copy' : 'tar'
})

function setMode(m: string | number | null) {
  const v = (m === 'vhd-copy' || m === 'vhd-inplace' ? m : 'tar') as ImportMode
  emit('update:form', {
    ...props.form,
    inPlace: v === 'vhd-inplace',
    format: v === 'tar' ? 'tar' : 'vhd',
  })
}

function setName(v: string | number | null) {
  emit('update:form', { ...props.form, name: String(v ?? '') })
}

function setArchivePath(v: string | number | null) {
  emit('update:form', { ...props.form, archivePath: String(v ?? '') })
}

function setInstallPath(v: string | number | null) {
  emit('update:form', { ...props.form, installPath: String(v ?? '') })
}

function setVersion(v: string | number | null) {
  emit('update:form', { ...props.form, version: v === 1 ? 1 : 2 })
}

const name = computed(() => props.form.name)
const archivePath = computed(() => props.form.archivePath)
const installPath = computed(() => props.form.installPath)
const version = computed(() => props.form.version)

const nameTaken = computed(() => {
  const n = props.form.name.trim()
  return !!n && props.distros.some((d) => d.name === n)
})

const nameInvalid = computed(() => props.form.name.trim() !== '' && !isValidDistroName(props.form.name))

async function browseArchive() {
  const picked = await window.wslAPI.app.pickOpenFile({
    defaultPath: props.defaultDir,
    filters:
      props.form.format === 'vhd'
        ? [{ name: 'WSL 虚拟磁盘', extensions: ['vhdx', 'vhd'] }, { name: '所有文件', extensions: ['*'] }]
        : [{ name: 'TAR 归档', extensions: ['tar'] }, { name: '所有文件', extensions: ['*'] }],
  })
  if (picked) {
    const looksVhd = /\.vhdx?$/i.test(picked)
    emit('update:form', {
      ...props.form,
      archivePath: picked,
      format: looksVhd ? 'vhd' : 'tar',
    })
  }
}

async function browseInstallDir() {
  const picked = await window.wslAPI.app.pickDirectory(props.defaultDir)
  if (picked) emit('update:form', { ...props.form, installPath: picked })
}
</script>

<template>
  <div class="wizard-body">
    <!-- 步骤 1：名称与导入方式 -->
    <template v-if="step === 1">
      <div class="field">
        <div class="label">
          新发行版名称
        </div>
        <n-input
          :value="name"
          placeholder="例如 Ubuntu-Restored"
          @update:value="setName"
        />
        <n-alert
          v-if="nameTaken"
          type="warning"
        >
          已存在同名发行版「{{ form.name }}」，请换一个名称。
        </n-alert>
        <n-alert
          v-else-if="nameInvalid"
          type="error"
        >
          名称不能包含 \ / : * ? " &lt; &gt; | 等字符。
        </n-alert>
      </div>

      <div class="field">
        <div class="label">
          导入方式
        </div>
        <n-radio-group
          :value="mode"
          @update:value="setMode"
        >
          <n-radio-button value="tar">
            tar 归档导入
          </n-radio-button>
          <n-radio-button value="vhd-copy">
            vhdx 复制导入
          </n-radio-button>
          <n-radio-button value="vhd-inplace">
            vhdx 就地导入
          </n-radio-button>
        </n-radio-group>
        <div class="hint">
          就地导入不复制虚拟磁盘、速度快，但源 vhdx 将被直接注册使用；复制导入会把 vhdx 拷贝到安装位置。
        </div>
      </div>

      <div
        v-if="mode === 'tar'"
        class="field"
      >
        <div class="label">
          目标 WSL 版本
        </div>
        <n-select
          :value="version"
          :options="[
            { label: 'WSL 2（推荐）', value: 2 },
            { label: 'WSL 1', value: 1 },
          ]"
          style="max-width: 240px"
          @update:value="setVersion"
        />
      </div>
    </template>

    <!-- 步骤 2：文件与安装位置 -->
    <template v-else>
      <div class="field">
        <div class="label">
          备份文件
        </div>
        <div class="row">
          <n-input
            :value="archivePath"
            placeholder="选择 .tar 或 .vhdx 备份文件"
            @update:value="setArchivePath"
          />
          <n-button
            secondary
            @click="browseArchive"
          >
            浏览…
          </n-button>
        </div>
      </div>

      <div
        v-if="!form.inPlace"
        class="field"
      >
        <div class="label">
          安装位置
        </div>
        <div class="row">
          <n-input
            :value="installPath"
            placeholder="发行版安装目录（将存放 ext4.vhdx）"
            @update:value="setInstallPath"
          />
          <n-button
            secondary
            @click="browseInstallDir"
          >
            浏览…
          </n-button>
        </div>
        <div class="hint">
          建议使用独立空目录，便于日后迁移与卸载。
        </div>
      </div>
      <n-alert
        v-else
        type="info"
      >
        就地导入：源 vhdx 原地注册为「{{ form.name || '新发行版' }}」，无需选择安装位置。
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

.row {
  display: flex;
  gap: 8px;
  align-items: center;
}

.row .n-input {
  flex: 1;
}
</style>
