<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { NButton, NSpin, NTag, useDialog, useMessage } from 'naive-ui'
import { CodeEditor } from '@wslpilot/ui'
import { FS_READ_LIMIT_BYTES, type DirEntry } from '@wslpilot/shared'
import { useDistrosStore } from '../../stores/distros'
import { errorLine } from '../../composables/useAppError'

const props = defineProps<{ distroName: string }>()
const emit = defineEmits<{
  /** 切发行版被取消时要求父级还原选择（与 WslConfPanel 对齐，脏编辑保留在原发行版上） */
  'restore-distro': [name: string]
}>()

const message = useMessage()
const dialog = useDialog()
const distros = useDistrosStore()
/** 运行状态门禁（review：进文件页即启动发行版根治）：读取绝不隐式启动发行版 */
const isRunning = computed(() => distros.byName(props.distroName)?.state === 'Running')
const path = ref('/')
const entries = ref<DirEntry[]>([])
const loading = ref(false)
const error = ref('')
const file = ref<{
  path: string
  text: string
  dirty: boolean
  truncated: boolean
  binary: boolean
  sizeBytes: number
  /** 文件所属发行版：保存前校验，防跨发行版串写（review 0.1.2 根治） */
  distro: string
} | null>(null)
const saving = ref(false)

/** 当前已载入内容的发行版（取消切换时据此还原选择） */
const currentName = ref(props.distroName)

/** 未保存修改的丢弃确认（§13.4 破坏性操作二次确认） */
function confirmDiscard(): Promise<boolean> {
  if (!file.value?.dirty) return Promise.resolve(true)
  return new Promise((resolve) => {
    dialog.warning({
      title: '放弃未保存的修改？',
      content: `「${file.value!.path}」有未保存的修改，离开将丢失。`,
      positiveText: '放弃修改',
      negativeText: '留在此页',
      onPositiveClick: () => resolve(true),
      onNegativeClick: () => resolve(false),
      onClose: () => resolve(false),
    })
  })
}

const crumbs = computed(() => {
  const segs = path.value.split('/').filter(Boolean)
  const list: Array<{ name: string; path: string }> = [{ name: '根 /', path: '/' }]
  let acc = ''
  for (const s of segs) {
    acc += `/${s}`
    list.push({ name: s, path: acc })
  }
  return list
})

/**
 * 真正的加载动作（不做确认）。
 * 确认必须由调用方**在改动 path/file 之前**完成 —— 否则用户点「留在此页」时
 * path 已经变了，面包屑与列表不一致（review 自查发现）。
 * 代际守卫：快速进出目录时旧响应不得覆盖新目录（review 0.1.2 根治）。
 */
let loadGen = 0
async function reload() {
  if (!props.distroName) return
  // 未运行不读（fs 走 wsl -d X -e，会隐式启动发行版）— review 状态门禁
  if (!isRunning.value) {
    entries.value = []
    file.value = null
    loading.value = false
    return
  }
  const g = ++loadGen
  const target = currentName.value
  loading.value = true
  error.value = ''
  file.value = null
  try {
    const list = await window.wslAPI.fs.readDir(target, path.value)
    if (g !== loadGen) return
    entries.value = list
  } catch (e) {
    if (g !== loadGen) return
    error.value = errorLine(e, '读取目录失败')
    entries.value = []
  } finally {
    if (g === loadGen) loading.value = false
  }
}

// 发行版启动后自动载入（详情弹框内点「启动」→ 文件页即时可用）
watch(isRunning, (running) => {
  if (running && entries.value.length === 0 && !file.value) void reload()
})

/** 刷新当前目录（保留未保存确认；保存中冻结导航，防 await 期间引用失效） */
async function load() {
  if (saving.value) return
  if (!(await confirmDiscard())) return
  await reload()
}

async function goTo(p: string) {
  if (saving.value) return
  // 先确认再改 path：取消时面包屑不许动
  if (!(await confirmDiscard())) return
  path.value = p
  await reload()
}

async function enter(e: DirEntry) {
  if (saving.value) return
  if (!(await confirmDiscard())) return
  if (e.isDirectory) {
    path.value = e.path
    await reload()
    return
  }
  try {
    const r = await window.wslAPI.fs.read(currentName.value, e.path)
    file.value = {
      path: e.path,
      text: r.binary ? '' : r.text,
      dirty: false,
      truncated: r.truncated,
      binary: r.binary,
      sizeBytes: r.sizeBytes,
      distro: currentName.value,
    }
  } catch (err) {
    message.error(errorLine(err, '读取文件失败'))
  }
}

