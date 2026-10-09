/** 发行版状态中文文案 */
export function stateLabel(s: string): string {
  switch (s) {
    case 'Running':
      return '运行中'
    case 'Stopped':
      return '已停止'
    case 'Installing':
      return '安装中'
    case 'Uninstalling':
      return '卸载中'
    case 'Converting':
      return '转换中'
    case 'Unknown':
      return '未知'
    default:
      return s || '未知'
  }
}
