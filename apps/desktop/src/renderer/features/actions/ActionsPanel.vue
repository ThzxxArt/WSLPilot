<script setup lang="ts">
import { computed, h, onMounted, reactive, ref } from 'vue'
import {
  NButton,
  NCard,
  NInput,
  NModal,
  NSelect,
  NSwitch,
  NTag,
  useDialog,
  useMessage,
  useNotification,
} from 'naive-ui'
import { Kbd } from '@wslpilot/ui'
import { previewActionCommandForDistro, assertSafeActionId, type WslAction } from '@wslpilot/shared'
import { useActionsStore } from '../../stores/actions'
import { useDistrosStore } from '../../stores/distros'
import { errorLine } from '../../composables/useAppError'

const props = defineProps<{ distroName: string }>()

const message = useMessage()
const dialog = useDialog()
const notification = useNotification()
const actions = useActionsStore()
const distros = useDistrosStore()

/** 需确认操作统一走 naive dialog（全仓一致，禁止 window.confirm） */
function confirmDangerous(opts: { title: string; content: string }): Promise<boolean> {
  return new Promise((resolve) => {
    dialog.warning({
      title: opts.title,
      content: opts.content,
      positiveText: '确定',
      negativeText: '取消',
      onPositiveClick: () => resolve(true),
      onNegativeClick: () => resolve(false),
      onClose: () => resolve(false),
    })
  })
}

onMounted(() => {
  if (!actions.loaded) void actions.load()
  if (distros.items.length === 0) void distros.refresh()
})

const startupCwd = computed(() => distros.byName(props.distroName)?.meta?.startupCwd?.trim() || '~')

/** distros.jsonc meta.quickActions 声明的快捷动作（设计书 §12.4） */
const quickIds = computed(() => distros.byName(props.distroName)?.meta?.quickActions ?? [])
const quickItems = computed(() => actions.items.filter((a) => quickIds.value.includes(a.id)))
const restItems = computed(() => actions.items.filter((a) => !quickIds.value.includes(a.id)))

function preview(a: WslAction): string {
  return previewActionCommandForDistro(a, props.distroName, startupCwd.value)
}

/**
 * 每个动作的运行中标记：在弹出确认框**之前**加锁，
 * 双击「运行」不会叠两个确认框、更不会执行两次（review 0.1.2 根治）。
 */
const runningActions = reactive(new Set<string>())

async function runAction(a: WslAction) {
  if (runningActions.has(a.id)) return
  runningActions.add(a.id)
  try {
    // §13.4 破坏性确认：confirm 动作必须显式确认，且展示等价命令
    if (a.confirm) {
      const ok = await confirmDangerous({
        title: `执行动作「${a.label}」`,
        content: `将运行：\n${preview(a)}`,
      })
      if (!ok) return
    }
    const handle = await actions.run(a.id, props.distroName)
    message.success(
      handle.ptyId ? `已在终端中运行「${a.label}」` : `已开始执行「${a.label}」，进度见底部状态栏`,
    )
  } catch (e) {
    message.error(errorLine(e, `执行动作失败：${a.label}`))
  } finally {
    runningActions.delete(a.id)
  }
}

// ── 动作管理（CRUD + 删除撤销）──
const editorOpen = ref(false)
const editing = reactive({
  id: '',
  label: '',
  description: '',
  icon: '',
  scope: 'distro' as 'distro' | 'global',
  program: '',
  argsText: '',
  user: '',
  cwd: '',
  terminal: false,
  confirm: false,
})
const editingExisting = ref(false)

function openCreate() {
  editingExisting.value = false
  Object.assign(editing, {
    id: '',
    label: '',
    description: '',
    icon: '',
    scope: 'distro',
    program: '/usr/bin/bash',
    argsText: '-lc\n',
    user: '',
    cwd: '',
    terminal: true,
    confirm: true,
  })
  editorOpen.value = true
}

function openEdit(a: WslAction) {
  editingExisting.value = true
  Object.assign(editing, {
    id: a.id,
    label: a.label,
    description: a.description ?? '',
    icon: a.icon ?? '',
    scope: a.scope,
    program: a.program,
    argsText: a.args.join('\n'),
    user: a.user ?? '',
    cwd: a.cwd ?? '',
    terminal: a.terminal,
    confirm: a.confirm,
  })
  editorOpen.value = true
}

