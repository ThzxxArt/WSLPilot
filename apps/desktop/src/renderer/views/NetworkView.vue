<script setup lang="ts">
import { computed, h, onMounted, ref } from 'vue'
import { useMessage, useDialog, useNotification, NButton } from 'naive-ui'
import type { PortForwardRule, ProxyConfig } from '@wslpilot/shared'
import { canApplyRule, ruleSummary } from '@wslpilot/shared'
import MirrorModeCard from '../features/network/MirrorModeCard.vue'
import PortForwardTable from '../features/network/PortForwardTable.vue'
import PortForwardForm from '../features/network/PortForwardForm.vue'
import ProxyPanel from '../features/network/ProxyPanel.vue'
import { ruleApplyCommand } from '../features/network/forms'
import { useNetworkStore } from '../stores/network'
import { useDistrosStore } from '../stores/distros'
import { errorLine } from '../composables/useAppError'

/**
 * 网络页（M6 · 设计书 §12.6）：镜像模式引导 + 端口转发规则表 + 代理配置。
 * 规则 CRUD 落 network.jsonc；应用/移除走 netsh（提权失败给出等价命令行）。
 */
const network = useNetworkStore()
const distros = useDistrosStore()
const message = useMessage()
const dialog = useDialog()
const notification = useNotification()

const editorShow = ref(false)
const editing = ref<PortForwardRule | null>(null)
const proxyApplying = ref(false)

onMounted(() => {
  void network.load()
  void network.loadStatus()
  if (distros.items.length === 0) void distros.refresh()
})

function openCreate() {
  editing.value = null
  editorShow.value = true
}

function openEdit(rule: PortForwardRule) {
  editing.value = rule
  editorShow.value = true
}

async function onSave(rule: PortForwardRule) {
  try {
    await network.upsert(rule)
    message.success(`规则已保存：${rule.id}`)
  } catch (e) {
    message.error(errorLine(e, '保存规则失败'))
  }
}

function onRemove(rule: PortForwardRule) {
  dialog.warning({
    title: '删除转发规则',
    content: `将从 network.jsonc 删除「${rule.id}」（${ruleSummary(rule)}）。系统中已应用的转发不会自动清除。`,
    positiveText: '删除',
    negativeText: '取消',
    onPositiveClick: async () => {
      try {
        await network.remove(rule.id)
        // §13.4 可撤销：通知内提供「撤销」
        const n = notification.warning({
          title: '规则已删除',
          content: `「${rule.id}」`,
          duration: 6000,
          action: () =>
            h(
              NButton,
              {
                size: 'tiny',
                onClick: () => {
                  n.destroy()
                  void network.undoRestore().then(() => message.success('已恢复规则'))
                },
              },
              { default: () => '撤销' },
            ),
        })
      } catch (e) {
        message.error(errorLine(e, '删除规则失败'))
      }
    },
  })
}

async function onToggle(rule: PortForwardRule, enabled: boolean) {
  try {
    await network.setEnabled(rule.id, enabled)
  } catch (e) {
    message.error(errorLine(e, '更新启用状态失败'))
  }
}

async function onApply(rule: PortForwardRule) {
  // §13.4 / §9.6：应用会在系统里开端口，必须展示等价命令并二次确认
  dialog.warning({
    title: '应用转发规则',
    content: `将在系统中添加端口转发：\n${ruleApplyCommand(rule)}\n\n该操作可能触发 UAC 提权确认；权限不足时可复制上述命令到管理员终端执行。`,
    positiveText: '应用',
    negativeText: '取消',
    onPositiveClick: async () => {
      try {
        await network.applyRule(rule.id)
        message.success(`已提交应用：${rule.id}，进度见底部状态栏`)
        void network.loadStatus()
      } catch (e) {
        message.error(errorLine(e, '应用转发失败'))
      }
    },
  })
}

function onApplyAll() {
  const enabled = network.enabledRules
  const applicable = enabled.filter((r) => canApplyRule(r))
  if (enabled.length === 0) {
    message.warning('没有启用中的转发规则')
    return
  }
  const skipped = enabled.length - applicable.length
  dialog.warning({
    title: '应用全部转发规则',
    content:
      `将按顺序执行 ${applicable.length} 条 netsh portproxy 命令` +
      (skipped > 0 ? `（跳过 ${skipped} 条 UDP 规则）` : '') +
      `：\n${applicable.map((r) => ruleApplyCommand(r)).join('\n')}`,
    positiveText: '全部应用',
    negativeText: '取消',
    onPositiveClick: async () => {
      try {
        await network.applyAll()
        message.success('已提交全部应用，进度见底部状态栏')
        void network.loadStatus()
      } catch (e) {
        message.error(errorLine(e, '应用转发失败'))
      }
    },
  })
}

function onRemoveSystem(rule: PortForwardRule) {
  dialog.warning({
    title: '从系统移除转发',
    content: `将执行 netsh interface portproxy delete，移除监听 ${rule.listenAddress}:${rule.listenPort}。配置中的规则会保留。`,
    positiveText: '移除',
    negativeText: '取消',
    onPositiveClick: async () => {
      try {
        await network.removeFromSystem(rule.id)
        message.success(`已提交移除：${rule.id}`)
        void network.loadStatus()
      } catch (e) {
        message.error(errorLine(e, '移除转发失败'))
      }
    },
  })
}

