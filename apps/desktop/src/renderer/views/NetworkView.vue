<script setup lang="ts">
import { computed, h, onMounted, onUnmounted, ref } from 'vue'
import { useMessage, useDialog, useNotification, NButton } from 'naive-ui'
import type { PortForwardRule, ProxyConfig } from '@wslpilot/shared'
import { canApplyRule, ruleSummary } from '@wslpilot/shared'
import MirrorModeCard from '../features/network/MirrorModeCard.vue'
import PortForwardTable from '../features/network/PortForwardTable.vue'
import PortForwardForm from '../features/network/PortForwardForm.vue'
import ProxyPanel from '../features/network/ProxyPanel.vue'
import WslConfigPanel from '../features/config/WslConfigPanel.vue'
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
const editorSaving = ref(false)
const proxyApplying = ref(false)

/** 系统转发状态轻量轮询（仅页面可见时 12s）：外部手工改 netsh 也能及时反映 */
let statusPollTimer: number | undefined

onMounted(() => {
  void network.load()
  void network.loadStatus()
  if (distros.items.length === 0) void distros.refresh()
  statusPollTimer = window.setInterval(() => {
    if (document.visibilityState !== 'visible') return
    // silent：轮询不点亮刷新按钮的 loading，避免每 12s 一次视觉抖动
    void network.loadStatus({ silent: true })
  }, 12_000)
})

onUnmounted(() => {
  if (statusPollTimer !== undefined) window.clearInterval(statusPollTimer)
})

function openCreate() {
  editing.value = null
  editorShow.value = true
}

function openEdit(rule: PortForwardRule) {
  editing.value = rule
  editorShow.value = true
}

async function onSave(rule: PortForwardRule, originalId?: string) {
  editorSaving.value = true
  try {
    await network.upsert(rule, originalId)
    message.success(`规则已保存：${rule.id}`)
    // 受控关闭：只有 upsert 成功才关弹窗（失败保留表单供修正 — review 0.1.2 根治）
    editorShow.value = false
    editing.value = null
  } catch (e) {
    message.error(errorLine(e, '保存规则失败'))
  } finally {
    editorSaving.value = false
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
        const removed = await network.remove(rule.id)
        if (!removed) return
        // §13.4 可撤销：通知内提供「撤销」。
        // 撤销闭包携带本次删除的快照：连续删 A、B 后点 A 的撤销恢复 A，
        // 而不是被 lastRemoved=B 覆盖（review 0.1.2 根治）。
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
                  void network
                    .undoRestore(removed)
                    .then(() => message.success('已恢复规则'))
                    .catch((e: unknown) => message.error(errorLine(e, '恢复规则失败')))
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

async function copyText(text: string, okMsg: string) {
  try {
    await navigator.clipboard.writeText(text)
    message.success(okMsg)
  } catch {
    message.warning('复制失败，请手动选择文本')
  }
}

/**
 * 确认弹窗内容（render 函数）：命令块带「复制」按钮——
 * 提权被拒时用户可就地把命令贴进管理员终端，不必手抄（review 0.1.2 根治）。
 * 内联样式：dialog 内容 teleport 出组件作用域，scoped 样式不生效。
 */
function commandConfirmContent(intro: string, commands: string, outro: string) {
  return () =>
    h('div', [
      h('p', { style: 'margin:0 0 8px' }, intro),
      h('div', { style: 'display:flex;gap:8px;align-items:flex-start;margin-bottom:8px' }, [
        h(
          'code',
          {
            style:
              'flex:1;white-space:pre-wrap;word-break:break-all;font-size:12px;' +
              'background:var(--color-bg-sunken,#f1f5f9);padding:8px 10px;border-radius:8px',
          },
          commands,
        ),
        h(
          NButton,
          { size: 'tiny', secondary: true, onClick: () => void copyText(commands, '命令已复制') },
          { default: () => '复制' },
        ),
      ]),
      h('p', { style: 'margin:0;font-size:12px;color:var(--color-text-secondary,#64748b)' }, outro),
    ])
}

async function onApply(rule: PortForwardRule) {
  // §13.4 / §9.6：应用会在系统里开端口，必须展示等价命令并二次确认
  dialog.warning({
    title: '应用转发规则',
    content: commandConfirmContent(
      '将在系统中添加端口转发：',
      ruleApplyCommand(rule),
      '该操作可能触发 UAC 提权确认；权限不足时可复制上述命令到管理员终端执行。',
    ),
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
  const commands = applicable.map((r) => ruleApplyCommand(r)).join('\n')
  dialog.warning({
    title: '应用全部转发规则',
    content: commandConfirmContent(
      `将按顺序执行 ${applicable.length} 条 netsh portproxy 命令` +
        (skipped > 0 ? `（跳过 ${skipped} 条 UDP 规则）` : '') +
        '：',
      commands,
      '该操作可能触发 UAC 提权确认；权限不足时可复制上述命令到管理员终端执行。',
    ),
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
          端口转发 · 镜像网络模式 · 代理配置 · 系统已生效 {{ network.appliedCount }} 条 ·
          <code>netsh interface portproxy</code>
        </p>
      </div>
    </header>

    <p v-if="network.lastError" class="error-banner">
      {{ network.lastError.message }}
      <span v-if="network.lastError.suggestion"> — {{ network.lastError.suggestion }}</span>
    </p>

    <MirrorModeCard
      :status="network.status"
      :loading="network.statusLoading"
      @open-dir="openConfigDir"
    />

    <!-- WSL 全局配置（.wslconfig）编辑面板（0.1.3）；保存后刷新镜像模式状态 -->
    <WslConfigPanel @saved="() => void network.loadStatus()" />

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
      :saving="editorSaving"
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

/* review 0.1.2 审计修复：硬编码 10px 与 ui 包 radius-md 令牌（12px）不一致，统一令牌化 */
.error-banner {
  margin: 0;
  padding: 10px 14px;
  border-radius: var(--radius-md, 12px);
  background: color-mix(in srgb, var(--color-danger) 10%, transparent);
  color: var(--color-danger);
  font-size: 13px;
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