async function saveAction() {
  const id = editing.id.trim()
  const label = editing.label.trim()
  const program = editing.program.trim()
  if (!id || !label || !program) {
    message.warning('id / 显示名 / 程序不能为空')
    return
  }
  try {
    assertSafeActionId(id)
  } catch {
    message.warning('id 含非法字符')
    return
  }
  const action: WslAction = {
    id,
    label,
    description: editing.description.trim() || undefined,
    icon: editing.icon.trim() || undefined,
    scope: editing.scope,
    program,
    args: editing.argsText
      .split('\n')
      .map((s) => s.trim())
      .filter((s) => s !== ''),
    user: editing.user.trim() || undefined,
    cwd: editing.cwd.trim() || undefined,
    terminal: editing.terminal,
    confirm: editing.confirm,
  }
  try {
    await actions.upsert(action)
    editorOpen.value = false
    message.success(editingExisting.value ? '动作已更新' : '动作已创建')
  } catch (e) {
    message.error(errorLine(e, '保存动作失败'))
  }
}

async function removeAction(a: WslAction) {
  const ok = await confirmDangerous({
    title: '删除动作',
    content: `删除动作「${a.label}」？（可撤销）`,
  })
  if (!ok) return
  try {
    const removed = await actions.remove(a.id)
    if (!removed) return
    // §13.4 可撤销：Toast 内提供「撤销」。
    // 撤销闭包携带本次删除的快照：连续删 A、B 后点 A 的撤销恢复 A，
    // 而不是被 lastRemoved=B 覆盖（review 0.1.2 根治）。
    const n = notification.warning({
      title: '动作已删除',
      content: `「${a.label}」`,
      duration: 6000,
      action: () =>
        h(
          NButton,
          {
            size: 'tiny',
            onClick: () => {
              n.destroy()
              void actions
                .undoRestore(removed)
                .then(() => message.success('已恢复动作'))
                .catch((e: unknown) => message.error(errorLine(e, '恢复动作失败')))
            },
          },
          { default: () => '撤销' },
        ),
    })
  } catch (e) {
    message.error(errorLine(e, '删除动作失败'))
  }
}

function openActionsFile() {
  void window.wslAPI.config.openExternal('actions').catch((e: unknown) => {
    message.error(errorLine(e, '打开 actions.jsonc 失败'))
  })
}
</script>

