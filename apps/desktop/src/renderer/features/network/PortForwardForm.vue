<script setup lang="ts">
import { computed, reactive, watch } from 'vue'
import { NButton, NInput, NInputNumber, NModal, NSelect, NSwitch, useMessage } from 'naive-ui'
import type { DistroView, PortForwardRule } from '@wslpilot/shared'
import {
  defaultPortForwardForm,
  formToRule,
  ruleApplyCommand,
  ruleToForm,
  suggestRuleId,
  validatePortForwardForm,
  type PortForwardForm,
} from './forms'

/**
 * 端口转发规则编辑弹窗（M6）。
 * 校验走 shared/network.validatePortForwardRule（与执行边界同源），确认时展示等价命令。
 */
const props = defineProps<{
  show: boolean
  /** 编辑中的规则；null = 新建 */
  rule: PortForwardRule | null
  rules: PortForwardRule[]
  distros: DistroView[]
}>()

const emit = defineEmits<{
  'update:show': [boolean]
  save: [PortForwardRule]
}>()

const message = useMessage()
const form = reactive<PortForwardForm>(defaultPortForwardForm())

watch(
  () => props.show,
  (open) => {
    if (!open) return
    const next = props.rule ? ruleToForm(props.rule) : defaultPortForwardForm('')
    Object.assign(form, next)
    if (!form.id) {
      const port = Number(form.listenPort) || 3000
      form.id = suggestRuleId(props.rules, port)
    }
    if (!form.distro && props.distros.length > 0) {
      form.distro = props.distros[0]!.name
    }
  },
  { immediate: true },
)

const distroOptions = computed(() =>
  props.distros.map((d) => ({
    label: d.meta?.alias ? `${d.meta.alias}（${d.name}）` : d.name,
    value: d.name,
  })),
)

const protocolOptions = [
  { label: 'TCP（可应用到系统）', value: 'tcp' },
  { label: 'UDP（仅记录意图）', value: 'udp' },
]

const preview = computed(() => {
  try {
    return ruleApplyCommand(formToRule(form))
  } catch {
    return ''
  }
})

const error = computed(() => validatePortForwardForm(form, props.rules))

function close() {
  emit('update:show', false)
}

function save() {
  const err = error.value
  if (err) {
    message.warning(err)
    return
  }
  emit('save', formToRule(form))
  close()
}
</script>

<template>
  <n-modal
    :show="show"
    preset="card"
    :title="rule ? '编辑转发规则' : '新建转发规则'"
    class="rule-modal"
    :style="{ width: '560px' }"
    :bordered="false"
    @update:show="(v: boolean) => emit('update:show', v)"
  >
    <div class="form">
      <label class="field">
        <span class="label">规则 id</span>
        <n-input v-model:value="form.id" placeholder="dev-3000" />
      </label>

      <label class="field">
        <span class="label">目标发行版</span>
        <n-select
          v-model:value="form.distro"
          :options="distroOptions"
          filterable
          placeholder="选择发行版"
        />
      </label>

      <div class="row">
        <label class="field">
          <span class="label">监听地址</span>
          <n-input v-model:value="form.listenAddress" placeholder="0.0.0.0" />
        </label>
        <label class="field">
          <span class="label">监听端口</span>
          <n-input-number v-model:value="form.listenPort" :min="1" :max="65535" class="w-full" />
        </label>
      </div>

      <div class="row">
        <label class="field">
          <span class="label">转发地址</span>
          <n-input v-model:value="form.connectAddress" placeholder="127.0.0.1" />
        </label>
        <label class="field">
          <span class="label">转发端口</span>
          <n-input-number v-model:value="form.connectPort" :min="1" :max="65535" class="w-full" />
        </label>
      </div>

      <div class="row">
        <label class="field">
          <span class="label">协议</span>
          <n-select v-model:value="form.protocol" :options="protocolOptions" />
        </label>
        <label class="field toggle-field">
          <span class="label">启用</span>
          <n-switch v-model:value="form.enabled" />
        </label>
      </div>

      <div v-if="preview" class="preview">
        <div class="preview-label">应用时执行（仅展示）</div>
        <code>{{ preview }}</code>
      </div>

      <p v-if="error" class="error">{{ error }}</p>
    </div>

    <template #footer>
      <div class="footer">
        <n-button secondary @click="close">取消</n-button>
        <n-button type="primary" :disabled="!!error" @click="save">
          {{ rule ? '保存修改' : '创建规则' }}
        </n-button>
      </div>
    </template>
  </n-modal>
</template>

<style scoped>
.form {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
}

.field {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.toggle-field {
  justify-content: flex-start;
  padding-top: 22px;
}

.label {
  font-size: 12px;
  color: var(--color-text-secondary);
  font-weight: 600;
}

.w-full {
  width: 100%;
}

.preview {
  background: var(--color-bg-sunken);
  border-radius: var(--radius-md);
  padding: 10px 12px;
}

.preview-label {
  font-size: 11px;
  color: var(--color-text-secondary);
  margin-bottom: 4px;
}

.preview code {
  font-family: var(--font-mono);
  font-size: 11.5px;
  color: var(--color-text-primary);
  word-break: break-all;
  line-height: 1.6;
}

.error {
  margin: 0;
  font-size: 12px;
  color: var(--color-danger);
}

.footer {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
}
</style>
