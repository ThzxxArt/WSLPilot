<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import {
  NButton,
  NCard,
  NRadioGroup,
  NRadio,
  NSwitch,
  NSpace,
  NDivider,
  NTag,
  NInput,
  NInputNumber,
  NSelect,
  useMessage,
} from 'naive-ui'
import { useSettingsStore } from '../stores/settings'
import { errorLine } from '../composables/useAppError'
import { HOTKEY_TABLE } from '../composables/useHotkeys'
import { ACCENT_GRADIENTS, ACCENT_PRIMARY } from '@shared/constants'
import type { AccentName } from '@shared/types'
import { applyAccentToDom, Kbd } from '@wslpilot/ui'

const settings = useSettingsStore()
const message = useMessage()

const accents: { name: AccentName; label: string }[] = [
  { name: 'aurora', label: '极光 Aurora' },
  { name: 'sunset', label: '日落 Sunset' },
  { name: 'ocean', label: '海洋 Ocean' },
  { name: 'forest', label: '森林 Forest' },
]

const selectedAccent = ref<AccentName>(settings.accent)

watch(
  () => settings.accent,
  (a) => (selectedAccent.value = a),
  { immediate: true },
)

const previewGradient = computed(
  () => ACCENT_GRADIENTS[selectedAccent.value] ?? ACCENT_GRADIENTS.aurora,
)
const previewPrimary = computed(() => ACCENT_PRIMARY[selectedAccent.value] ?? ACCENT_PRIMARY.aurora)

async function onAccentChange(name: AccentName) {
  selectedAccent.value = name
  applyAccentToDom(name) // 实时预览，无需保存
  await settings.setAccent(name)
  message.success(`强调色已切换为 ${accents.find((a) => a.name === name)?.label ?? name}`)
}

function openConfigDir() {
  void window.wslAPI.app.openConfigDir()
}

async function browseBackupDir() {
  const picked = await window.wslAPI.app.pickDirectory()
  if (picked) await settings.setBackupDefaultDir(picked)
}

/** 文本输入防抖落盘（review M8）：停止输入 400ms 后写，失败回滚并提示 */
function makeDebouncedSetter<T>(read: () => T, write: (v: T) => Promise<unknown>) {
  let timer: number | undefined
  return (value: T) => {
    if (timer) window.clearTimeout(timer)
    timer = window.setTimeout(() => {
      timer = undefined
      const before = read()
      void write(value).catch((e: unknown) => {
        message.error(errorLine(e, '保存失败'))
        void write(before) // 用写前的值回滚
      })
    }, 400)
  }
}

const setFontFamilyDebounced = makeDebouncedSetter(
  () => settings.terminalFontFamily,
  (v: string) => settings.setTerminalFontFamily(v),
)
const setBackupDirDebounced = makeDebouncedSetter(
  () => settings.backupDefaultDir,
  (v: string) => settings.setBackupDefaultDir(v),
)
const setDefaultShellDebounced = makeDebouncedSetter(
  () => settings.wslDefaultShell,
  (v: string) => settings.setWslDefaultShell(v),
)

/** 配置文件逐个打开（§12.7） */
const configFiles: { key: 'settings' | 'distros' | 'actions' | 'network'; label: string }[] = [
  { key: 'settings', label: 'settings.jsonc' },
  { key: 'distros', label: 'distros.jsonc' },
  { key: 'actions', label: 'actions.jsonc' },
  { key: 'network', label: 'network.jsonc' },
]

function openConfigFile(key: 'settings' | 'distros' | 'actions' | 'network') {
  void window.wslAPI.config.openExternal(key).catch((e: unknown) => {
    message.error(errorLine(e, '打开配置文件失败'))
  })
}

function setFontSize(v: number | null) {
  if (v) void settings.setTerminalFontSize(v)
}

function setScrollback(v: number | null) {
  if (v) void settings.setTerminalScrollback(v)
}

function setKeepRecent(v: number | null) {
  if (v) void settings.setBackupKeepRecent(v)
}
</script>

