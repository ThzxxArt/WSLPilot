<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { NButton, NSpin, NTag, useDialog, useMessage } from 'naive-ui'
import { CodeEditor } from '@ui/components'
import type { DirEntry } from '@shared/types'
import { errorLine } from '../../composables/useAppError'

const props = defineProps<{ distroName: string }>()

const message = useMessage()
const dialog = useDialog()
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
} | null>(null)
const saving = ref(false)

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

async function load() {
  if (!props.distroName) return
  if (!(await confirmDiscard())) return
  loading.value = true
  error.value = ''
  file.value = null
  try {
    entries.value = await window.wslAPI.fs.readDir(props.distroName, path.value)
  } catch (e) {
    error.value = errorLine(e, '读取目录失败')
    entries.value = []
  } finally {
    loading.value = false
  }
}

function goTo(p: string) {
  path.value = p
  void load()
}

async function enter(e: DirEntry) {
  if (e.isDirectory) {
    if (!(await confirmDiscard())) return
    path.value = e.path
    await load()
    return
  }
  if (!(await confirmDiscard())) return
  try {
    const r = await window.wslAPI.fs.read(props.distroName, e.path)
    file.value = {
      path: e.path,
      text: r.binary ? '' : r.text,
      dirty: false,
      truncated: r.truncated,
      binary: r.binary,
      sizeBytes: r.sizeBytes,
    }
  } catch (err) {
    message.error(errorLine(err, '读取文件失败'))
  }
}

async function saveFile() {
  if (!file.value) return
  // 超限截断的文件禁止写回：保存会把前缀整文件覆盖回去，静默毁掉剩余内容
  if (file.value.truncated) {
    message.warning('该文件超过在线编辑上限，禁止写回以免截断原文件')
    return
  }
  saving.value = true
  try {
    await window.wslAPI.fs.write(props.distroName, file.value.path, file.value.text)
    file.value.dirty = false
    message.success(`已保存 ${file.value.path}`)
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
  if (!(await confirmDiscard())) return
  file.value = null
}

async function reveal(target: string) {
  try {
    await window.wslAPI.fs.revealInExplorer(props.distroName, target)
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
  () => {
    path.value = '/'
    void load()
  },
)
</script>

<template>
  <div class="fs-panel">
    <div class="bar">
      <nav class="crumbs" aria-label="路径">
        <template v-for="(c, i) in crumbs" :key="c.path">
          <span v-if="i > 0" class="sep">/</span>
          <button class="crumb" :class="{ active: i === crumbs.length - 1 }" @click="goTo(c.path)">
            {{ c.name }}
          </button>
        </template>
      </nav>
      <div class="bar-actions">
        <n-button size="tiny" quaternary @click="load()">刷新</n-button>
        <n-button size="tiny" quaternary @click="reveal(path)">资源管理器</n-button>
      </div>
    </div>

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
              <button class="entry" @click="enter(e)">
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
            <button class="crumb" @click="closeFile">← 返回</button>
            {{ file.path }}
            <n-tag v-if="file.dirty" size="tiny" type="warning" :bordered="false">未保存</n-tag>
            <n-tag v-if="file.truncated" size="tiny" :bordered="false">超限截断</n-tag>
          </span>
          <div class="editor-actions">
            <n-button
              size="tiny"
              type="primary"
              :disabled="!file.dirty || file.binary || file.truncated"
              :loading="saving"
              @click="saveFile"
            >
              保存
            </n-button>
          </div>
        </div>
        <p v-if="file.binary" class="hint">二进制文件不支持在线编辑，请在终端中处理。</p>
        <!-- 超限截断：编辑器只读，禁止保存 —— 否则会把截断后的内容整文件覆盖回去（review C1） -->
        <p v-else-if="file.truncated" class="hint">
          文件超过 {{ Math.round(file.sizeBytes / 1024) }}KB 的在线编辑上限，仅展示前缀。
          为避免保存时截断原文件，此处禁止编辑；请在终端中用 vim/nano 处理。
        </p>
        <CodeEditor
          v-else
          :model-value="file.text"
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
