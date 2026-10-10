<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { NButton, NSelect, NSpin, NSwitch, NTag, useMessage } from 'naive-ui'
import { EmptyState } from '@ui/components'
import {
  canAttach,
  canDetach,
  canToggleShare,
  USBIPD_INSTALL_COMMAND,
  usbipdOpLabel,
  usbipdStateLabel,
} from '@shared/usbipd'
import type { UsbDevice } from '@shared/types'
import { useDevicesStore } from '../stores/devices'
import { useDistrosStore } from '../stores/distros'
import { errorLine } from '../composables/useAppError'

/**
 * USB 设备页（M6 usbipd，可选 · 设计书 §12.6）。
 * usbipd 未安装 → 安装引导；已安装 → 设备表 + 绑定/附加开关 + 状态徽章。
 */
const devices = useDevicesStore()
const distros = useDistrosStore()
const message = useMessage()

const attachTarget = ref<string | null>(null)

onMounted(() => {
  void devices.load()
  if (distros.items.length === 0) void distros.refresh()
})

const distroOptions = computed(() => [
  { label: '默认发行版', value: '' },
  ...distros.items.map((d) => ({
    label: d.meta?.alias ? `${d.meta.alias}（${d.name}）` : d.name,
    value: d.name,
  })),
])

const installed = computed(() => devices.status.installed)
/** 已安装但调用失败（服务异常等）：如实提示，不误导重装 */
const statusError = computed(() => devices.status.error ?? '')

function stateType(state: UsbDevice['state']): 'success' | 'info' | 'warning' | 'default' {
  switch (state) {
    case 'attached':
      return 'success'
    case 'shared':
      return 'info'
    case 'not-attached':
      return 'default'
    case 'not-shared':
      return 'warning'
    default:
      return 'default'
  }
}

async function copyInstall() {
  try {
    await navigator.clipboard.writeText(USBIPD_INSTALL_COMMAND)
    message.success('安装命令已复制')
  } catch {
    message.warning('复制失败，请手动选择文本')
  }
}

async function onToggleShare(d: UsbDevice, shared: boolean) {
  try {
    if (shared) {
      await devices.bind(d.busId)
      message.success(`已提交绑定 ${d.busId}（${usbipdOpLabel('bind')}，需管理员权限）`)
    } else {
      await devices.unbind(d.busId)
      message.success(`已提交解除绑定 ${d.busId}`)
    }
    void devices.refresh()
  } catch (e) {
    message.error(errorLine(e, shared ? '绑定设备失败' : '解除绑定失败'))
    void devices.refresh()
  }
}

async function onToggleAttach(d: UsbDevice, attached: boolean) {
  try {
    if (attached) {
      await devices.attach(d.busId, attachTarget.value || undefined)
      message.success(`已附加 ${d.busId} 到 WSL`)
    } else {
      await devices.detach(d.busId)
      message.success(`已断开 ${d.busId}`)
    }
    void devices.refresh()
  } catch (e) {
    message.error(errorLine(e, attached ? '附加设备失败' : '断开设备失败'))
    void devices.refresh()
  }
}
</script>

