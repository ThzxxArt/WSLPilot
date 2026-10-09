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
      meta: { title: '驾驶舱', icon: 'plane' },
    },
    {
      path: '/distros',
      name: 'distros',
      component: () => import('../views/DistrosView.vue'),
      meta: { title: '发行版', icon: 'linux' },
    },
    {
      path: '/terminal',
      name: 'terminal',
      component: () => import('../views/TerminalView.vue'),
      meta: { title: '终端', icon: 'terminal' },
    },
    {
      path: '/network',
      name: 'network',
      component: () => import('../views/NetworkView.vue'),
      meta: { title: '网络', icon: 'network' },
    },
    {
      path: '/backup',
      name: 'backup',
      component: () => import('../views/BackupView.vue'),
      meta: { title: '备份迁移', icon: 'backup' },
    },
    {
      path: '/settings',
      name: 'settings',
      component: () => import('../views/SettingsView.vue'),
      meta: { title: '设置', icon: 'settings' },
    },
  ],
})
