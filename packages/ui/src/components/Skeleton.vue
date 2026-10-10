<script setup lang="ts">
/**
 * 骨架屏（设计书 §12.8）：加载态用流光扫过（Skeleton），而非转圈。
 * 基于 motion.scss 的 .skeleton 流光；reduced-motion 下自动降级为静态色块。
 */
withDefaults(
  defineProps<{
    /** 宽度（CSS 长度） */
    width?: string
    /** 高度（CSS 长度） */
    height?: string
    /** 圆角（CSS 长度） */
    radius?: string
    /** 文本行骨架：按行数生成（与 width/height 互斥） */
    rows?: number
  }>(),
  { width: '100%', height: '16px', radius: '', rows: 0 },
)
</script>

<template>
  <div v-if="rows > 0" class="skeleton-rows" role="status" aria-label="加载中" aria-busy="true">
    <div
      v-for="i in rows"
      :key="i"
      class="skeleton"
      :style="{
        width: i === rows ? '60%' : width,
        height,
        borderRadius: radius || undefined,
      }"
    />
  </div>
  <div
    v-else
    class="skeleton"
    role="status"
    aria-label="加载中"
    aria-busy="true"
    :style="{ width, height, borderRadius: radius || undefined }"
  />
</template>

<style scoped>
.skeleton-rows {
  display: flex;
  flex-direction: column;
  gap: 8px;
  width: 100%;
}
</style>