<template>
  <div class="actions-panel">
    <div class="toolbar">
      <p class="hint">
        动作声明在 <code>actions.jsonc</code> · 变量占位符
        <code>${distroName} ${startupCwd} ${home} ${user}</code>
      </p>
      <div class="toolbar-actions">
        <n-button size="small" quaternary @click="openActionsFile">打开 actions.jsonc</n-button>
        <n-button size="small" secondary @click="actions.load()">刷新</n-button>
        <n-button size="small" type="primary" @click="openCreate">新建动作</n-button>
      </div>
    </div>

    <div v-if="actions.items.length === 0" class="empty">
      还没有自定义动作 — 点「新建动作」，或直接编辑 actions.jsonc
    </div>

    <template v-else>
      <section
        v-for="section in [
          { title: '快捷动作（meta.quickActions）', items: quickItems },
          { title: '全部动作', items: restItems },
        ]"
        :key="section.title"
      >
        <div v-if="section.items.length" class="section-title">{{ section.title }}</div>
        <div class="cards">
          <n-card v-for="a in section.items" :key="a.id" size="small" class="action-card">
            <div class="card-head">
              <div class="title">
                <span class="label">{{ a.label }}</span>
                <n-tag size="tiny" :bordered="false">{{
                  a.scope === 'global' ? '全局' : '发行版'
                }}</n-tag>
                <n-tag v-if="a.terminal" size="tiny" :bordered="false" type="info">终端</n-tag>
                <n-tag v-if="a.confirm" size="tiny" :bordered="false" type="warning">需确认</n-tag>
              </div>
              <div class="card-actions">
                <n-button
                  size="tiny"
                  type="primary"
                  secondary
                  :loading="runningActions.has(a.id)"
                  :disabled="runningActions.has(a.id)"
                  @click="runAction(a)"
                >
                  运行
                </n-button>
                <n-button size="tiny" quaternary @click="openEdit(a)">编辑</n-button>
                <n-button size="tiny" quaternary type="error" @click="removeAction(a)">
                  ⚠ 删除
                </n-button>
              </div>
            </div>
            <div v-if="a.description" class="desc">{{ a.description }}</div>
            <code class="cmd">{{ preview(a) }}</code>
          </n-card>
        </div>
      </section>
    </template>

    <p class="hint foot">
      <Kbd :keys="['Ctrl', 'K']" /> 在命令面板中输入 <code>&gt;</code> 可快速搜索并执行动作
    </p>

    <!-- 动作编辑器 -->
    <n-modal
      v-model:show="editorOpen"
      preset="card"
      :title="editingExisting ? '编辑动作' : '新建动作'"
      class="action-editor"
      :style="{ width: '560px', maxWidth: '94vw', maxHeight: '90vh' }"
      :content-style="{ overflow: 'auto' }"
    >
      <div class="form-grid">
        <label>ID</label>
        <n-input
          v-model:value="editing.id"
          size="small"
          :disabled="editingExisting"
          placeholder="update-all"
        />
        <label>显示名</label>
        <n-input v-model:value="editing.label" size="small" placeholder="全量更新" />
        <label>描述</label>
        <n-input
          v-model:value="editing.description"
          size="small"
          placeholder="apt update && apt upgrade"
        />
        <label>作用域</label>
        <n-select
          v-model:value="editing.scope"
          size="small"
          :options="[
            { label: '发行版级（需指定发行版）', value: 'distro' },
            { label: '全局（落到默认发行版）', value: 'global' },
          ]"
        />
        <label>程序</label>
        <n-input v-model:value="editing.program" size="small" placeholder="/usr/bin/bash" />
        <label>参数（每行一个）</label>
        <n-input
          v-model:value="editing.argsText"
          size="small"
          type="textarea"
          :rows="4"
          placeholder="-lc&#10;sudo apt update"
        />
        <label>执行用户</label>
        <n-input v-model:value="editing.user" size="small" placeholder="root（可空）" />
        <label>工作目录</label>
        <n-input v-model:value="editing.cwd" size="small" placeholder="${startupCwd}（可空）" />
        <label>在终端运行</label>
        <n-switch v-model:value="editing.terminal" />
        <label>执行前确认</label>
        <n-switch v-model:value="editing.confirm" />
      </div>
      <template #footer>
        <div class="editor-footer">
          <n-button quaternary @click="editorOpen = false">取消</n-button>
          <n-button type="primary" :loading="actions.saving" @click="saveAction">保存</n-button>
        </div>
      </template>
    </n-modal>
  </div>
</template>

<style scoped>
.actions-panel {
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

.toolbar-actions {
  display: flex;
  gap: 8px;
  flex-shrink: 0;
}

.hint {
  margin: 0;
  font-size: 11.5px;
  color: var(--color-text-tertiary);
}

.hint.foot {
  text-align: center;
}

.empty {
  padding: 28px;
  text-align: center;
  color: var(--color-text-tertiary);
  border: 1px dashed var(--color-border-default);
  border-radius: var(--radius-md);
  font-size: 13px;
}

.cards {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.section-title {
  margin: 6px 0 8px;
  font-size: 11.5px;
  font-weight: 650;
  color: var(--color-text-tertiary);
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.action-card {
  border-radius: var(--radius-md);
}

.card-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.title {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}

.label {
  font-weight: 600;
  font-size: 13.5px;
  color: var(--color-text-primary);
}

.card-actions {
  display: flex;
  gap: 6px;
  flex-shrink: 0;
}

.desc {
  margin: 6px 0;
  font-size: 12px;
  color: var(--color-text-secondary);
}

.cmd {
  display: block;
  padding: 6px 10px;
  border-radius: 8px;
  background: var(--color-bg-sunken);
  color: var(--color-text-secondary);
  font-family: var(--font-mono, monospace);
  font-size: 11.5px;
  word-break: break-all;
  white-space: pre-wrap;
}

/* 宽度走 n-modal 的 :style（preset="card" 不给 fallthrough class 挂 scoped 属性，
   作用域规则对弹框根节点是死的 — review 根治） */

.form-grid {
  display: grid;
  grid-template-columns: 110px 1fr;
  gap: 10px 12px;
  align-items: center;
}

.form-grid label {
  font-size: 12px;
  color: var(--color-text-secondary);
  text-align: right;
}

.editor-footer {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}
</style>
