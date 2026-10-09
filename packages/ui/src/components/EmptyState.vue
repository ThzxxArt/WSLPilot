<script setup lang="ts">
/**
 * 空状态（设计书 §10.7.2 / §12.8）：插画槽 + 说明 + 主 CTA 槽。
 * 基于 NEmpty 封装，统一空态视觉与语义。
 */
withDefaults(
  defineProps<{
    description?: string
    /** 插画字符/图标（可选） */
    illustration?: string
    size?: 'small' | 'medium' | 'large'
  }>(),
  { description: '暂无数据', illustration: '', size: 'medium' },
)
</script>

<template>
  <div class="empty-state" :class="`size-${size}`" role="status">
    <div v-if="illustration" class="illustration" aria-hidden="true">{{ illustration }}</div>
    <div class="desc">{{ description }}</div>
    <div v-if="$slots.default" class="action">
      <slot />
    </div>
  </div>
</template>

<style scoped>
.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  padding: 28px 16px;
  text-align: center;
}

.illustration {
  font-size: 32px;
  line-height: 1;
  opacity: 0.75;
}

.desc {
  font-size: 13px;
  color: var(--color-text-tertiary);
}

.size-small {
  padding: 14px 10px;
}

.size-small .illustration {
  font-size: 22px;
}

.size-small .desc {
  font-size: 12px;
}

.size-large {
  padding: 40px 20px;
}

.size-large .illustration {
  font-size: 44px;
}

.action {
  margin-top: 4px;
}
</style>
