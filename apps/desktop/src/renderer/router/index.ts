import { createRouter, createWebHashHistory } from 'vue-router'

export const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    {
      path: '/',
      redirect: '/dashboard',
    },
    {
      path: '/dashboard',
      name: 'dashboard',
      component: () => import('../views/DashboardView.vue'),
      meta: { title: '驾驶舱' },
    },
    {
      path: '/distros',
      name: 'distros',
      component: () => import('../views/DistrosView.vue'),
      meta: { title: '发行版' },
    },
    {
      path: '/terminal',
      name: 'terminal',
      component: () => import('../views/TerminalView.vue'),
      meta: { title: '终端' },
    },
    {
      path: '/network',
      name: 'network',
      component: () => import('../views/NetworkView.vue'),
      meta: { title: '网络' },
    },
    {
      path: '/backup',
      name: 'backup',
      component: () => import('../views/BackupView.vue'),
      meta: { title: '备份迁移' },
    },
    {
      path: '/devices',
      name: 'devices',
      component: () => import('../views/DevicesView.vue'),
      meta: { title: 'USB 设备' },
    },
    {
      path: '/settings',
      name: 'settings',
      component: () => import('../views/SettingsView.vue'),
      meta: { title: '设置' },
    },
  ],
})

// meta.title 是窗口标题的真实消费点（此前 meta 全量为幽灵字段 — review 根治）
router.afterEach((to) => {
  const title = typeof to.meta.title === 'string' ? to.meta.title : ''
  document.title = title ? `${title} · WSLPilot` : 'WSLPilot'
})