<template>
  <div class="settings">
    <header class="page-header">
      <h1>设置</h1>
      <p class="sub">应用偏好与配置管理 · 所有修改即时写入 <code>settings.jsonc</code></p>
    </header>

    <n-card title="外观" class="block" :bordered="true">
      <div class="accent-row">
        <div class="accent-picker">
          <div class="label">强调色</div>
          <n-radio-group v-model:value="selectedAccent" @update:value="onAccentChange">
            <n-space>
              <n-radio v-for="a in accents" :key="a.name" :value="a.name">
                {{ a.label }}
              </n-radio>
            </n-space>
          </n-radio-group>
        </div>

        <div class="accent-preview">
          <div class="label">实时预览</div>
          <div class="preview-card">
            <div class="preview-swatch" :style="{ background: previewGradient }" />
            <div class="preview-body">
              <div class="preview-title">WSLPilot</div>
              <div class="preview-text">按钮与高亮将使用此强调色</div>
              <button
                class="preview-btn"
                :style="{ background: previewPrimary }"
                aria-hidden="true"
                disabled
                tabindex="-1"
              >
                主要按钮
              </button>
            </div>
          </div>
        </div>
      </div>

      <n-divider />

      <div class="setting-line">
        <div>
          <div class="label">减弱动效</div>
          <div class="hint">开启后动画时长降为即时切换</div>
        </div>
        <n-switch
          :value="settings.reduceMotion"
          @update:value="(v: boolean) => settings.setReduceMotion(v)"
        />
      </div>
      <div class="setting-line">
        <div>
          <div class="label">界面语言</div>
          <div class="hint">system 跟随操作系统语言</div>
        </div>
        <n-select
          :value="settings.locale"
          size="small"
          style="width: 160px"
          :options="[
            { label: '跟随系统', value: 'system' },
            { label: '简体中文', value: 'zh-CN' },
            { label: 'English', value: 'en-US' },
          ]"
          @update:value="(v: 'system' | 'zh-CN' | 'en-US') => settings.setLocale(v)"
        />
      </div>
      <div class="setting-line">
        <div>
          <div class="label">启动时自动刷新发行版</div>
          <div class="hint">关闭后仅在手动点击「刷新」时查询 wsl 状态</div>
        </div>
        <n-switch
          :value="settings.autoRefreshOnStart"
          @update:value="(v: boolean) => settings.setAutoRefreshOnStart(v)"
        />
      </div>
      <div class="setting-line">
        <div>
          <div class="label">轮询间隔</div>
          <div class="hint">状态刷新频率（1000–60000 毫秒）；窗口失焦时自动暂停</div>
        </div>
        <n-input-number
          :value="settings.pollIntervalMs"
          size="small"
          :min="1000"
          :max="60000"
          :step="500"
          @update:value="(v: number | null) => v && settings.setPollIntervalMs(v)"
        />
      </div>
      <div class="setting-line">
        <div>
          <div class="label">关闭窗口时</div>
          <div class="hint">最小化到托盘（继续后台运行）或直接退出</div>
        </div>
        <n-select
          :value="settings.closeBehavior"
          size="small"
          style="width: 180px"
          :options="[
            { label: '最小化到托盘', value: 'minimizeToTray' },
            { label: '直接退出', value: 'quit' },
          ]"
          @update:value="(v: 'minimizeToTray' | 'quit') => settings.setCloseBehavior(v)"
        />
      </div>
      <div class="setting-line">
        <div>
          <div class="label">开机自启</div>
          <div class="hint">登录 Windows 后自动启动（与托盘菜单同步）</div>
        </div>
        <n-switch
          :value="settings.launchAtLogin"
          @update:value="(v: boolean) => settings.setLaunchAtLogin(v)"
        />
      </div>
    </n-card>

    <n-card title="WSL" class="block">
      <div class="setting-line">
        <div style="flex: 1">
          <div class="label">默认 Shell</div>
          <div class="hint">空 = /bin/bash · 新终端以此启动</div>
          <n-input
            :value="settings.wslDefaultShell"
            size="small"
            style="max-width: 320px; margin-top: 6px"
            placeholder="/bin/bash"
            @update:value="(v: string) => setDefaultShellDebounced(v)"
          />
        </div>
      </div>
      <div class="setting-line">
        <div>
          <div class="label">wsl.conf 变更后自动终止发行版</div>
          <div class="hint">
            保存 /etc/wsl.conf 后自动 terminate 该发行版（完全停止后约 8 秒配置生效）
          </div>
        </div>
        <n-switch
          :value="settings.wslAutoShutdownAfterConfigChange"
          @update:value="(v: boolean) => settings.setWslAutoShutdownAfterConfigChange(v)"
        />
      </div>
    </n-card>

    <n-card title="终端" class="block">
      <div class="setting-line">
        <div style="flex: 1">
          <div class="label">字体</div>
          <n-input
            :value="settings.terminalFontFamily"
            size="small"
            style="max-width: 320px"
            @update:value="(v: string) => setFontFamilyDebounced(v)"
          />
        </div>
      </div>
      <div class="setting-line">
        <div>
          <div class="label">字号</div>
        </div>
        <n-input-number
          :value="settings.terminalFontSize"
          size="small"
          :min="8"
          :max="32"
          @update:value="setFontSize"
        />
      </div>
      <div class="setting-line">
        <div>
          <div class="label">光标样式</div>
        </div>
        <n-select
          :value="settings.terminalCursorStyle"
          size="small"
          style="width: 140px"
          :options="[
            { label: '块状', value: 'block' },
            { label: '下划线', value: 'underline' },
            { label: '竖线', value: 'bar' },
          ]"
          @update:value="(v: 'block' | 'underline' | 'bar') => settings.setTerminalCursorStyle(v)"
        />
      </div>
      <div class="setting-line">
        <div>
          <div class="label">光标闪烁</div>
        </div>
        <n-switch
          :value="settings.terminalCursorBlink"
          @update:value="(v: boolean) => settings.setTerminalCursorBlink(v)"
        />
      </div>
      <div class="setting-line">
        <div>
          <div class="label">回滚缓冲行数</div>
        </div>
        <n-input-number
          :value="settings.terminalScrollback"
          size="small"
          :min="100"
          :max="100000"
          :step="500"
          @update:value="setScrollback"
        />
      </div>
      <div class="setting-line">
        <div>
          <div class="label">行高</div>
          <div class="hint">1–2.5 倍</div>
        </div>
        <n-input-number
          :value="settings.terminalLineHeight"
          size="small"
          :min="1"
          :max="2.5"
          :step="0.1"
          @update:value="(v: number | null) => v && settings.setTerminalLineHeight(v)"
        />
      </div>
      <div class="setting-line">
        <div>
          <div class="label">选中即复制</div>
          <div class="hint">选中文本自动写入剪贴板</div>
        </div>
        <n-switch
          :value="settings.terminalCopyOnSelect"
          @update:value="(v: boolean) => settings.setTerminalCopyOnSelect(v)"
        />
      </div>
      <div class="setting-line">
        <div>
          <div class="label">终端主题</div>
          <div class="hint">auto 内置浅色 · follow-app 跟随强调色 · custom 高对比</div>
        </div>
        <n-select
          :value="settings.terminalTheme"
          size="small"
          style="width: 180px"
          :options="[
            { label: '自动（浅色）', value: 'auto' },
            { label: '跟随强调色', value: 'follow-app' },
            { label: '高对比', value: 'custom' },
          ]"
          @update:value="(v: 'auto' | 'follow-app' | 'custom') => settings.setTerminalTheme(v)"
        />
      </div>
    </n-card>

    <n-card title="备份" class="block">
      <div class="setting-line">
        <div style="flex: 1">
          <div class="label">默认备份目录</div>
          <div class="hint">支持 %USERPROFILE% 等环境变量</div>
          <n-input
            :value="settings.backupDefaultDir"
            size="small"
            style="max-width: 360px; margin-top: 6px"
            @update:value="(v: string) => setBackupDirDebounced(v)"
          />
        </div>
        <n-button size="small" secondary @click="browseBackupDir"> 浏览… </n-button>
      </div>
      <div class="setting-line">
        <div>
          <div class="label">默认格式</div>
          <div class="hint">tar 通用；vhd 仅 WSL2 但导入更快</div>
        </div>
        <n-select
          :value="settings.backupFormat"
          size="small"
          style="width: 200px"
          :options="[
            { label: 'tar 归档', value: 'tar' },
            { label: 'vhd 虚拟磁盘', value: 'vhd' },
          ]"
          @update:value="(v: 'tar' | 'vhd') => settings.setBackupFormat(v)"
        />
      </div>
      <div class="setting-line">
        <div>
          <div class="label">备份保留份数</div>
          <div class="hint">同名发行版自动轮转，超出的旧备份被清理</div>
        </div>
        <n-input-number
          :value="settings.backupKeepRecent"
          size="small"
          :min="1"
          :max="50"
          @update:value="setKeepRecent"
        />
      </div>
      <div class="setting-line">
        <div>
          <div class="label">破坏性操作前自动备份</div>
          <div class="hint">迁移磁盘前先导出一份备份（安全兜底）</div>
        </div>
        <n-switch
          :value="settings.backupAutoBeforeDestructive"
          @update:value="(v: boolean) => settings.setBackupAutoBeforeDestructive(v)"
        />
      </div>
    </n-card>

    <n-card title="高级" class="block">
      <div class="setting-line">
        <div>
          <div class="label">显示等价命令行</div>
          <div class="hint">操作时展示将执行的 wsl.exe 命令</div>
        </div>
        <n-switch
          :value="settings.showRawCommand"
          @update:value="(v: boolean) => settings.setShowRawCommand(v)"
        />
      </div>

      <div class="setting-line">
        <div>
          <div class="label">破坏性操作二次确认</div>
          <div class="hint">注销、迁移等操作前弹出确认框</div>
        </div>
        <n-switch
          :value="settings.confirmDestructive"
          @update:value="(v: boolean) => settings.setConfirmDestructive(v)"
        />
      </div>
      <div class="setting-line">
        <div>
          <div class="label">日志级别</div>
          <div class="hint">logs/app-YYYYMMDD.log 的记录粒度</div>
        </div>
        <n-select
          :value="settings.logLevel"
          size="small"
          style="width: 140px"
          :options="[
            { label: 'trace', value: 'trace' },
            { label: 'debug', value: 'debug' },
            { label: 'info', value: 'info' },
            { label: 'warn', value: 'warn' },
            { label: 'error', value: 'error' },
          ]"
          @update:value="
            (v: 'trace' | 'debug' | 'info' | 'warn' | 'error') => settings.setLogLevel(v)
          "
        />
      </div>
      <div class="setting-line">
        <div>
          <div class="label">硬件加速</div>
          <div class="hint">关闭可解决部分显卡驱动白屏问题；重启应用后生效</div>
        </div>
        <n-switch
          :value="settings.hardwareAcceleration"
          @update:value="(v: boolean) => settings.setHardwareAcceleration(v)"
        />
      </div>
    </n-card>

    <n-card title="快捷键" class="block">
      <p class="hint">全局可用 · macOS 上 Ctrl 对应 ⌘</p>
      <div class="hotkey-list">
        <div v-for="h in HOTKEY_TABLE" :key="h.id" class="hotkey-row">
          <span class="hotkey-label">{{ h.label }}</span>
          <Kbd :keys="h.keys" />
        </div>
      </div>
    </n-card>

    <n-card title="配置目录" class="block">
      <p class="hint">所有持久化状态为人类可读 JSONC，路径可见、内容可改、可纳入 Git。</p>
      <n-space style="margin-top: 12px" align="center">
        <n-button @click="openConfigDir"> 打开配置目录 </n-button>
        <n-tag
          v-for="f in configFiles"
          :key="f.key"
          :bordered="false"
          type="info"
          class="config-tag"
          role="button"
          tabindex="0"
          @click="openConfigFile(f.key)"
          @keydown.enter="openConfigFile(f.key)"
        >
          {{ f.label }}
        </n-tag>
      </n-space>
    </n-card>

    <n-card title="关于" class="block">
      <p class="hint">WSLPilot v{{ settings.version || '—' }} · MIT License</p>
      <p class="hint">让 WSL 管理像驾驶一样从容。</p>
    </n-card>
  </div>
