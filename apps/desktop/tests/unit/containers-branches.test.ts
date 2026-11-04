import { describe, it, expect } from 'vitest'
import {
  assertArgValue,
  assertCopyPath,
  assertDuration,
  assertEnvKey,
  assertEnvValue,
  assertHealthSpec,
  assertHostMountPath,
  assertImageRef,
  assertLinuxContainerPath,
  assertMemorySize,
  assertPort,
  assertPortAddress,
  assertContainerRef,
  buildContainerListArgs,
  buildContainerLogsArgs,
  buildContainerStopArgs,
  buildImageListArgs,
  buildImagePruneArgs,
  buildSessionListArgs,
  buildStatsArgs,
  buildSystemInfoArgs,
  normalizeContainerHealth,
  normalizeContainerState,
  parseContainerDetail,
  parseContainerSummary,
  parseContainerTable,
  parseImageList,
  parseJsonList,
  parseNetworks,
  parseSessionList,
  parseStats,
  parseSystemInfo,
  parseVolumes,
  previewWslcCommand,
} from '@wslpilot/shared'

describe('containers.ts 退化输入分支（0.2.0 覆盖率）', () => {
  it('所有校验器对非字符串/空值 fail-closed', () => {
    for (const fn of [
      assertContainerRef,
      assertImageRef,
      assertLinuxContainerPath,
      assertHostMountPath,
      assertEnvKey,
      assertMemorySize,
      assertPortAddress,
      assertDuration,
      assertCopyPath,
    ]) {
      expect(() => fn(null)).toThrow()
      expect(() => fn(undefined)).toThrow()
      expect(() => fn(42)).toThrow()
    }
    expect(() => assertPort('x')).toThrow()
    expect(() => assertArgValue('a\u0000b')).toThrow()
    expect(() => assertEnvValue('a\nb')).toThrow()
    expect(() => assertEnvValue('x'.repeat(9000))).toThrow()
  })

  it('健康检查可选字段与非法重试/时长', () => {
    expect(assertHealthSpec(undefined)).toBeUndefined()
    expect(assertHealthSpec({ cmd: '  ' })).toBeUndefined()
    expect(
      assertHealthSpec({ cmd: 'true', interval: '1m30s', timeout: '500ms', retries: 0 }),
    ).toEqual({ cmd: 'true', interval: '1m30s', timeout: '500ms', retries: 0 })
    expect(() => assertHealthSpec({ cmd: 'true', retries: 101 })).toThrow()
    expect(() => assertHealthSpec({ cmd: 'true', interval: '0s' })).toThrow()
    expect(() => assertHealthSpec({ cmd: 'bad\u0001' })).toThrow()
  })

  it('状态/健康别名全覆盖', () => {
    expect(normalizeContainerState('运行中')).toBe('running')
    expect(normalizeContainerState('已停止')).toBe('exited')
    expect(normalizeContainerState('已创建')).toBe('created')
    expect(normalizeContainerState('已暂停')).toBe('paused')
    expect(normalizeContainerState('已死亡')).toBe('dead')
    expect(normalizeContainerState('restarting')).toBe('running')
    for (const h of ['healthy', 'unhealthy', 'starting', 'none', '???']) {
      expect(normalizeContainerHealth(h)).toBe(h === '???' ? 'unknown' : h)
    }
    expect(normalizeContainerHealth(undefined)).toBe('none')
  })

  it('parseJsonList 的包装对象 / 空输入 / 数组 / NDJSON', () => {
    expect(parseJsonList([])).toEqual([])
    expect(parseJsonList('')).toEqual([])
    expect(parseJsonList('{"containers":[{"a":1}]}')).toEqual([{ a: 1 }])
    expect(parseJsonList({ items: [{ b: 2 }] })).toEqual([{ b: 2 }])
    expect(parseJsonList({ unknown: [] })).toEqual([])
    expect(parseJsonList('{"a":1}\n{"b":2}')).toEqual([{ a: 1 }, { b: 2 }])
  })

  it('容器摘要 / 详情 / 表格的缺省与坏行', () => {
    expect(parseContainerSummary(null)).toBeNull()
    expect(parseContainerSummary({})).toBeNull()
    expect(parseContainerSummary({ ID: 'abc' })).toMatchObject({ name: 'abc' })
    expect(parseContainerDetail({})).toBeNull()
    expect(
      parseContainerDetail({
        ID: 'a',
        Name: 'n',
        Mounts: [null, { Source: 'D:/a' }],
        Networks: [],
        Command: 'not-array',
      }),
    ).toMatchObject({ mounts: [], networks: [] })
    expect(parseContainerTable('')).toEqual([])
    expect(parseContainerTable('abc123  nginx  "x"  Up 2 hours  8080->80/tcp  web')).toEqual([
      expect.objectContaining({ id: 'abc123', name: 'web', state: 'running' }),
    ])
    expect(parseContainerTable('abc123   nginx')).toEqual([
      expect.objectContaining({ id: 'abc123', state: 'unknown' }),
    ])
  })

  it('镜像/统计/网络/卷的表格回退与坏字段', () => {
    expect(
      parseImageList(
        'REPOSITORY  TAG  IMAGE ID  CREATED  SIZE\nnginx  latest  i1  2 days ago  10MiB',
      ),
    ).toEqual([
      expect.objectContaining({ repository: 'nginx', tag: 'latest', sizeBytes: 10 * 1024 ** 2 }),
    ])
    expect(parseImageList('bad-line')).toEqual([])
    expect(parseStats('{"Container":"c","MemUsage":"1.5MiB / 2GiB"}')[0]).toMatchObject({
      memUsedBytes: Math.round(1.5 * 1024 ** 2),
      memLimitBytes: 2 * 1024 ** 3,
    })
    expect(parseStats('null')).toEqual([])
    expect(
      parseNetworks('NETWORK ID  NAME  DRIVER  SCOPE\nn1  net  bridge  local')[0],
    ).toMatchObject({ id: 'n1', name: 'net', driver: 'bridge' })
    expect(parseVolumes('DRIVER  VOLUME NAME\nlocal  vol')[0]).toMatchObject({
      name: 'vol',
      driver: 'local',
    })
    expect(parseSessionList('bad')).toEqual([])
  })

  it('system info / 列表 argv 的 json=false 分支', () => {
    expect(parseSystemInfo(null)).toEqual({ version: '', raw: '' })
    expect(buildContainerListArgs(true, false)).toEqual(['container', 'list', '--all'])
    expect(buildImageListArgs(false)).toEqual(['image', 'list'])
    expect(buildStatsArgs(false, false)).toEqual(['stats'])
    expect(buildSystemInfoArgs(false)).toEqual(['system', 'info'])
    expect(buildSessionListArgs(false)).toEqual(['system', 'session', 'list'])
    expect(buildContainerLogsArgs('c', false, 0)).toEqual(['container', 'logs', '--tail', '1', 'c'])
    expect(buildContainerStopArgs('c', 5)).toEqual(['stop', '-t', '5', 'c'])
    expect(buildImagePruneArgs(true)).toEqual(['image', 'prune', '--all'])
  })

  it('preview 不脱敏分支', () => {
    expect(previewWslcCommand(['run', '-e', 'A=1'], { redactSecrets: false })).toContain('A=1')
  })
})
