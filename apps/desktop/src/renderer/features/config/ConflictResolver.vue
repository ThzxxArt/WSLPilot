<script setup lang="ts">
import { onMounted, onUnmounted } from 'vue'
import { useDialog, useMessage } from 'naive-ui'
import type { ConfigKey } from '@wslpilot/shared'
import { errorLine } from '../../composables/useAppError'

/**
 * 外部配置冲突解决器（设计书 §6.10 / §13.4）。
 * 三选语义（review 根治：此前 UI 只做两种，`ignore` 契约半成品）：
 * - 「重载」= 采用磁盘上的外部修改（安全）
 * - 「覆盖」= 写回应用内状态（破坏性，必须显式点击）
 * - X / Esc = 「暂不处理」= 保留应用内状态并清标记（不破坏任何一边）
 */
const dialog = useDialog()
const message = useMessage()
let off: (() => void) | undefined

type ConflictAction = 'reload' | 'overwrite' | 'ignore'

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

onMounted(() => {
  off = window.wslAPI?.config.onConflict((payload) => {
    const ignore = () => {
      void resolve(payload.fileKey, 'ignore')
    }
    dialog.warning({
      title: '配置文件已被外部修改',
      content: `${payload.fileKey}：${payload.detail}\n\n「重载」以磁盘上的外部修改为准（安全）\n「覆盖」丢弃外部修改，以应用内状态为准（破坏性）\n关闭（X / Esc）= 暂不处理，保留应用内状态`,
      positiveText: '重载（推荐）',
      negativeText: '覆盖',
      closable: true,
      maskClosable: false,
      closeOnEsc: true,
      onClose: ignore,
      onEsc: ignore,
      onPositiveClick: () => {
        void resolve(payload.fileKey, 'reload')
      },
      onNegativeClick: () => {
        void resolve(payload.fileKey, 'overwrite')
      },
    })
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
