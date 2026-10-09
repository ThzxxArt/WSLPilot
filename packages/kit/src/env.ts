/**
 * 环境探测 — 主进程启动时调用
 */
export interface EnvInfo {
  platform: NodeJS.Platform
  isWindows: boolean
  isDev: boolean
  appVersion: string
  nodeVersion: string
}

export function getEnvInfo(appVersion: string): EnvInfo {
  return {
    platform: process.platform,
    isWindows: process.platform === 'win32',
    isDev: process.env.NODE_ENV === 'development' || !!process.env.VITE_DEV_SERVER_URL,
    appVersion,
    nodeVersion: process.versions.node,
  }
}
