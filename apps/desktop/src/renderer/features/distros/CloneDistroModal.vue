<script setup lang="ts">
/**
 * 克隆发行版弹窗（0.1.3）：新名称 + 安装位置 → 导出临时归档 → 导入新名 → 自动清理。
 * 校验与执行边界同源（isValidDistroName / 大小写归一重名拦截）。
 */
import { computed, reactive, ref, watch } from 'vue'
import { NButton, NInput, NModal, useMessage } from 'naive-ui'
import type { DistroView } from '@wslpilot/shared'
import { useTasksStore } from '../../stores/tasks'
import { isValidDistroName } from '../backup/forms'
import { errorLine } from '../../composables/useAppError'

const props = defineProps<{
  show: boolean
  /** 源发行版名 */
  source: string
  /** 现有发行版（重名拦截） */
  distros: DistroView[]
  /** 默认安装目录（备份目录） */
  defaultDir: string
}>()

const emit = defineEmits<{
  'update:show': [boolean]
  /** 克隆任务已启动（父级可关闭详情弹窗） */
  started: []
}>()

const tasks = useTasksStore()
const message = useMessage()

const form = reactive({ newName: '', installPath: '' })
const starting = ref(false)

watch(
  () => props.show,
  (show) => {
    if (!show) return
    form.newName = ''
    form.installPath = props.defaultDir || ''
    starting.value = false
  },
  { immediate: true },
)

const nameError = computed(() => {
  const n = form.newName.trim()
  if (!n) return ''
  if (!isValidDistroName(n)) return '名称不能包含 \\ / : * ? " < > | 等字符'
  if (n.toLowerCase() === props.source.toLowerCase()) return '新名称不能与源发行版相同'
  if (props.distros.some((d) => d.name.toLowerCase() === n.toLowerCase())) {
    return `已存在同名发行版「${n}」`
  }
  return ''
})

const pathError = computed(() => (form.installPath.trim() ? '' : '请选择安装位置（目录）'))

const canSubmit = computed(() => !!form.newName.trim() && !nameError.value && !pathError.value)

async function browse() {
  const picked = await window.wslAPI.app.pickDirectory(form.installPath || props.defaultDir)
  if (picked) form.installPath = picked
}

async function submit() {
  if (starting.value || !canSubmit.value) return
  starting.value = true
  try {
    const entry = await tasks.startClone({
      name: props.source,
      newName: form.newName.trim(),
      installPath: form.installPath.trim(),
    })
    if (!entry) {
      message.error(errorLine(tasks.lastError, '启动克隆失败'))
      return
    }
    message.success(`已开始克隆 ${props.source} → ${form.newName.trim()}，进度见状态栏与任务抽屉`)
    emit('started')
    emit('update:show', false)
  } finally {
    starting.value = false
  }
}
</script>

<template>
  <n-modal
    :show="show"
    preset="card"
    :title="`克隆发行版 · ${source}`"
    :style="{ width: '520px', maxWidth: '94vw', maxHeight: '90vh' }"
    :content-style="{ overflow: 'auto' }"
    @update:show="(v: boolean) => emit('update:show', v)"
  >
    <div class="form">
      <div class="field">
        <div class="label">新发行版名称</div>
        <n-input
          v-model:value="form.newName"
          placeholder="例如 Ubuntu-Dev"
          :input-props="{ 'aria-label': '新发行版名称' }"
        />
        <div v-if="nameError" class="error">{{ nameError }}</div>
      </div>

      <div class="field">
        <div class="label">安装位置（目录）</div>
        <div class="row">
          <n-input
            v-model:value="form.installPath"
            placeholder="新发行版虚拟磁盘将创建在该目录"
            :input-props="{ 'aria-label': '安装位置' }"
          />
          <n-button secondary @click="browse"> 浏览… </n-button>
        </div>
        <div v-if="pathError" class="error">{{ pathError }}</div>
      </div>

      <p class="hint">
        克隆流程：导出源发行版为临时归档 → 以新名称导入到目标位置 → 自动清理临时文件。
        导出期间源发行版可继续使用；失败时自动回滚不完整的导入。
      </p>

      <div class="actions">
        <n-button secondary :disabled="starting" @click="emit('update:show', false)">
          取消
        </n-button>
        <n-button
          type="primary"
          :loading="starting"
          :disabled="starting || !canSubmit"
          @click="submit"
        >
          开始克隆
        </n-button>
      </div>
    </div>
  </n-modal>
</template>

<style scoped>
.form {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.field {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.label {
  font-size: 12px;
  font-weight: 600;
  color: var(--color-text-secondary);
}

.row {
  display: flex;
  gap: 8px;
  align-items: center;
}

.row :deep(.n-input) {
  flex: 1;
}

.error {
  margin: 0;
  font-size: 12px;
  color: var(--color-danger);
}

.hint {
  margin: 0;
  font-size: 11.5px;
  color: var(--color-text-tertiary);
  line-height: 1.7;
}

.actions {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
}
</style>
