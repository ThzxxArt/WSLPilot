<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from 'vue'
import { NButton, NModal, NSelect, NSpin, NTag, useMessage } from 'naive-ui'
import { useDistrosStore } from '../../stores/distros'
import { useTasksStore } from '../../stores/tasks'
import { useTaskProgress, taskStatusLabel } from '../../composables/useTaskProgress'
import { errorLine } from '../../composables/useAppError'

const props = defineProps<{ show: boolean }>()
const emit = defineEmits<{ 'update:show': [boolean] }>()

const distros = useDistrosStore()
const tasks = useTasksStore()
const message = useMessage()

const online = ref<string[]>([])
const loadingOnline = ref(false)
const selected = ref<string | null>(null)
const activeTaskId = ref('')
const startedAt = ref(0)

const { task, percentLabel, isRunning, isDone, cancel } = useTaskProgress(activeTaskId)

const elapsed = ref('00:00')
let timer: number | undefined

const onlineOptions = computed(() => online.value.map((n) => ({ label: n, value: n })))

async function loadOnline() {
  loadingOnline.value = true
  try {
    online.value = await window.wslAPI.distros.listOnline()
    if (!selected.value && online.value.length > 0) selected.value = online.value[0]!
  } catch (e) {
    message.error(errorLine(e, '获取可安装发行版列表失败'))
  } finally {
    loadingOnline.value = false
  }
}

watch(
  () => props.show,
  (show) => {
    if (show) {
      activeTaskId.value = ''
      void loadOnline()
    } else if (timer) {
      window.clearInterval(timer)
      timer = undefined
    }
  },
)

async function startInstall() {
  const name = selected.value ?? undefined
  const entry = await tasks.startInstall(name)
  if (!entry) {
    message.error(errorLine(tasks.lastError, '启动安装失败'))
    return
  }
  activeTaskId.value = entry.taskId
  startedAt.value = Date.now()
  timer = window.setInterval(() => {
    const sec = Math.floor((Date.now() - startedAt.value) / 1000)
    elapsed.value = `${String(Math.floor(sec / 60)).padStart(2, '0')}:${String(sec % 60).padStart(2, '0')}`
  }, 1000)
}

watch(isDone, (done) => {
  if (done) {
    if (timer) {
      window.clearInterval(timer)
      timer = undefined
    }
    void distros.refresh()
    if (task.value?.status === 'success') message.success('安装完成')
    if (task.value?.status === 'canceled') message.info('安装已取消')
    if (task.value?.status === 'failed')
      message.error(errorLine(task.value.error ?? task.value.message, '安装失败'))
  }
})

// 组件卸载（切路由）时清理计时器，防泄漏（核验修复）
onUnmounted(() => {
  if (timer) {
    window.clearInterval(timer)
    timer = undefined
  }
})

async function onCancel() {
  try {
    await cancel()
    message.info('已请求取消安装')
  } catch (e) {
    message.error(errorLine(e, '取消失败'))
  }
}

function close() {
  if (isRunning.value) {
    message.warning('安装进行中，请先取消或等待完成')
    return
  }
  emit('update:show', false)
}
</script>

<template>
  <n-modal
    :show="show"
    preset="card"
    title="安装发行版"
    class="install-modal"
    :mask-closable="!isRunning"
    @update:show="(v: boolean) => (v ? emit('update:show', true) : close())"
  >
    <div v-if="!activeTaskId" class="form">
      <n-spin :show="loadingOnline">
        <div class="field">
          <div class="label">选择发行版（来自 wsl --list --online）</div>
          <n-select
            v-model:value="selected"
            :options="onlineOptions"
            filterable
            placeholder="选择要安装的发行版"
          />
          <div class="hint">
            将执行 <code>wsl --install{{ selected ? ` -d ${selected}` : '' }}</code>
            ，安装过程中可能触发系统 UAC 提权确认。
          </div>
        </div>
      </n-spin>
      <div class="actions">
        <n-button @click="close"> 取消 </n-button>
        <n-button type="primary" :disabled="!selected" @click="startInstall"> 开始安装 </n-button>
      </div>
    </div>

    <div v-else class="progress">
      <div class="progress-line">
        <NTag
          size="small"
          :bordered="false"
          :type="
            task?.status === 'success' ? 'success' : task?.status === 'failed' ? 'error' : 'info'
          "
        >
          {{ taskStatusLabel(task?.status ?? 'running') }}
        </NTag>
        <span class="pct">{{ percentLabel }}</span>
        <span class="elapsed">{{ elapsed }}</span>
      </div>
      <div class="msg">
        {{ task?.message || '准备中…' }}
      </div>
      <div v-if="task?.error" class="error">
        {{ task.error }}
      </div>
      <div class="actions">
        <n-button v-if="isRunning" secondary type="error" @click="onCancel"> 取消安装 </n-button>
        <n-button v-if="isDone" type="primary" @click="close"> 完成 </n-button>
      </div>
    </div>
  </n-modal>
</template>

<style scoped>
.install-modal {
  width: 480px;
  max-width: 92vw;
}

.form,
.progress {
  display: flex;
  flex-direction: column;
  gap: 16px;
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

.hint code {
  background: var(--color-bg-sunken);
  padding: 1px 5px;
  border-radius: 4px;
}

.actions {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
}

.progress-line {
  display: flex;
  align-items: center;
  gap: 12px;
  font-variant-numeric: tabular-nums;
}

.pct {
  font-size: 20px;
  font-weight: 700;
  color: var(--color-text-primary);
}

.elapsed {
  color: var(--color-text-tertiary);
  font-size: 12px;
}

.msg {
  font-size: 13px;
  color: var(--color-text-secondary);
}

.error {
  padding: 10px 12px;
  border-radius: 10px;
  background: color-mix(in srgb, var(--color-danger) 10%, transparent);
  color: var(--color-danger);
  font-size: 12.5px;
}
</style>
