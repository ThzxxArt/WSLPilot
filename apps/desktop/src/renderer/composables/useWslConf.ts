import { computed, ref, type ComputedRef, type Ref } from 'vue'
import {
  applyWslConfModel,
  collectUnknownKeys,
  diffLines,
  emptyWslConfModel,
  parseWslConf,
  type DiffLine,
  type WslConfChange,
  type WslConfModel,
} from '@shared/wslconf'

export type WslConfMode = 'form' | 'raw'

export interface WslConfApi {
  read(name: string): Promise<string>
  write(name: string, content: string): Promise<{ terminated: boolean }>
}

export interface WslConfEditor {
  loading: Ref<boolean>
  saving: Ref<boolean>
  error: Ref<string>
  mode: Ref<WslConfMode>
  /** 原始文本编辑缓冲（raw 模式） */
  raw: Ref<string>
  /** 表单模型（form 模式） */
  model: Ref<WslConfModel>
  isDirty: ComputedRef<boolean>
  unknownKeys: ComputedRef<Array<{ section: string; key: string; value: string }>>
  load(): Promise<void>
  setMode(m: WslConfMode): void
  setField(section: string, key: string, value: boolean | string | number | undefined): void
  clearField(section: string, key: string): void
  setRaw(text: string): void
  /** 当前将要保存的文本 */
  effectiveText(): string
  /** 相对磁盘载入内容的变更清单（form 模式） */
  pendingChanges(): WslConfChange[]
  diff(): DiffLine[]
  save(): Promise<{ terminated: boolean }>
}

function defaultApi(): WslConfApi {
  const api = (globalThis as { window?: { wslAPI?: unknown } }).window?.wslAPI as
    { wslconf?: WslConfApi } | undefined
  if (!api?.wslconf) {
    return {
      read: async () => '',
      write: async () => ({ terminated: false }),
    }
  }
  return api.wslconf
}

/**
 * /etc/wsl.conf 编辑状态机（M5）。
 * 双模式：form（可视化表单）⇄ raw（原始文本）。
 * 防丢注释：form 编辑对 baseline 做最小编辑（applyWslConfModel）；
 * 未知键只展示不吞掉。删除语义：字符串置空串 / clearField 显式标记。
 */
export function useWslConf(
  distroName: Ref<string> | (() => string) | string,
  opts: { api?: WslConfApi } = {},
): WslConfEditor {
  const api = opts.api ?? defaultApi()
  const nameOf = () =>
    typeof distroName === 'function'
      ? distroName()
      : typeof distroName === 'string'
        ? distroName
        : distroName.value

  const loading = ref(false)
  const saving = ref(false)
  const error = ref('')
  const mode = ref<WslConfMode>('form')
  const raw = ref('')
  const model = ref<WslConfModel>(emptyWslConfModel())
  const removeKeys = ref<string[]>([])
  /** 表单模型对应的基线文本 */
  const baseline = ref('')
  /** 最近一次从磁盘载入/保存的文本 */
  const diskText = ref('')

  const isDirty = computed(() => effectiveText() !== diskText.value)
  const unknownKeys = computed(() => collectUnknownKeys(effectiveText()))

  function effectiveText(): string {
    if (mode.value === 'raw') return raw.value
    return applyWslConfModel(baseline.value, model.value, {
      removeKeys: removeKeys.value,
    }).text
  }

  function pendingChanges(): WslConfChange[] {
    return applyWslConfModel(baseline.value, model.value, { removeKeys: removeKeys.value }).changes
  }

  async function load(): Promise<void> {
    const name = nameOf()
    if (!name) return
    loading.value = true
    error.value = ''
    try {
      const text = await api.read(name)
      diskText.value = text
      baseline.value = text
      raw.value = text
      model.value = parseWslConf(text)
      removeKeys.value = []
    } catch (e) {
      error.value = e instanceof Error ? e.message : String(e)
    } finally {
      loading.value = false
    }
  }

  function setMode(m: WslConfMode): void {
    if (m === mode.value) return
    if (m === 'raw') {
      raw.value = effectiveText()
    } else {
      // raw → form：把 raw 编辑并入基线，再解析表单模型
      baseline.value = raw.value
      model.value = parseWslConf(raw.value)
      removeKeys.value = []
    }
    mode.value = m
  }

  function setField(
    section: string,
    key: string,
    value: boolean | string | number | undefined,
  ): void {
    const sec = model.value[section as keyof WslConfModel] as Record<string, unknown>
    if (!sec) return
    if (value === undefined) {
      delete sec[key]
    } else {
      sec[key] = value
    }
    removeKeys.value = removeKeys.value.filter((k) => k !== `${section}.${key}`)
  }

  function clearField(section: string, key: string): void {
    const sec = model.value[section as keyof WslConfModel] as Record<string, unknown>
    if (sec) delete sec[key]
    const id = `${section}.${key}`
    if (!removeKeys.value.includes(id)) removeKeys.value.push(id)
  }

  function setRaw(text: string): void {
    raw.value = text
    if (mode.value === 'form') {
      // 表单模式下的 raw 直写（外部粘贴）→ 重建模型
      baseline.value = text
      model.value = parseWslConf(text)
      removeKeys.value = []
    }
  }

  async function save(): Promise<{ terminated: boolean }> {
    const name = nameOf()
    const text = effectiveText()
    saving.value = true
    error.value = ''
    try {
      const result = await api.write(name, text)
      diskText.value = text
      baseline.value = text
      raw.value = text
      model.value = parseWslConf(text)
      removeKeys.value = []
      return result
    } catch (e) {
      error.value = e instanceof Error ? e.message : String(e)
      throw e
    } finally {
      saving.value = false
    }
  }

  return {
    loading,
    saving,
    error,
    mode,
    raw,
    model,
    isDirty,
    unknownKeys,
    load,
    setMode,
    setField,
    clearField,
    setRaw,
    effectiveText,
    pendingChanges,
    diff: () => diffLines(diskText.value, effectiveText()),
    save,
  }
}
