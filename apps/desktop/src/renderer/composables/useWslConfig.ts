import { computed, ref, type ComputedRef, type Ref } from 'vue'
import {
  applyWslConfigModel,
  collectUnknownWslConfigKeys,
  diffLines,
  emptyWslConfigModel,
  formatErrorLine,
  isSameText,
  parseWslConfigModel,
  validateWslConfigValue,
  WSL_CONFIG_FIELDS,
  type DiffLine,
  type WslConfChange,
  type WslConfigField,
  type WslConfigFileState,
  type WslConfigModel,
} from '@wslpilot/shared'

export type WslConfigMode = 'form' | 'raw'

export interface WslConfigApi {
  read(): Promise<WslConfigFileState>
  write(content: string): Promise<{ path: string }>
}

export interface WslConfigEditor {
  loading: Ref<boolean>
  saving: Ref<boolean>
  error: Ref<string>
  mode: Ref<WslConfigMode>
  /** 文件绝对路径（读取后可知；未读取时为空） */
  filePath: Ref<string>
  /** 文件是否存在（不存在 = 默认配置） */
  exists: Ref<boolean>
  /** 原始文本编辑缓冲（raw 模式） */
  raw: Ref<string>
  /** 表单模型（form 模式） */
  model: Ref<WslConfigModel>
  isDirty: ComputedRef<boolean>
  unknownKeys: ComputedRef<Array<{ section: string; key: string; value: string }>>
  load(): Promise<void>
  setMode(m: WslConfigMode): void
  setField(section: string, key: string, value: boolean | string | number | undefined): void
  clearField(section: string, key: string): void
  setRaw(text: string): void
  /** 当前将要保存的文本 */
  effectiveText(): string
  /** 相对磁盘载入内容的变更清单（form 模式） */
  pendingChanges(): WslConfChange[]
  diff(): DiffLine[]
  /** 单字段校验错误（表单实时提示；null = 合法） */
  fieldError(field: WslConfigField): string | null
  /** 全部字段校验错误（阻止保存） */
  hasFieldErrors: ComputedRef<boolean>
  save(): Promise<{ path: string }>
}

function defaultApi(): WslConfigApi {
  const api = (globalThis as { window?: { wslAPI?: unknown } }).window?.wslAPI as
    { wslconfig?: WslConfigApi } | undefined
  if (!api?.wslconfig) {
    return {
      read: async () => ({ path: '', exists: false, content: '' }),
      write: async () => ({ path: '' }),
    }
  }
  return api.wslconfig
}

/**
 * `%UserProfile%\.wslconfig` 编辑状态机（0.1.3）。
 * 双模式：form（可视化表单）⇄ raw（原始文本）。
 * 防丢注释：form 编辑对 baseline 做最小编辑（applyWslConfigModel）；
 * 未知键只展示不吞掉。删除语义：字符串置空串 / clearField 显式标记。
 */
export function useWslConfig(opts: { api?: WslConfigApi } = {}): WslConfigEditor {
  const api = opts.api ?? defaultApi()

  const loading = ref(false)
  const saving = ref(false)
  const error = ref('')
  const mode = ref<WslConfigMode>('form')
  const raw = ref('')
  const model = ref<WslConfigModel>(emptyWslConfigModel())
  const removeKeys = ref<string[]>([])
  const filePath = ref('')
  const exists = ref(false)
  /** 表单模型对应的基线文本 */
  const baseline = ref('')
  /** 最近一次从磁盘载入/保存的文本 */
  const diskText = ref('')
  /** 代际守卫：并发 load/save 时旧响应不得写入 */
  let gen = 0

  // 快路径精确比较；差异仅换行/结尾时用行级比较兜底（避免无意义写盘）
  const isDirty = computed(() => {
    const a = effectiveText()
    const b = diskText.value
    return a !== b && !isSameText(a, b)
  })
  const unknownKeys = computed(() => collectUnknownWslConfigKeys(effectiveText()))

  function effectiveText(): string {
    if (mode.value === 'raw') return raw.value
    return applyWslConfigModel(baseline.value, model.value, {
      removeKeys: removeKeys.value,
    }).text
  }

  function pendingChanges(): WslConfChange[] {
    return applyWslConfigModel(baseline.value, model.value, { removeKeys: removeKeys.value })
      .changes
  }

  function fieldError(field: WslConfigField): string | null {
    const v = (model.value[field.section] as Record<string, unknown>)[field.key]
    if (v === undefined) return null
    return validateWslConfigValue(field, String(v))
  }

  const hasFieldErrors = computed(() => WSL_CONFIG_FIELDS.some((f) => fieldError(f) !== null))

  async function load(): Promise<void> {
    const g = ++gen
    loading.value = true
    error.value = ''
    try {
      const state = await api.read()
      if (g !== gen) return
      filePath.value = state.path
      exists.value = state.exists
      diskText.value = state.content
      baseline.value = state.content
      raw.value = state.content
      model.value = parseWslConfigModel(state.content)
      removeKeys.value = []
    } catch (e) {
      if (g !== gen) return
      error.value = formatErrorLine(e, '读取 .wslconfig 失败')
    } finally {
      if (g === gen) loading.value = false
    }
  }

  function setMode(m: WslConfigMode): void {
    if (m === mode.value) return
    if (m === 'raw') {
      raw.value = effectiveText()
    } else {
      // raw → form：把 raw 编辑并入基线，再解析表单模型
      baseline.value = raw.value
      model.value = parseWslConfigModel(raw.value)
      removeKeys.value = []
    }
    mode.value = m
  }

  function setField(
    section: string,
    key: string,
    value: boolean | string | number | undefined,
  ): void {
    const sec = model.value[section as keyof WslConfigModel] as Record<string, unknown>
    if (!sec) return
    if (value === undefined) {
      delete sec[key]
    } else {
      sec[key] = value
    }
    removeKeys.value = removeKeys.value.filter((k) => k !== `${section}.${key}`)
  }

  function clearField(section: string, key: string): void {
    const sec = model.value[section as keyof WslConfigModel] as Record<string, unknown>
    if (sec) delete sec[key]
    const id = `${section}.${key}`
    if (!removeKeys.value.includes(id)) removeKeys.value.push(id)
  }

  function setRaw(text: string): void {
    raw.value = text
    if (mode.value === 'form') {
      // 表单模式下的 raw 直写（外部粘贴）→ 重建模型
      baseline.value = text
      model.value = parseWslConfigModel(text)
      removeKeys.value = []
    }
  }

  async function save(): Promise<{ path: string }> {
    const text = effectiveText()
    const g = ++gen
    saving.value = true
    error.value = ''
    try {
      const result = await api.write(text)
      if (g === gen) {
        filePath.value = result.path || filePath.value
        exists.value = true
        diskText.value = text
        baseline.value = text
        raw.value = text
        model.value = parseWslConfigModel(text)
        removeKeys.value = []
      }
      return result
    } catch (e) {
      if (g === gen) error.value = formatErrorLine(e, '保存 .wslconfig 失败')
      throw e
    } finally {
      if (g === gen) saving.value = false
    }
  }

  return {
    loading,
    saving,
    error,
    mode,
    filePath,
    exists,
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
    fieldError,
    hasFieldErrors,
    save,
  }
}
