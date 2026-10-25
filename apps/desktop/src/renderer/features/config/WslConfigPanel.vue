<script setup lang="ts">
/**
 * `.wslconfig` 全局配置面板（0.1.3）— 可视化表单 + 原始文本 + Diff 预览。
 * 保存为宿主文件（备份 + 原子写，无需 UAC）；生效需 `wsl --shutdown`（面板内一键重启）。
 */
import { computed, onMounted, ref } from 'vue'
import {
  NButton,
  NInput,
  NInputNumber,
  NModal,
  NSelect,
  NSwitch,
  NTag,
  useDialog,
  useMessage,
} from 'naive-ui'
import { CodeEditor, Kbd } from '@wslpilot/ui'
import { WSL_CONFIG_FIELDS, summarizeWslConfigChanges, type WslConfigField } from '@wslpilot/shared'
import { useWslConfig } from '../../composables/useWslConfig'
import { errorLine } from '../../composables/useAppError'

const emit = defineEmits<{ saved: [] }>()

const message = useMessage()
const dialog = useDialog()
const conf = useWslConfig()

const preview = ref(false)
const previewOpen = computed({
  get: () => preview.value,
  set: (v: boolean) => (preview.value = v),
})
const shutdownBusy = ref(false)

/**
 * 保存门控只在表单模式生效（0.1.3 修复）：raw 模式用户自行书写语法，
 * 不得被表单模型的残留字段错误阻塞（表单错误随切回 form 自动继续生效）。
 */
const blockedByFields = computed(() => conf.mode.value === 'form' && conf.hasFieldErrors.value)

onMounted(() => {
  void conf.load()
})

const sections = computed(() => {
  const map = new Map<string, WslConfigField[]>()
  for (const f of WSL_CONFIG_FIELDS) {
    const list = map.get(f.section) ?? []
    list.push(f)
    map.set(f.section, list)
  }
  return [...map.entries()].map(([name, fields]) => ({ name, fields }))
})

function sectionTitle(name: string): string {
  switch (name) {
    case 'wsl2':
      return '[wsl2] — 资源与网络'
    case 'general':
      return '[general] — 通用'
    case 'experimental':
      return '[experimental] — 实验特性'
    default:
      return `[${name}]`
  }
}

/** enum 选项：当前值不在推荐列表时补一条（WSL 对未知值有回退语义，但必须让用户看见） */
function enumOptions(field: WslConfigField): Array<{ label: string; value: string }> {
  const current = textValue(field)
  const options = (field.options ?? []).map((o) => ({ label: o, value: o }))
  if (current && !(field.options ?? []).includes(current)) {
    options.unshift({ label: `${current}（当前值，不在推荐列表）`, value: current })
  }
  return options
}

function isCustomEnum(field: WslConfigField): boolean {
  const current = textValue(field)
  return !!current && !(field.options ?? []).includes(current)
}

function fieldValue(field: WslConfigField): boolean | string | number | undefined {
  const sec = conf.model.value[field.section] as Record<string, unknown>
  return sec?.[field.key] as boolean | string | number | undefined
}

function boolValue(field: WslConfigField): boolean {
  return fieldValue(field) === true
}

function numberValue(field: WslConfigField): number | null {
  const v = fieldValue(field)
  return typeof v === 'number' ? v : null
}

function textValue(field: WslConfigField): string {
  const v = fieldValue(field)
  return v === undefined || v === null ? '' : String(v)
}

function onBoolean(field: WslConfigField, on: boolean) {
  conf.setField(field.section, field.key, on)
}

function onText(field: WslConfigField, v: string) {
  if (v === '') {
    conf.clearField(field.section, field.key)
    return
  }
  conf.setField(field.section, field.key, v)
}

function onNumber(field: WslConfigField, v: number | null) {
  if (v === null) {
    conf.clearField(field.section, field.key)
    return
  }
  conf.setField(field.section, field.key, v)
}

function onEnum(field: WslConfigField, v: string | null) {
  if (!v) {
    conf.clearField(field.section, field.key)
    return
  }
  conf.setField(field.section, field.key, v)
}

function isSet(field: WslConfigField): boolean {
  return fieldValue(field) !== undefined
}

function clearKey(field: WslConfigField) {
  conf.clearField(field.section, field.key)
}