async function saveFile() {
  // 局部快照：await 期间 file.value 可能被导航/切换清空，绝不裸引用
  // （review 0.1.2 根治「保存后引用已置空 → TypeError 假失败」）
  const f = file.value
  if (!f) return
  // 超限截断的文件禁止写回：保存会把前缀整文件覆盖回去，静默毁掉剩余内容
  if (f.truncated) {
    message.warning('该文件超过在线编辑上限，禁止写回以免截断原文件')
    return
  }
  // 跨发行版串写防护：文件属于哪个发行版就写回哪个（review 0.1.2 根治）
  if (f.distro !== props.distroName) {
    message.warning('发行版已切换，已阻止跨发行版写回；请重新打开文件后再保存')
    return
  }
  saving.value = true
  try {
    await window.wslAPI.fs.write(f.distro, f.path, f.text)
    // 保存期间视图若已被替换，只提示成功，不把脏标记落到别人的文件上
    if (file.value === f) f.dirty = false
    message.success(`已保存 ${f.path}`)
  } catch (e) {
    message.error(errorLine(e, '写入文件失败'))
  } finally {
    saving.value = false
  }
}

function onEdit(v: string) {
  if (file.value && !file.value.truncated) {
    file.value.text = v
    file.value.dirty = true
  }
}

async function closeFile() {
  // 保存中禁用返回：避免在途写入的对象被卸载（review 0.1.2 根治）
  if (saving.value) return
  if (!(await confirmDiscard())) return
  file.value = null
}

async function reveal(target: string) {
  try {
    await window.wslAPI.fs.revealInExplorer(currentName.value, target)
  } catch (e) {
    message.error(errorLine(e, '打开资源管理器失败'))
  }
}

