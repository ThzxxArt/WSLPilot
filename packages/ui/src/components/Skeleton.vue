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
  <!-- 单根节点（review 0.1.2 根治）：多根会让父组件透传 class/style 触发 extraneous attrs；
       role/aria-busy 收敛到容器统一承载，避免多行模式逐行重复播报。 -->
  <div
    :class="rows > 0 ? 'skeleton-rows' : 'skeleton'"
    role="status"
    aria-label="加载中"
    aria-busy="true"
    :style="rows > 0 ? undefined : { width, height, borderRadius: radius || undefined }"
  >
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
</template>

<style scoped>
.skeleton-rows {
  display: flex;
  flex-direction: column;
  gap: 8px;
  width: 100%;
}
</style>
