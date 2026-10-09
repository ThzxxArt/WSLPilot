<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { NButton, NInput, NInputNumber, NSwitch, NTag, NModal, useMessage } from 'naive-ui'
import { CodeEditor, Kbd } from '@ui/components'
import { WSL_CONF_FIELDS, type DiffLine, type WslConfFieldType } from '@shared/wslconf'
import { useWslConf } from '../../composables/useWslConf'
import { errorLine } from '../../composables/useAppError'

const props = defineProps<{ distroName: string }>()

const message = useMessage()
const conf = useWslConf(() => props.distroName)

const preview = ref(false)
const previewOpen = computed({
  get: () => preview.value,
  set: (v: boolean) => (preview.value = v),
})

onMounted(() => void conf.load())
watch(
  () => props.distroName,
  () => void conf.load(),
)

const sections = computed(() => {
  const map = new Map<string, typeof WSL_CONF_FIELDS>()
  for (const f of WSL_CONF_FIELDS) {
    const list = map.get(f.section) ?? []
    list.push(f)
    map.set(f.section, list)
  }
  return [...map.entries()].map(([name, fields]) => ({ name, fields }))
})

function sectionTitle(name: string): string {
  switch (name) {
    case 'automount':
      return '[automount] 挂载'
    case 'network':
      return '[network] 网络'
    case 'interop':
      return '[interop] 互操作'
    case 'user':
      return '[user] 用户'
    case 'boot':
      return '[boot] 启动'
    default:
      return `[${name}]`
  }
}

function fieldValue(section: string, key: string, type: WslConfFieldType) {
  const sec = conf.model.value[section as keyof typeof conf.model.value] as Record<string, unknown>
  const v = sec?.[key]
  if (type === 'boolean') return v === true
  return (v as string | number | undefined) ?? null
}

function boolValue(section: string, key: string): boolean {
  return fieldValue(section, key, 'boolean') === true
}

function numberValue(section: string, key: string): number | null {
  const v = fieldValue(section, key, 'number')
  return typeof v === 'number' ? v : null
}

function stringValue(section: string, key: string): string {
  const v = fieldValue(section, key, 'string')
  return v == null ? '' : String(v)
}

function onBoolean(section: string, key: string, on: boolean) {
  conf.setField(section, key, on)
}

function onText(section: string, key: string, v: string) {
  if (v === '') {
    conf.clearField(section, key)
    return
  }
  conf.setField(section, key, v)
}

function onNumber(section: string, key: string, v: number | null) {
  if (v === null) {
    conf.clearField(section, key)
    return
  }
  conf.setField(section, key, v)
}

function isSet(section: string, key: string): boolean {
  const sec = conf.model.value[section as keyof typeof conf.model.value] as Record<string, unknown>
  return sec?.[key] !== undefined
}

function clearKey(section: string, key: string) {
  conf.clearField(section, key)
}

const diff = computed<DiffLine[]>(() => conf.diff())
const hasChanges = computed(() => diff.value.some((d) => d.type !== 'same'))

function openPreview() {
  preview.value = true
}

async function confirmSave() {
  preview.value = false
  try {
    const r = await conf.save()
    message.success(
      r.terminated
        ? 'wsl.conf 已保存 · 已按设置终止该发行版，约 8 秒后重新启动生效'
        : 'wsl.conf 已保存 · 完全停止发行版后（约 8 秒）生效',
    )
  } catch (e) {
    message.error(errorLine(e, '保存 wsl.conf 失败'))
  }
}
</script>

<template>
  <div class="wslconf-panel">
    <div class="toolbar">
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
      <div class="toolbar-actions">
        <n-button size="small" quaternary :loading="conf.loading.value" @click="conf.load()">
          重新载入
        </n-button>
        <n-button
          size="small"
          type="primary"
          :disabled="!conf.isDirty.value"
          :loading="conf.saving.value"
          @click="openPreview"
        >
          预览并保存
        </n-button>
      </div>
    </div>

    <p v-if="conf.error.value" class="error">{{ conf.error.value }}</p>
    <p class="hint">
      <code>/etc/wsl.conf</code> — 发行版级配置 · 保存需发行版内 root · 变更在发行版完全停止后约 8
      秒生效 · <Kbd :keys="['Esc']" /> 关闭弹层
    </p>

    <!-- 可视化表单 -->
    <div v-if="conf.mode.value === 'form'" class="form">
      <section v-for="s in sections" :key="s.name" class="group">
        <h3 class="group-title">{{ sectionTitle(s.name) }}</h3>
        <div v-for="f in s.fields" :key="`${f.section}.${f.key}`" class="field">
          <div class="field-label">
            <span>{{ f.label }}</span>
            <code class="key">{{ f.section }}.{{ f.key }}</code>
            <button
              v-if="isSet(f.section, f.key)"
              class="clear-btn"
              :aria-label="`清除 ${f.section}.${f.key}`"
              title="清除该键"
              @click="clearKey(f.section, f.key)"
            >
              ×
            </button>
          </div>
          <div class="field-control">
            <n-switch
              v-if="f.type === 'boolean'"
              :value="boolValue(f.section, f.key)"
              @update:value="(v: boolean) => onBoolean(f.section, f.key, v)"
            />
            <n-input-number
              v-else-if="f.type === 'number'"
              :value="numberValue(f.section, f.key)"
              size="small"
              :placeholder="f.placeholder ?? ''"
              @update:value="(v: number | null) => onNumber(f.section, f.key, v)"
            />
            <n-input
              v-else
              :value="stringValue(f.section, f.key)"
              size="small"
              :placeholder="f.placeholder ?? '未设置'"
              @update:value="(v: string) => onText(f.section, f.key, v)"
            />
          </div>
          <div v-if="f.hint" class="field-hint">{{ f.hint }}</div>
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
        placeholder="# /etc/wsl.conf — 支持注释"
        :min-height="320"
        @update:model-value="(v: string) => conf.setRaw(v)"
      />
    </div>

    <!-- 差异预览 -->
    <n-modal
      v-model:show="previewOpen"
      preset="card"
      title="变更预览 · /etc/wsl.conf"
      class="diff-modal"
    >
      <div v-if="!hasChanges" class="diff-empty">没有需要写入的变更</div>
      <div v-else class="diff">
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
  </div>
</template>

<style scoped>
.wslconf-panel {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.modes {
  display: inline-flex;
  border: 1px solid var(--color-border-default);
  border-radius: 9px;
  overflow: hidden;
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

.toolbar-actions {
  display: flex;
  gap: 8px;
}

.hint {
  margin: 0;
  font-size: 11.5px;
  color: var(--color-text-tertiary);
}

.error {
  margin: 0;
  padding: 8px 12px;
  border-radius: 8px;
  background: color-mix(in srgb, var(--color-danger) 10%, transparent);
  color: var(--color-danger);
  font-size: 12px;
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

.diff-modal {
  width: 640px;
  max-width: 92vw;
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

.diff-footer {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}
</style>