async function onSaveProxy(proxy: ProxyConfig) {
  try {
    await network.saveProxy(proxy)
    message.success('代理配置已保存')
  } catch (e) {
    message.error(errorLine(e, '保存代理配置失败'))
  }
}

/**
 * 「写入代理脚本」：串行「保存 → 写入」。
 * 必须串行——主进程 proxyApply 从磁盘读配置，并行会在写盘完成前把旧代理写进发行版（review M-9）。
 */
async function onProxyApply(distro: string, proxy: ProxyConfig) {
  proxyApplying.value = true
  try {
    await network.saveProxy(proxy)
    await network.proxyApply(distro)
    message.success(`代理已写入 ${distro}（${network.proxyScript?.path ?? ''}）`)
  } catch (e) {
    message.error(errorLine(e, '写入代理脚本失败'))
  } finally {
    proxyApplying.value = false
  }
}

async function onProxyClear(distro: string) {
  try {
    await network.proxyClear(distro)
    message.success(`已清除 ${distro} 的代理脚本`)
  } catch (e) {
    message.error(errorLine(e, '清除代理脚本失败'))
  }
}

function onProxyInspect(distro: string) {
  void network.loadProxyState(distro)
}

function openConfigDir() {
  const path = network.status?.wslconfigPath ?? ''
  const dir = path ? path.slice(0, Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'))) : ''
  if (!dir) {
    message.warning('无法定位 .wslconfig 所在目录')
    return
  }
  void window.wslAPI.app.openPath(dir).catch(() => message.error('无法打开目录'))
}

const systemCount = computed(() => network.status?.portProxy.length ?? 0)
</script>

<template>
  <div class="page">
    <header class="page-header">
      <div>
        <h1>网络</h1>
        <p class="sub">
          端口转发 · 镜像网络模式 · 代理配置 ·
          <code>netsh interface portproxy</code>
        </p>
      </div>
    </header>

    <MirrorModeCard
      :status="network.status"
      :loading="network.statusLoading"
      @open-dir="openConfigDir"
    />

    <PortForwardTable
      :rules="network.rules"
      :status="network.status"
      :loading="network.statusLoading"
      @create="openCreate"
      @edit="openEdit"
      @remove="onRemove"
      @toggle="onToggle"
      @apply="onApply"
      @apply-all="onApplyAll"
      @remove-system="onRemoveSystem"
      @refresh="
        () => {
          void network.loadStatus()
          void network.load()
        }
      "
    />

    <section class="card system-card">
      <h2 class="panel-title">系统当前转发（{{ systemCount }} 条）</h2>
      <p class="sub">
        由 <code>netsh interface portproxy show all</code> 读取，包含本工具之外手工添加的条目。
      </p>
      <table v-if="systemCount > 0" class="table">
        <thead>
          <tr>
            <th>监听</th>
            <th>转发到</th>
            <th>类型</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(e, i) in network.status?.portProxy ?? []" :key="i">
            <td class="mono">{{ e.listenAddress }}:{{ e.listenPort }}</td>
            <td class="mono">{{ e.connectAddress }}:{{ e.connectPort }}</td>
            <td class="mono">{{ e.kind }}</td>
          </tr>
        </tbody>
      </table>
      <p v-else class="empty-line">系统中暂无端口代理条目。</p>
    </section>

    <ProxyPanel
      :proxy="network.proxy"
      :distros="distros.items"
      :windows-proxy="network.status?.windowsProxy ?? null"
      :proxy-script="network.proxyScript"
      :saving="network.saving"
      :applying="proxyApplying"
      @save="onSaveProxy"
      @apply="onProxyApply"
      @clear="onProxyClear"
      @inspect="onProxyInspect"
    />

    <PortForwardForm
      v-model:show="editorShow"
      :rule="editing"
      :rules="network.rules"
      :distros="distros.items"
      @save="onSave"
    />
  </div>
</template>

<style scoped>
.page {
  padding: 24px;
  max-width: 1100px;
  margin: 0 auto;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.page-header h1 {
  font-size: 24px;
  font-weight: 650;
  color: var(--color-text-primary);
  margin: 0;
}

.sub {
  margin: 4px 0 0;
  color: var(--color-text-secondary);
  font-size: 13px;
}

.sub code {
  background: var(--color-bg-sunken);
  padding: 1px 6px;
  border-radius: 4px;
  font-size: 11px;
}

.system-card {
  padding: 18px 22px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.panel-title {
  font-size: 15px;
  font-weight: 600;
  margin: 0;
  color: var(--color-text-primary);
}

.system-card .sub {
  margin: 0;
  font-size: 12px;
}

.system-card .sub code {
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
}

.table td {
  padding: 8px 10px;
  border-top: 1px solid var(--color-border-subtle);
  color: var(--color-text-primary);
}

.mono {
  font-family: var(--font-mono);
}

.empty-line {
  margin: 0;
  font-size: 12.5px;
  color: var(--color-text-tertiary);
}
</style>
