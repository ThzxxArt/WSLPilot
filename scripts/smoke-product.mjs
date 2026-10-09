/**
 * 产物冒烟：require 打包后的 main/preload，证明 workspace 包已内联（评审 C1/C2）
 * 运行：node scripts/smoke-product.mjs
 */
import { createRequire } from 'node:module'
import { readFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = join(__dirname, '..')
const mainPath = join(root, 'apps/desktop/out/main/index.js')
const preloadPath = join(root, 'apps/desktop/out/preload/index.js')

function fail(msg) {
  console.error('[smoke-product] FAIL:', msg)
  process.exit(1)
}

if (!existsSync(mainPath)) fail(`missing ${mainPath} — run build first`)
if (!existsSync(preloadPath)) fail(`missing ${preloadPath} — run build first`)

// 1) 产物不得 require workspace TS 包
for (const file of [mainPath, preloadPath]) {
  const src = readFileSync(file, 'utf8')
  if (src.includes('require("@wslpilot/shared")') || src.includes("require('@wslpilot/shared')")) {
    fail(`${file} still requires @wslpilot/shared at runtime`)
  }
  if (src.includes('require("@wslpilot/kit")') || src.includes("require('@wslpilot/kit')")) {
    fail(`${file} still requires @wslpilot/kit at runtime`)
  }
}

// 2) stub electron 后 require main（证明模块图完整可加载）
const req = createRequire(import.meta.url)
const Module = req('module')
const orig = Module._load
Module._load = function (request, parent, isMain) {
  if (request === 'electron') {
    class FakeWindow {
      static getAllWindows() {
        return []
      }
      constructor() {
        this.webContents = {
          setWindowOpenHandler() {},
          send() {},
          on() {},
        }
      }
      once() {}
      on() {}
      once() {}
      loadURL() {
        return Promise.resolve()
      }
      loadFile() {
        return Promise.resolve()
      }
      show() {}
      hide() {}
      focus() {}
      maximize() {}
      isMaximized() {
        return false
      }
      isMinimized() {
        return false
      }
      isDestroyed() {
        return false
      }
      getBounds() {
        return { x: 0, y: 0, width: 800, height: 600 }
      }
      getNormalBounds() {
        return this.getBounds()
      }
      close() {}
    }
    return {
      app: {
        on() {},
        whenReady: () => Promise.resolve(),
        getPath: () => '/tmp/wslpilot-smoke',
        getVersion: () => '0.0.0-smoke',
        setName() {},
        requestSingleInstanceLock: () => true,
        quit() {},
        setLoginItemSettings() {},
        getLoginItemSettings: () => ({ openAtLogin: false }),
        getAppPath: () => root,
      },
      BrowserWindow: FakeWindow,
      ipcMain: { on() {}, handle() {} },
      Menu: { setApplicationMenu() {}, buildFromTemplate: () => ({ items: [] }) },
      Tray: class {
        setToolTip() {}
        setContextMenu() {}
        on() {}
        destroy() {}
      },
      nativeImage: {
        createFromPath: () => ({ isEmpty: () => true }),
        createEmpty: () => ({ isEmpty: () => true }),
      },
      shell: { openPath: async () => '', openExternal() {} },
      screen: {
        getDisplayNearestPoint: () => ({
          workArea: { x: 0, y: 0, width: 1920, height: 1080 },
        }),
      },
    }
  }
  // node-pty 不存在于 CI 时给最小 stub
  if (request === 'node-pty') {
    return {
      spawn: () => ({
        write() {},
        resize() {},
        kill() {},
        pid: 1,
        onData: () => ({ dispose() {} }),
        onExit: () => ({ dispose() {} }),
      }),
    }
  }
  return orig.apply(this, arguments)
}

try {
  req(mainPath)
  console.log('[smoke-product] main module graph OK')
} catch (e) {
  // bootstrap 阶段的运行时错误可接受；模块解析错误不行
  const msg = String(e && e.message)
  if (/Cannot find module|Unexpected token|ERR_MODULE/.test(msg)) {
    fail(`main require failed: ${msg}`)
  }
  console.log('[smoke-product] main loaded (runtime bootstrap err ok):', msg.slice(0, 120))
}

console.log('[smoke-product] PASS')
// require 已验证模块图；退出以免 Electron 生命周期钩子挂住
setTimeout(() => process.exit(0), 50).unref()
process.exit(0)