const diff = computed(() => conf.diff())
const hasChanges = computed(() => diff.value.some((d) => d.type !== 'same'))
const changeSummary = computed(() => {
  if (conf.mode.value === 'form') return summarizeWslConfigChanges(conf.pendingChanges())
  const adds = diff.value.filter((d) => d.type === 'add').length
  const dels = diff.value.filter((d) => d.type === 'del').length
  return `原始文本：+${adds} / -${dels} 行`
})

function openPreview() {
  if (blockedByFields.value) {
    message.warning('存在格式非法的字段，请先修正')
    return
  }
  preview.value = true
}

async function confirmSave() {
  preview.value = false
  try {
    await conf.save()
    message.success('全局配置已保存 · 执行「立即重启 WSL」或完全停止所有发行版后约 8 秒生效')
    emit('saved')
  } catch (e) {
    message.error(errorLine(e, '保存 .wslconfig 失败'))
  }
}

/** 「重新载入」前先过脏编辑确认（防静默丢编辑） */
function confirmDiscard(): Promise<boolean> {
  if (!conf.isDirty.value) return Promise.resolve(true)
  return new Promise((resolve) => {
    dialog.warning({
      title: '放弃未保存的修改？',
      content: '.wslconfig 有未保存的修改，离开将丢失。',
      positiveText: '放弃修改',
      negativeText: '留在此页',
      onPositiveClick: () => resolve(true),
      onNegativeClick: () => resolve(false),
      onClose: () => resolve(false),
    })
  })
}

async function onReload() {
  if (!(await confirmDiscard())) return
  await conf.load()
}

