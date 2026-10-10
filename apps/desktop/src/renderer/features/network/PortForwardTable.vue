<script setup lang="ts">
import { computed } from 'vue'
import { NButton, NSwitch, NTag, NTooltip } from 'naive-ui'
import { EmptyState } from '@ui/components'
import { canApplyRule, type NetworkStatus, type PortForwardRule } from '@wslpilot/shared'
import {
  formatRuleRange,
  ruleApplyCommand,
  ruleSystemState,
  ruleSystemStateLabel,
  type RuleSystemState,
} from './forms'

/**
 * 端口转发规则表（M6 · 设计书 §12.6）。
 * 只展示与派发动作，规则的增删改在 PortForwardForm 弹窗内完成。
 */
const props = defineProps<{
  rules: PortForwardRule[]
  status: NetworkStatus | null
  loading?: boolean
}>()

const emit = defineEmits<{
  create: []
  edit: [rule: PortForwardRule]
  remove: [rule: PortForwardRule]
  toggle: [rule: PortForwardRule, enabled: boolean]
  apply: [rule: PortForwardRule]
  applyAll: []
  removeSystem: [rule: PortForwardRule]
  refresh: []
}>()

const rows = computed(() =>
  props.rules.map((rule) => ({
    rule,
    state: ruleSystemState(rule, props.status) as RuleSystemState,
    stateLabel: ruleSystemStateLabel(ruleSystemState(rule, props.status)),
    applyCommand: ruleApplyCommand(rule),
    canApply: canApplyRule(rule),
  })),
)

const stateType = (s: RuleSystemState): 'success' | 'warning' | 'error' | 'default' | 'info' => {
  switch (s) {
    case 'applied':
      return 'success'
    case 'mismatch':
      return 'warning'
    case 'none':
      return 'default'
    case 'udp-only':
      return 'info'
    default:
      return 'default'
  }
}
</script>

<template>
  <section class="card table-card">
    <div class="head">
      <div>
        <h2 class="panel-title">端口转发</h2>
        <p class="sub">
          规则保存在 <code>network.jsonc</code> · 应用后写入
          <code>netsh interface portproxy</code> · 共 {{ rules.length }} 条
        </p>
      </div>
      <div class="head-actions">
        <n-button size="small" secondary :loading="loading" @click="emit('refresh')">刷新</n-button>
        <n-button size="small" secondary :disabled="rules.length === 0" @click="emit('applyAll')">
          全部应用
        </n-button>
        <n-button size="small" type="primary" @click="emit('create')">新建规则</n-button>
      </div>
    </div>

    <EmptyState v-if="rules.length === 0" description="还没有端口转发规则" illustration="🌐">
      <n-button type="primary" size="small" @click="emit('create')">新建第一条规则</n-button>
    </EmptyState>

    <table v-else class="table">
      <thead>
        <tr>
          <th>规则</th>
          <th>发行版</th>
          <th>监听</th>
          <th>转发到</th>
          <th>协议</th>
          <th>系统状态</th>
          <th>启用</th>
          <th class="ops">操作</th>
        </tr>
      </thead>
      <!-- 列表增删 FLIP（§13.2）：transition-group 提供 move 位移插值与增删淡入淡出 -->
      <transition-group name="list" tag="tbody">
        <tr v-for="row in rows" :key="row.rule.id">
          <td class="mono">{{ row.rule.id }}</td>
          <td>{{ row.rule.distro }}</td>
          <td class="mono">{{ formatRuleRange(row.rule.listenAddress, row.rule.listenPort) }}</td>
          <td class="mono">{{ formatRuleRange(row.rule.connectAddress, row.rule.connectPort) }}</td>
          <td>
            <n-tag
              size="tiny"
              :bordered="false"
              :type="row.rule.protocol === 'udp' ? 'info' : 'default'"
            >
              {{ row.rule.protocol.toUpperCase() }}
            </n-tag>
          </td>
          <td>
            <n-tag size="tiny" :bordered="false" :type="stateType(row.state)">
              {{ row.stateLabel }}
            </n-tag>
          </td>
          <td>
            <n-switch
              size="small"
              :value="row.rule.enabled"
              @update:value="(v: boolean) => emit('toggle', row.rule, v)"
            />
          </td>
          <td class="ops">
            <div class="op-buttons">
              <n-tooltip>
                <template #trigger>
                  <n-button
                    size="tiny"
                    secondary
                    :disabled="!row.canApply"
                    @click="emit('apply', row.rule)"
                  >
                    应用
                  </n-button>
                </template>
                {{ row.canApply ? row.applyCommand : 'netsh portproxy 仅支持 TCP' }}
              </n-tooltip>
              <n-button size="tiny" secondary @click="emit('removeSystem', row.rule)">
                从系统移除
              </n-button>
              <n-button size="tiny" quaternary @click="emit('edit', row.rule)">编辑</n-button>
              <n-button size="tiny" quaternary type="error" @click="emit('remove', row.rule)">
                ⚠ 删除
              </n-button>
            </div>
          </td>
        </tr>
      </transition-group>
    </table>
  </section>
</template>

<style scoped>
.table-card {
  padding: 18px 22px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
}

.head-actions {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

.panel-title {
  font-size: 15px;
  font-weight: 600;
  margin: 0;
  color: var(--color-text-primary);
}

.sub {
  margin: 4px 0 0;
  font-size: 12px;
  color: var(--color-text-secondary);
}

.sub code {
  background: var(--color-bg-sunken);
  padding: 1px 6px;
  border-radius: 4px;
  font-size: 11px;
}

.table {
  width: 100%;
  border-collapse: collapse;
  font-size: 12.5px;
}

.table th {
  text-align: left;
  padding: 8px 10px;
  color: var(--color-text-secondary);
  font-weight: 600;
  background: var(--color-bg-sunken);
  white-space: nowrap;
}

.table td {
  padding: 8px 10px;
  border-top: 1px solid var(--color-border-subtle);
  color: var(--color-text-primary);
  vertical-align: middle;
}

.mono {
  font-family: var(--font-mono);
  white-space: nowrap;
}

.ops {
  width: 1%;
  white-space: nowrap;
}

.op-buttons {
  display: flex;
  gap: 6px;
  flex-wrap: nowrap;
}
</style>