<template>
  <div class="page">
    <header class="page-header">
      <div>
        <h1>USB 设备</h1>
        <p class="sub">
          usbipd 绑定与附加管理 · 仅在安装了
          <code>usbipd</code> 的系统上可用
        </p>
      </div>
      <div class="header-actions">
        <n-button
          size="small"
          secondary
          :loading="devices.loading"
          @click="() => devices.refresh()"
        >
          刷新
        </n-button>
      </div>
    </header>

    <!-- usbipd 未安装：安装引导（可选能力，不阻断其它功能） -->
    <section v-if="!installed && !devices.loading" class="card">
      <EmptyState description="未检测到 usbipd，无法管理 USB 设备" illustration="🔌">
        <div class="install">
          <p class="install-text">
            usbipd-win 让 Windows 上的 USB 设备可以附加到 WSL 发行版。安装后回到本页即可使用：
          </p>
          <code class="install-cmd">{{ USBIPD_INSTALL_COMMAND }}</code>
          <div class="install-actions">
            <n-button size="small" type="primary" secondary @click="copyInstall">
              复制安装命令
            </n-button>
            <n-button size="small" quaternary @click="() => devices.refresh()">
              我已安装，重新检测
            </n-button>
          </div>
        </div>
      </EmptyState>
    </section>

    <!-- usbipd 已安装但调用失败：如实提示（不是"未安装"，不要误导重装） -->
    <section v-else-if="installed && statusError && !devices.loading" class="card">
      <EmptyState description="usbipd 调用失败，无法读取设备列表" illustration="⚠">
        <p class="install-text">{{ statusError }}</p>
        <n-button size="small" secondary @click="() => devices.refresh()">重新检测</n-button>
      </EmptyState>
    </section>

    <!-- 设备表 -->
    <section v-else class="card table-card">
      <div class="head">
        <div>
          <h2 class="panel-title">本机 USB 设备</h2>
          <p class="sub">
            共 {{ devices.items.length }} 个 · 已附加 {{ devices.attachedCount }} · 已共享
            {{ devices.sharedCount }}
            <template v-if="devices.status.version">
              · usbipd {{ devices.status.version }}</template
            >
          </p>
        </div>
        <div class="head-actions">
          <span class="label">附加到</span>
          <n-select
            v-model:value="attachTarget"
            :options="distroOptions"
            size="small"
            class="distro-select"
            placeholder="默认发行版"
          />
        </div>
      </div>

      <n-spin :show="devices.loading">
        <EmptyState
          v-if="devices.items.length === 0"
          description="没有发现 USB 设备"
          illustration="🔌"
        />

        <table v-else class="table">
          <thead>
            <tr>
              <th>BUSID</th>
              <th>VID:PID</th>
              <th>设备</th>
              <th>状态</th>
              <th>共享</th>
              <th>附加到 WSL</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="d in devices.items" :key="d.busId">
              <td class="mono">{{ d.busId }}</td>
              <td class="mono">{{ d.vid }}:{{ d.pid }}</td>
              <td class="desc">{{ d.description }}</td>
              <td>
                <n-tag size="tiny" :bordered="false" :type="stateType(d.state)">
                  {{ usbipdStateLabel(d.state) }}
                </n-tag>
              </td>
              <td>
                <n-switch
                  size="small"
                  :value="d.state === 'shared' || d.state === 'attached'"
                  :disabled="!canToggleShare(d.state) || d.state === 'attached'"
                  @update:value="(v: boolean) => onToggleShare(d, v)"
                />
              </td>
              <td>
                <n-switch
                  size="small"
                  :value="d.state === 'attached'"
                  :disabled="d.state === 'attached' ? !canDetach(d.state) : !canAttach(d.state)"
                  @update:value="(v: boolean) => onToggleAttach(d, v)"
                />
              </td>
            </tr>
          </tbody>
        </table>
      </n-spin>

      <p class="footnote">
        「共享」对应 <code>usbipd bind</code>（需要管理员权限）；「附加」对应
        <code>usbipd attach --wsl</code>（usbipd 2.0+）。附加后设备出现在 WSL 发行版的
        <code>/dev</code> 中。
      </p>
    </section>
  </div>
</template>

<style scoped>
.page {
  padding: 24px;
  max-width: 1000px;
  margin: 0 auto;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.page-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
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

.install {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  max-width: 520px;
}

.install-text {
  margin: 0;
  font-size: 12.5px;
  color: var(--color-text-secondary);
  line-height: 1.7;
  text-align: center;
}

.install-cmd {
  display: block;
  width: 100%;
  padding: 10px 12px;
  border-radius: var(--radius-md);
  background: var(--color-bg-sunken);
  font-family: var(--font-mono);
  font-size: 12px;
  color: var(--color-text-primary);
  text-align: left;
  word-break: break-all;
}

.install-actions {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
  justify-content: center;
}

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
  align-items: center;
  gap: 8px;
}

.label {
  font-size: 12px;
  color: var(--color-text-secondary);
  font-weight: 600;
}

.distro-select {
  width: 220px;
}

.panel-title {
  font-size: 15px;
  font-weight: 600;
  margin: 0;
  color: var(--color-text-primary);
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

.desc {
  max-width: 320px;
}

.footnote {
  margin: 0;
  font-size: 11.5px;
  color: var(--color-text-tertiary);
  line-height: 1.7;
}

.footnote code {
  background: var(--color-bg-sunken);
  padding: 1px 5px;
  border-radius: 4px;
  font-size: 11px;
}
</style>