function openDir() {
  const path = conf.filePath.value
  const dir = path ? path.slice(0, Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'))) : ''
  if (!dir) {
    message.warning('无法定位 .wslconfig 所在目录')
    return
  }
  void window.wslAPI.app.openPath(dir).catch(() => message.error('无法打开目录'))
}

/** 立即重启 WSL 使配置生效（wsl --shutdown；无需提权） */
function shutdownNow() {
  dialog.warning({
    title: '立即重启 WSL',
    content: '将执行 wsl --shutdown，关闭所有运行中的发行版与终端会话，确定吗？',
    positiveText: '立即重启',
    negativeText: '取消',
    onPositiveClick: async () => {
      shutdownBusy.value = true
      try {
        await window.wslAPI.distros.shutdown()
        message.success('WSL 已重启，全局配置已生效')
      } catch (e) {
        message.error(errorLine(e, '重启 WSL 失败'))
      } finally {
        shutdownBusy.value = false
      }
    },
  })
}
</script>

<template>
  <section class="card wslconfig-card">
    <div class="head">
      <div>
        <h2 class="panel-title">WSL 全局配置（.wslconfig）</h2>
        <p class="sub">
          路径 <code>{{ conf.filePath.value || '%UserProfile%\\.wslconfig' }}</code>
          <n-tag
            v-if="!conf.loading.value && !conf.exists.value"
            size="tiny"
            :bordered="false"
            type="info"
          >
            文件不存在（保存后创建）
          </n-tag>
        </p>
      </div>
      <div class="head-actions">
        <n-button
          size="small"
          quaternary
          :disabled="conf.loading.value"
          :loading="conf.loading.value"
          @click="onReload"
        >
          重新载入
        </n-button>
        <n-button
          size="small"
          type="primary"
          :disabled="!conf.isDirty.value || blockedByFields"
          :loading="conf.saving.value"
          @click="openPreview"
        >
          预览并保存
        </n-button>
      </div>
    </div>

    <p class="hint">
      影响<strong>全部发行版</strong>与 WSL 虚拟机整体 · 保存为宿主文件（无需管理员权限）· 变更需
      <code>wsl --shutdown</code> 后约 8 秒生效 · <Kbd :keys="['Esc']" /> 关闭弹层
    </p>

    <p v-if="conf.error.value" class="error">{{ conf.error.value }}</p>

    <div class="modes" role="tablist" aria-label="编辑模式">
      <button
        class="mode-btn"
        :class="{ active: conf.mode.value === 'form' }"
        role="tab"
        :aria-selected="conf.mode.value === 'form'"
        @click="conf.setMode('form')"
      >
        可视化表单
      </button>
      <button
        class="mode-btn"
        :class="{ active: conf.mode.value === 'raw' }"
        role="tab"
        :aria-selected="conf.mode.value === 'raw'"
        @click="conf.setMode('raw')"
      >
        原始文本
      </button>
    </div>

    <!-- 可视化表单 -->
    <div v-if="conf.mode.value === 'form'" class="form">
      <section v-for="s in sections" :key="s.name" class="group">
        <h3 class="group-title">{{ sectionTitle(s.name) }}</h3>
        <div v-for="f in s.fields" :key="`${f.section}.${f.key}`" class="field">
          <div class="field-label">
            <span>{{ f.label }}</span>
            <code class="key">{{ f.section }}.{{ f.key }}</code>
            <button
              v-if="isSet(f)"
              class="clear-btn"
              :aria-label="`清除 ${f.section}.${f.key}`"
              title="清除该键"
              @click="clearKey(f)"
            >
              ×
            </button>
          </div>
          <div class="field-control">
            <n-switch
              v-if="f.type === 'boolean'"
              :value="boolValue(f)"
              @update:value="(v: boolean) => onBoolean(f, v)"
            />
            <n-input-number
              v-else-if="f.type === 'number'"
              :value="numberValue(f)"
              size="small"
              :placeholder="f.placeholder ?? ''"
              :min="f.min ?? 1"
              :max="f.max ?? 256"
              @update:value="(v: number | null) => onNumber(f, v)"
            />
            <n-select
              v-else-if="f.type === 'enum'"
              :value="textValue(f) || null"
              size="small"
              clearable
              :filterable="f.allowCustom === true"
              :tag="f.allowCustom === true"
              :options="enumOptions(f)"
              :placeholder="f.placeholder ?? '未设置'"
              @update:value="(v: string | null) => onEnum(f, v)"
            />
            <n-input
              v-else
              :value="textValue(f)"
              size="small"
              :placeholder="f.placeholder ?? '未设置'"
              @update:value="(v: string) => onText(f, v)"
            />
          </div>
          <div v-if="f.hint" class="field-hint">{{ f.hint }}</div>
          <div v-if="f.type === 'enum' && isCustomEnum(f)" class="field-hint warn">
            当前值不在推荐列表；WSL 对未知值有回退语义，保存不会被阻止。
          </div>
          <div v-if="conf.fieldError(f)" class="field-error">{{ conf.fieldError(f) }}</div>
        </div>
      </section>

      <div v-if="conf.unknownKeys.value.length" class="unknown">
        <div class="unknown-title">其他设置（表单未覆盖，保存时原样保留）</div>
        <n-tag v-for="u in conf.unknownKeys.value" :key="`${u.section}.${u.key}`" size="small">
          {{ u.section }}.{{ u.key }} = {{ u.value }}
        </n-tag>
      </div>
    </div>

    <!-- 原始文本 -->
    <div v-else class="raw">
      <CodeEditor
        :model-value="conf.raw.value"
        placeholder="# .wslconfig — 支持 # 注释；例如 [wsl2] memory=8GB"
        :min-height="300"
        @update:model-value="(v: string) => conf.setRaw(v)"
      />
    </div>

    <div class="footer-row">
      <n-button size="small" secondary @click="openDir">打开所在目录</n-button>
      <n-button
        size="small"
        secondary
        :loading="shutdownBusy"
        :disabled="shutdownBusy"
        @click="shutdownNow"
      >
        立即重启 WSL（wsl --shutdown）
      </n-button>
    </div>

    <!-- 差异预览 -->
    <n-modal
      v-model:show="previewOpen"
      preset="card"
      title="变更预览 · .wslconfig"
      class="diff-modal"
      :style="{ width: '640px', maxWidth: '94vw', maxHeight: '90vh' }"
      :content-style="{ overflow: 'auto' }"
    >
      <div v-if="!hasChanges" class="diff-empty">没有需要写入的变更</div>
      <div v-else class="diff">
        <div class="diff-summary">{{ changeSummary }}</div>
        <div v-for="(d, i) in diff" :key="i" class="diff-line" :class="d.type">
          <span class="sign">{{ d.type === 'add' ? '+' : d.type === 'del' ? '-' : ' ' }}</span>
          <span class="text">{{ d.text || ' ' }}</span>
        </div>
      </div>
      <template #footer>
        <div class="diff-footer">
          <n-button quaternary @click="preview = false">取消</n-button>
          <n-button type="primary" :disabled="!hasChanges" @click="confirmSave">确认写入</n-button>
        </div>
      </template>
    </n-modal>
  </section>
</template>

<style scoped>
.wslconfig-card {
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
  flex-wrap: wrap;
}

.head-actions {
  display: flex;
  gap: 8px;
  flex-shrink: 0;
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

.hint {
  margin: 0;
  font-size: 11.5px;
  color: var(--color-text-tertiary);
  line-height: 1.7;
}

.error {
  margin: 0;
  padding: 8px 12px;
  border-radius: 8px;
  background: color-mix(in srgb, var(--color-danger) 10%, transparent);
  color: var(--color-danger);
  font-size: 12px;
}

.modes {
  display: inline-flex;
  border: 1px solid var(--color-border-default);
  border-radius: 9px;
  overflow: hidden;
  align-self: flex-start;
}

.mode-btn {
  padding: 5px 14px;
  font-size: 12.5px;
  color: var(--color-text-secondary);
  background: var(--color-bg-surface);
}

.mode-btn.active {
  background: var(--color-accent-soft);
  color: var(--color-accent);
  font-weight: 600;
}

.group {
  border: 1px solid var(--color-border-subtle);
  border-radius: var(--radius-md);
  padding: 10px 14px;
  margin-bottom: 10px;
}

.group-title {
  margin: 0 0 6px;
  font-size: 12px;
  font-weight: 650;
  color: var(--color-text-secondary);
  font-family: var(--font-mono, monospace);
}

.field {
  display: grid;
  grid-template-columns: 1fr 220px;
  gap: 4px 12px;
  align-items: center;
  padding: 7px 0;
}

.field + .field {
  border-top: 1px dashed var(--color-border-subtle);
}

.field-label {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12.5px;
  color: var(--color-text-primary);
}

.field-label .key {
  font-size: 10.5px;
  color: var(--color-text-tertiary);
  background: var(--color-bg-sunken);
  padding: 1px 6px;
  border-radius: 4px;
}

.clear-btn {
  width: 18px;
  height: 18px;
  border-radius: 50%;
  color: var(--color-text-tertiary);
  font-size: 13px;
  line-height: 1;
}

.clear-btn:hover {
  background: var(--color-danger);
  color: #fff;
}

.field-hint {
  grid-column: 1 / -1;
  font-size: 11px;
  color: var(--color-text-tertiary);
}

.field-hint.warn {
  color: var(--color-warning);
}

.field-error {
  grid-column: 1 / -1;
  font-size: 11.5px;
  color: var(--color-danger);
}

.unknown {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  padding: 10px 12px;
  border: 1px dashed var(--color-border-default);
  border-radius: var(--radius-md);
}

.unknown-title {
  width: 100%;
  font-size: 11.5px;
  color: var(--color-text-tertiary);
}

.footer-row {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
}

.diff {
  max-height: 380px;
  overflow: auto;
  border: 1px solid var(--color-border-subtle);
  border-radius: var(--radius-sm);
  font-family: var(--font-mono, monospace);
  font-size: 12px;
}

.diff-line {
  display: flex;
  gap: 8px;
  padding: 1px 10px;
  white-space: pre-wrap;
  word-break: break-all;
}

.diff-line.add {
  background: color-mix(in srgb, var(--color-success) 12%, transparent);
  color: var(--color-success);
}

.diff-line.del {
  background: color-mix(in srgb, var(--color-danger) 10%, transparent);
  color: var(--color-danger);
}

.diff-line.same {
  color: var(--color-text-tertiary);
}

.sign {
  width: 12px;
  flex-shrink: 0;
}

.diff-empty {
  padding: 24px;
  text-align: center;
  color: var(--color-text-tertiary);
}

.diff-summary {
  padding: 4px 10px 8px;
  margin-bottom: 6px;
  font-size: 12px;
  color: var(--color-text-tertiary);
  border-bottom: 1px solid var(--color-divider);
}

.diff-footer {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}
</style>