</template>

<style scoped>
.settings {
  padding: 24px;
  max-width: 720px;
  margin: 0 auto;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.page-header h1 {
  font-size: 24px;
  font-weight: 650;
  color: var(--color-text-primary);
}

.sub {
  margin-top: 4px;
  color: var(--color-text-secondary);
  font-size: 13px;
}

.block {
  border-radius: var(--radius-lg);
}

.label {
  font-size: 13px;
  font-weight: 600;
  color: var(--color-text-primary);
  margin-bottom: 6px;
}

.hint {
  font-size: 12px;
  color: var(--color-text-secondary);
  line-height: 1.5;
}

.accent-row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 24px;
}

@media (width <= 640px) {
  .accent-row {
    grid-template-columns: 1fr;
  }
}

.preview-card {
  display: flex;
  gap: 12px;
  padding: 14px;
  border-radius: var(--radius-md);
  background: var(--color-bg-sunken);
  border: 1px solid var(--color-border-subtle);
}

.preview-swatch {
  width: 48px;
  height: 48px;
  border-radius: 12px;
  flex-shrink: 0;
  transition: background var(--dur-slow) var(--ease-standard);
}

.preview-title {
  font-weight: 650;
  font-size: 14px;
  color: var(--color-text-primary);
}

.preview-text {
  font-size: 12px;
  color: var(--color-text-secondary);
  margin: 2px 0 8px;
}

.preview-btn {
  height: 28px;
  padding: 0 12px;
  border-radius: 8px;
  color: #fff;
  font-size: 12px;
  font-weight: 600;
  transition: background var(--dur-base) var(--ease-standard);
}

.setting-line {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 10px 0;
}

.setting-line + .setting-line {
  border-top: 1px solid var(--color-border-subtle);
}

.config-tag {
  cursor: pointer;
}

.config-tag:hover {
  opacity: 0.85;
}

.hotkey-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-top: 10px;
}

.hotkey-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 8px 0;
  border-top: 1px solid var(--color-border-subtle);
}

.hotkey-row:first-child {
  border-top: none;
}

.hotkey-label {
  font-size: 13px;
  color: var(--color-text-primary);
}
</style>
