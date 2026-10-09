/// <reference types="vite/client" />

import type { WslApi } from '../preload/index'

declare global {
  interface Window {
    wslAPI: WslApi
  }
}

export {}