function formatSize(e: DirEntry): string {
  if (e.isDirectory) return '—'
  const n = e.size ?? 0
  if (n >= 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`
  if (n >= 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${n} B`
}

function formatTime(e: DirEntry): string {
  return e.modifiedAt ? e.modifiedAt.slice(0, 19).replace('T', ' ') : '—'
}

onMounted(load)
watch(
  () => props.distroName,
  async (name) => {
    if (!name || name === currentName.value) return
    // 发行版切换同样先确认；取消时回退父级选择（与 WslConfPanel 对齐，绝不静默丢文件编辑）
    // — review 0.1.2 根治：此前仅 return，父级停在未载入的新发行版上
    if (!(await confirmDiscard())) {
      emit('restore-distro', currentName.value)
      return
    }
    currentName.value = name
    path.value = '/'
    await reload()
  },
)

/**
 * 供父级（DistroDetailModal 关窗守卫）调用：有脏编辑时弹确认。
 * 没有这层暴露，用户在「文件」页未保存编辑时直接关弹窗，修改会静默丢失（review 根治）。
 */
defineExpose({ confirmDiscard })
</script>

<template>
  <div class="fs-panel">
    <div class="bar">
      <nav class="crumbs" aria-label="路径">
        <template v-for="(c, i) in crumbs" :key="c.path">
          <span v-if="i > 0" class="sep">/</span>
          <!-- 保存中冻结导航：写盘在途时不得切换路径（review 0.1.2 根治） -->
          <button
            class="crumb"
            :class="{ active: i === crumbs.length - 1 }"
            :disabled="saving"
            @click="goTo(c.path)"
          >
            {{ c.name }}
          </button>
        </template>
      </nav>
      <div class="bar-actions">
        <n-button size="tiny" quaternary :disabled="!isRunning || saving" @click="load()">
          刷新
        </n-button>
        <n-button size="tiny" quaternary :disabled="!isRunning || saving" @click="reveal(path)">
          资源管理器
        </n-button>
      </div>
    </div>

    <p v-if="!isRunning" class="hint">发行版未运行——启动后可浏览文件（读取不会隐式启动发行版）。</p>

    <p class="hint">
      通过 <code>\\wsl.localhost\{{ distroName }}</code> 访问（9p）· 需发行版处于运行状态 ·
      大目录/大文件加载较慢
    </p>

    <p v-if="error" class="error">{{ error }}</p>

    <n-spin :show="loading">
      <table v-if="!file" class="listing">
        <thead>
          <tr>
            <th>名称</th>
            <th class="num">大小</th>
            <th>修改时间</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="e in entries" :key="e.path">
            <td>
              <button class="entry" :disabled="saving" @click="enter(e)">
                <span class="icon">{{ e.isDirectory ? '📁' : '📄' }}</span>
                {{ e.name }}
              </button>
            </td>
            <td class="num">{{ formatSize(e) }}</td>
            <td>{{ formatTime(e) }}</td>
            <td>
              <n-button size="tiny" quaternary @click="reveal(e.path)">显示</n-button>
            </td>
          </tr>
          <tr v-if="entries.length === 0 && !loading">
            <td colspan="4" class="empty">空目录</td>
          </tr>
        </tbody>
      </table>

      <!-- 文件编辑 -->
      <div v-else class="editor">
        <div class="editor-bar">
          <span class="file-path">
            <button class="crumb" :disabled="saving" @click="closeFile">← 返回</button>
            {{ file.path }}
            <n-tag v-if="file.dirty" size="tiny" type="warning" :bordered="false">未保存</n-tag>
            <n-tag v-if="file.truncated" size="tiny" :bordered="false">超限截断</n-tag>
          </span>
          <div class="editor-actions">
            <n-button
              size="tiny"
              type="primary"
              :disabled="!file.dirty || file.binary || file.truncated || saving"
              :loading="saving"
              @click="saveFile"
            >
              保存
            </n-button>
          </div>
        </div>
        <p v-if="file.binary" class="hint">二进制文件不支持在线编辑，请在终端中处理。</p>
        <!-- 超限截断：只读渲染前缀，禁止保存 —— 否则会把截断后的内容整文件覆盖回去（review C1）。
             文案称「仅展示前缀」就必须真的展示，此前只提示不渲染（review 0.1.2 根治）。 -->
        <p v-if="file.truncated" class="hint">
          文件超过在线编辑上限（{{ Math.round(FS_READ_LIMIT_BYTES / 1024) }}KB），仅展示前缀。
          为避免保存时截断原文件，此处禁止编辑；请在终端中用 vim/nano 处理。
        </p>
        <CodeEditor
          v-if="!file.binary"
          :model-value="file.text"
          :readonly="file.truncated"
          :min-height="260"
          :placeholder="file.path"
          @update:model-value="onEdit"
        />
      </div>
    </n-spin>
  </div>
</template>

<style scoped>
.fs-panel {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.crumbs {
  display: flex;
  align-items: center;
  gap: 4px;
  flex-wrap: wrap;
  font-family: var(--font-mono, monospace);
  font-size: 12px;
}

.crumb {
  color: var(--color-text-link);
  padding: 2px 6px;
  border-radius: 6px;
}

.crumb:hover {
  background: var(--color-bg-hover);
}

.crumb.active {
  color: var(--color-text-primary);
  font-weight: 600;
}

.sep {
  color: var(--color-text-tertiary);
}

.bar-actions {
  display: flex;
  gap: 6px;
  flex-shrink: 0;
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

.listing {
  width: 100%;
  border-collapse: collapse;
  border: 1px solid var(--color-border-subtle);
  border-radius: var(--radius-md);
  overflow: hidden;
  font-size: 12.5px;
}

.listing th {
  text-align: left;
  padding: 8px 12px;
  background: var(--color-bg-sunken);
  color: var(--color-text-secondary);
  font-size: 11.5px;
}

.listing td {
  padding: 6px 12px;
  border-top: 1px solid var(--color-border-subtle);
  color: var(--color-text-primary);
}

.listing .num {
  text-align: right;
  font-variant-numeric: tabular-nums;
  color: var(--color-text-secondary);
}

.entry {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: var(--color-text-primary);
}

.entry:hover {
  color: var(--color-text-link);
}

.icon {
  font-size: 13px;
}

.empty {
  text-align: center;
  color: var(--color-text-tertiary);
  padding: 20px;
}

.editor-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 8px;
}

.file-path {
  display: flex;
  align-items: center;
  gap: 8px;
  font-family: var(--font-mono, monospace);
  font-size: 12px;
  color: var(--color-text-secondary);
}

.editor-actions {
  display: flex;
  gap: 6px;
}
</style>
