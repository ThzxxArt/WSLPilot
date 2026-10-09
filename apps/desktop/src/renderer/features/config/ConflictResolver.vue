<script setup lang="ts">
import { onMounted, onUnmounted } from 'vue'
import { useDialog, useMessage } from 'naive-ui'
import type { ConfigKey } from '@wslpilot/shared'
import { errorLine } from '../../composables/useAppError'

/**
 * 外部配置冲突解决器（设计书 §6.10 / §13.4）。
 * 语义铁律（review C3）：Esc/取消 = 不做破坏性动作；
 * 「覆盖」是破坏性操作，必须用户显式点击。
 */
const dialog = useDialog()
const message = useMessage()
let off: (() => void) | undefined

async function resolve(fileKey: string, action: 'reload' | 'overwrite') {
  try {
    await window.wslAPI.config.resolveConflict(fileKey as ConfigKey, action)
    message.success(action === 'reload' ? '已重载外部修改' : '已用应用内状态覆盖磁盘配置')
  } catch (e) {
    message.error(errorLine(e, '处理冲突失败'))
  }
}

onMounted(() => {
  off = window.wslAPI?.config.onConflict((payload) => {
    dialog.warning({
      title: '配置文件已被外部修改',
      content: `${payload.fileKey}：${payload.detail}\n\n「重载」以磁盘上的外部修改为准（安全）\n「覆盖」丢弃外部修改，以应用内状态为准（破坏性）`,
      positiveText: '重载（推荐）',
      negativeText: '覆盖',
      closable: false,
      maskClosable: false,
      closeOnEsc: false,
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
