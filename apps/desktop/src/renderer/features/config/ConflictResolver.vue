<script setup lang="ts">
import { h, onMounted, onUnmounted } from 'vue'
import { NButton, useDialog, useMessage } from 'naive-ui'
import type { ConfigKey } from '@wslpilot/shared'
import { errorLine } from '../../composables/useAppError'

/**
 * 外部配置冲突解决器（设计书 §6.10 / §13.4）。
 * 三选语义（review 根治：此前 UI 只做两种，`ignore` 契约半成品）：
 * - 「重载」= 采用磁盘上的外部修改（安全）
 * - 「覆盖」= 写回应用内状态（破坏性，必须显式点击）
 * - 「暂不处理」= 保留应用内状态并清标记（不破坏任何一边）；X / Esc 同义
 */
const dialog = useDialog()
const message = useMessage()
let off: (() => void) | undefined

type ConflictAction = 'reload' | 'overwrite' | 'ignore'
type ConflictPayload = { fileKey: string; detail: string }

const ACTION_MESSAGE: Record<ConflictAction, string> = {
  reload: '已重载外部修改',
  overwrite: '已用应用内状态覆盖磁盘配置',
  ignore: '已暂不处理：保留应用内状态（下次写回时覆盖磁盘）',
}

async function resolve(fileKey: string, action: ConflictAction) {
  try {
    await window.wslAPI.config.resolveConflict(fileKey as ConfigKey, action)
    message.success(ACTION_MESSAGE[action])
  } catch (e) {
    message.error(errorLine(e, '处理冲突失败'))
  }
}

/**
 * 简单队列：多个冲突先后到达时不叠加对话框（review 0.1.2 根治：
 * 多个外部修改会同时弹多个 dialog，用户点完最后一个前面的还在）。
 */
const queue: ConflictPayload[] = []
let showing = false

function enqueue(payload: ConflictPayload) {
  queue.push(payload)
  drain()
}

function drain() {
  if (showing) return
  const payload = queue.shift()
  if (!payload) return
  showing = true
  // resolve 必须幂等：naive 真实交互中 onEsc 与 onClose 可能先后触发同一次关闭，
  // 且按钮回调后 dialog 关闭还会再触发 onClose（review 根治）
  let resolved = false
  const finish = (action: ConflictAction) => {
    if (resolved) return
    resolved = true
    void resolve(payload.fileKey, action).finally(() => {
      showing = false
      drain()
    })
  }
  dialog.warning({
    title: '配置文件已被外部修改',
    // naive dialog 会吞掉纯文本里的 \n\n（渲染成一行）：改多段 VNode（review 0.1.2 根治）
    content: () =>
      h('div', [
        h('p', { style: 'margin: 0 0 8px' }, `${payload.fileKey}：${payload.detail}`),
        h('p', { style: 'margin: 0 0 4px' }, '「重载」以磁盘上的外部修改为准（安全）'),
        h('p', { style: 'margin: 0 0 4px' }, '「覆盖」丢弃外部修改，以应用内状态为准（破坏性）'),
        h('p', { style: 'margin: 0' }, '「暂不处理」（或 X / Esc）保留应用内状态'),
      ]),
    positiveText: '重载（推荐）',
    negativeText: '覆盖',
    closable: true,
    maskClosable: false,
    closeOnEsc: true,
    onClose: () => finish('ignore'),
    onEsc: () => finish('ignore'),
    onPositiveClick: () => {
      finish('reload')
    },
    onNegativeClick: () => {
      finish('overwrite')
    },
    // 显式第三按钮：正路之外不再只靠 Esc/X（review 0.1.2 根治）
    action: () =>
      h('div', { style: 'display: flex; justify-content: flex-end; gap: 12px' }, [
        h(NButton, { onClick: () => finish('ignore') }, { default: () => '暂不处理' }),
        h(NButton, { onClick: () => finish('overwrite') }, { default: () => '覆盖' }),
        h(
          NButton,
          { type: 'primary', onClick: () => finish('reload') },
          { default: () => '重载（推荐）' },
        ),
      ]),
  })
}

onMounted(() => {
  off = window.wslAPI?.config.onConflict((payload) => {
    enqueue(payload)
  })
})

onUnmounted(() => {
  off?.()
})
</script>

<template>
  <span class="conflict-resolver" />
</template>

<style scoped>
.conflict-resolver {
  display: none;
}
</style>
