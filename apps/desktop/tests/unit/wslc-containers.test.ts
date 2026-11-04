import { describe, it, expect } from 'vitest'
import {
  assertContainerName,
  assertEnvKey,
  assertHostMountPath,
  assertImageRef,
  assertLinuxContainerPath,
  assertMemorySize,
  assertMount,
  assertPort,
  buildContainerCopyArgs,
  buildContainerListArgs,
  buildContainerLogsArgs,
  buildContainerPruneArgs,
  buildContainerRemoveArgs,
  buildContainerRestartArgs,
  buildContainerRunArgs,
  buildContainerStartArgs,
  buildContainerStopArgs,
  buildEventsArgs,
  buildImageBuildArgs,
  buildImageListArgs,
  buildImagePruneArgs,
  buildImagePullArgs,
  buildImageRemoveArgs,
  buildNetworkConnectArgs,
  buildNetworkCreateArgs,
  buildNetworkDisconnectArgs,
  buildNetworkPruneArgs,
  buildNetworkRemoveArgs,
  buildSessionListArgs,
  buildSessionTerminateArgs,
  buildStatsArgs,
  buildSystemInfoArgs,
  buildVolumeCreateArgs,
  buildVolumePruneArgs,
  buildVolumeRemoveArgs,
  defaultContainerRecipe,
  emptyWslcSettings,
  normalizeContainerHealth,
  normalizeContainerState,
  normalizeHealthSpec,
  parseContainerDetail,
  parseContainerList,
  parseContainerSummary,
  parseContainerTable,
  parseImageList,
  parseJsonLines,
  parseNetworks,
  parsePorts,
  parseSessionList,
  parseStats,
  parseSystemInfo,
  parseSystemInfoSessions,
  parseVolumes,
  previewWslcCommand,
  recipeToRunSpec,
  type ContainerRecipe,
  type ContainerRunSpec,
} from '@wslpilot/shared'

const EMPTY_SPEC: ContainerRunSpec = {
  image: 'ubuntu:latest',
  ports: [],
  mounts: [],
  env: {},
}

describe('容器参数校验（正例）', () => {
  it('容器名：字母/数字开头，允许 _ . -，1–63 位', () => {
    expect(assertContainerName('web')).toBe('web')
    expect(assertContainerName(' Web_1.test ')).toBe('Web_1.test')
    expect(assertContainerName('a'.repeat(63))).toHaveLength(63)
  })

  it('镜像引用：tag / digest / registry 路径', () => {
    expect(assertImageRef('nginx:latest')).toBe('nginx:latest')
    expect(assertImageRef('ghcr.io/org/app@sha256:abc123')).toBe('ghcr.io/org/app@sha256:abc123')
    expect(assertImageRef('localhost:5000/app:1.0')).toBe('localhost:5000/app:1.0')
  })

  it('Linux 容器路径必须是绝对路径', () => {
    expect(assertLinuxContainerPath('/usr/share/nginx/html')).toBe('/usr/share/nginx/html')
    expect(assertLinuxContainerPath('/data/a b')).toBe('/data/a b')
  })

  it('主机挂载路径支持盘符与 UNC，统一为 /', () => {
    expect(assertHostMountPath('D:\\www')).toBe('D:/www')
    expect(assertHostMountPath('\\\\server\\share\\dir')).toBe('//server/share/dir')
  })

  it('端口 / 环境变量名 / 内存大小', () => {
    expect(assertPort(1)).toBe(1)
    expect(assertPort(65535)).toBe(65535)
    expect(assertEnvKey('PATH')).toBe('PATH')
    expect(assertEnvKey('_A1')).toBe('_A1')
    expect(assertMemorySize('512M')).toBe('512M')
    expect(assertMemorySize('2GB')).toBe('2GB')
    expect(assertMemorySize('1024')).toBe('1024')
  })
})

describe('容器参数校验（反例：注入 / 逃逸 / 越界）', () => {
  it('非法容器名', () => {
    for (const bad of ['', ' ', '.hidden', '-flag', 'a b', 'a/b', 'a'.repeat(64), 'a\nb']) {
      expect(() => assertContainerName(bad)).toThrow()
    }
    expect(() => assertContainerName(null)).toThrow()
  })

  it('非法镜像引用（空格 / 控制字符 / 注入元字符）', () => {
    for (const bad of ['', 'nginx latest', '$(rm -rf /)', 'a;b', 'a\nb', 'a'.repeat(256)]) {
      expect(() => assertImageRef(bad)).toThrow()
    }
  })

  it('非法容器路径（相对 / 穿越 / 控制字符）', () => {
    for (const bad of ['', 'usr/bin', '/a/../b', '/a\nb', '/'.repeat(1025)]) {
      expect(() => assertLinuxContainerPath(bad)).toThrow()
    }
  })

  it('非法主机路径（相对 / 穿越 / UNC 逃逸）', () => {
    for (const bad of ['', 'www', 'D:\\a\\..\\b', '\\\\server', 'D:/a\nb']) {
      expect(() => assertHostMountPath(bad)).toThrow()
    }
  })

  it('非法端口 / 环境变量名 / 内存', () => {
    for (const bad of [0, 65536, 1.5, 'x', -1]) {
      expect(() => assertPort(bad)).toThrow()
    }
    for (const bad of ['', '1ABC', 'A-B', 'A B', 'A'.repeat(101)]) {
      expect(() => assertEnvKey(bad)).toThrow()
    }
    for (const bad of ['', '12XB', '-1G', '1.5G', 'GB']) {
      expect(() => assertMemorySize(bad)).toThrow()
    }
  })
})

describe('状态归一化', () => {
  it('容器状态别名', () => {
    expect(normalizeContainerState('Up')).toBe('running')
    expect(normalizeContainerState('RUNNING')).toBe('running')
    expect(normalizeContainerState('stopped')).toBe('exited')
    expect(normalizeContainerState('Created')).toBe('created')
    expect(normalizeContainerState('paused')).toBe('paused')
    expect(normalizeContainerState('dead')).toBe('dead')
    expect(normalizeContainerState('wat')).toBe('unknown')
    expect(normalizeContainerState(undefined)).toBe('unknown')
  })

  it('健康状态别名', () => {
    expect(normalizeContainerHealth('healthy')).toBe('healthy')
    expect(normalizeContainerHealth('unhealthy')).toBe('unhealthy')
    expect(normalizeContainerHealth('starting')).toBe('starting')
    expect(normalizeContainerHealth('none')).toBe('none')
    expect(normalizeContainerHealth('')).toBe('none')
    expect(normalizeContainerHealth('???')).toBe('unknown')
  })
})

describe('端口解析', () => {
  it('解析 wslc run / docker ps / 对象形式', () => {
    expect(parsePorts('8080:80')).toEqual([{ host: 8080, container: 80 }])
    expect(parsePorts('127.0.0.1:8080:80')).toEqual([
      { host: 8080, container: 80, address: '127.0.0.1' },
    ])
    expect(parsePorts('127.0.0.1:8080->80/tcp')).toEqual([
      { host: 8080, container: 80, address: '127.0.0.1' },
    ])
    expect(parsePorts('8080->80/tcp, 9090->90/udp')).toEqual([
      { host: 8080, container: 80 },
      { host: 9090, container: 90 },
    ])
    expect(parsePorts([{ HostPort: 8080, ContainerPort: 80, HostIp: '0.0.0.0' }])).toEqual([
      { host: 8080, container: 80, address: '0.0.0.0' },
    ])
    expect(parsePorts({ hostPort: 1, containerPort: 2 })).toEqual([{ host: 1, container: 2 }])
  })

  it('非法端口静默丢弃（不产生脏数据）', () => {
    expect(parsePorts('0:80')).toEqual([])
    expect(parsePorts('70000:80')).toEqual([])
    expect(parsePorts('abc')).toEqual([])
    expect(parsePorts(null)).toEqual([])
    expect(
      parsePorts([
        { host: 1, container: 2 },
        { host: 0, container: 2 },
      ]),
    ).toHaveLength(1)
  })
})

describe('输出解析', () => {
  it('解析容器摘要（docker/wslc 字段别名）', () => {
    const s = parseContainerSummary({
      ID: 'abc123',
      Names: ['/web'],
      Image: 'nginx:latest',
      State: 'running',
      Status: 'Up 2 hours (healthy)',
      Ports: '8080->80/tcp',
      CreatedAt: '2026-01-01',
    })
    expect(s).toMatchObject({
      id: 'abc123',
      name: 'web',
      image: 'nginx:latest',
      state: 'running',
      health: 'healthy',
      ports: [{ host: 8080, container: 80 }],
    })
  })

  it('缺少 id/name → null；数组与 NDJSON 列表', () => {
    expect(parseContainerSummary({})).toBeNull()
    expect(parseContainerSummary(null)).toBeNull()
    const list = parseContainerList(
      '{"ID":"a","Name":"one","State":"running"}\nnot json\n{"ID":"b","Name":"two","State":"exited"}\n',
    )
    expect(list.map((x) => x.name)).toEqual(['one', 'two'])
    expect(parseContainerList([{ ID: 'c', Name: 'three' }])).toHaveLength(1)
  })

  it('表格回退跳过表头并解析状态/端口', () => {
    const rows = parseContainerTable(
      [
        'CONTAINER ID   IMAGE          COMMAND   STATUS         PORTS                    NAMES',
        'abc123         nginx:latest   "nginx"   Up 2 hours     0.0.0.0:8080->80/tcp     web',
      ].join('\n'),
    )
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ id: 'abc123', name: 'web', state: 'running' })
  })

  it('容器详情：Env / Command / Mounts / Networks', () => {
    const d = parseContainerDetail({
      ID: 'abc',
      Name: 'web',
      State: 'running',
      Config: { Env: ['A=1', 'B=x=y', 'NOEQ'] },
      Command: ['nginx', '-g', 'daemon off;'],
      Mounts: [{ Source: 'D:/www', Destination: '/html', RW: false }],
      Networks: [{ Name: 'bridge' }],
    })
    expect(d?.env).toEqual({ A: '1', B: 'x=y' })
    expect(d?.command).toEqual(['nginx', '-g', 'daemon off;'])
    expect(d?.mounts).toEqual([{ host: 'D:/www', container: '/html', readOnly: true }])
    expect(d?.networks).toEqual(['bridge'])
  })

  it('镜像列表：默认 tag latest，非法行丢弃', () => {
    const rows = parseImageList(
      '{"ID":"sha","Repository":"nginx","Tag":"1.25","Size":1024,"Containers":2}\n{"Tag":""}',
    )
    expect(rows).toEqual([
      {
        id: 'sha',
        repository: 'nginx',
        tag: '1.25',
        sizeBytes: 1024,
        createdAt: '',
        containers: 2,
      },
    ])
  })

  it('统计：CPU 百分号、字节单位换算', () => {
    const [s] = parseStats(
      '{"Container":"abc","Name":"web","CPU":"12.5%","MemUsage":"1.5MiB","MemLimit":"2GiB","NetIO":"1kB","NetTx":"2MB","BlockIO":"3GB","BlockWrite":"4TB","PIDs":7}',
    )
    expect(s!.cpuPercent).toBe(12.5)
    expect(s!.memUsedBytes).toBe(Math.round(1.5 * 1024 ** 2))
    expect(s!.memLimitBytes).toBe(2 * 1024 ** 3)
    expect(s!.netRxBytes).toBe(1024)
    expect(s!.netTxBytes).toBe(2 * 1024 ** 2)
    expect(s!.blockReadBytes).toBe(3 * 1024 ** 3)
    expect(s!.blockWriteBytes).toBe(4 * 1024 ** 4)
    expect(s!.pids).toBe(7)
    expect(s!.sampledAt).toBeTruthy()
  })

  it('网络 / 卷 / 会话 / 系统信息', () => {
    expect(
      parseNetworks(
        '{"ID":"n1","Name":"net","Driver":"bridge","Subnet":"172.18.0.0/16","Containers":["a"]}',
      ),
    ).toEqual([
      {
        id: 'n1',
        name: 'net',
        driver: 'bridge',
        subnet: '172.18.0.0/16',
        gateway: undefined,
        internal: false,
        containers: ['a'],
      },
    ])
    expect(parseVolumes('{"Name":"vol","Driver":"local","Mountpoint":"/mnt/vol"}')).toEqual([
      { name: 'vol', driver: 'local', mountpoint: '/mnt/vol', createdAt: undefined },
    ])
    expect(
      parseSessionList('{"Name":"default","State":"running","CpuCount":4,"IdleTimeout":30}'),
    ).toEqual([
      {
        name: 'default',
        state: 'running',
        storagePath: undefined,
        cpuCount: 4,
        memorySize: undefined,
        idleTimeoutSec: 30,
      },
    ])
    expect(
      parseSystemInfo({ Version: '2.9.3', StoragePath: 'D:/wslc', StorageBytes: 10 }),
    ).toMatchObject({ version: '2.9.3', storagePath: 'D:/wslc', storageBytes: 10 })
    expect(parseSystemInfo(null)).toEqual({ version: '', raw: '' })
  })

  it('NDJSON 忽略空行 / 非对象 / 非法 JSON', () => {
    expect(parseJsonLines('\n{"a":1}\n[]\n42\n{oops}\n')).toEqual([{ a: 1 }])
  })
})

describe('argv 构建（唯一执行边界）', () => {
  it('run：完整参数顺序与可选参数', () => {
    const args = buildContainerRunArgs({
      image: 'nginx:latest',
      name: 'web',
      command: ['nginx', '-g', 'daemon off;'],
      ports: [{ host: 8080, container: 80, address: '127.0.0.1' }],
      mounts: [{ host: 'D:\\www', container: '/html', readOnly: true }],
      env: { A: '1', EMPTY: '' },
      network: 'bridge',
      memory: '512M',
      cpus: 1.5,
      gpus: 'all',
      health: { cmd: 'curl -f localhost', retries: 3, interval: '5s' },
      detach: true,
      rm: true,
      stopTimeoutSec: 10,
    })
    expect(args).toEqual([
      'run',
      '-d',
      '--rm',
      '--name',
      'web',
      '-p',
      '127.0.0.1:8080:80',
      '-v',
      'D:/www:/html:ro',
      '-e',
      'A=1',
      '-e',
      'EMPTY=',
      '--network',
      'bridge',
      '-m',
      '512M',
      '--cpus',
      '1.5',
      '--gpus',
      'all',
      '--health-cmd',
      'curl -f localhost',
      '--health-interval',
      '5s',
      '--health-retries',
      '3',
      '--stop-timeout',
      '10',
      'nginx:latest',
      'nginx',
      '-g',
      'daemon off;',
    ])
  })

  it('run：默认 detach，未指定时不加 --rm', () => {
    expect(buildContainerRunArgs(EMPTY_SPEC)).toEqual(['run', '-d', 'ubuntu:latest'])
    expect(buildContainerRunArgs({ ...EMPTY_SPEC, detach: false })).toEqual([
      'run',
      'ubuntu:latest',
    ])
  })

  it('run 反例：非法镜像 / 端口 / 挂载 / 环境变量名 / 网络 / 内存 / CPU / 超时', () => {
    expect(() => buildContainerRunArgs({ ...EMPTY_SPEC, image: 'bad image' })).toThrow()
    expect(() =>
      buildContainerRunArgs({ ...EMPTY_SPEC, ports: [{ host: 0, container: 80 }] }),
    ).toThrow()
    expect(() =>
      buildContainerRunArgs({
        ...EMPTY_SPEC,
        mounts: [{ host: 'relative', container: '/a' }],
      }),
    ).toThrow()
    expect(() => buildContainerRunArgs({ ...EMPTY_SPEC, env: { 'BAD-NAME': '1' } })).toThrow()
    expect(() => buildContainerRunArgs({ ...EMPTY_SPEC, network: 'a b' })).toThrow()
    expect(() => buildContainerRunArgs({ ...EMPTY_SPEC, memory: 'lots' })).toThrow()
    expect(() => buildContainerRunArgs({ ...EMPTY_SPEC, cpus: 0 })).toThrow()
    expect(() => buildContainerRunArgs({ ...EMPTY_SPEC, stopTimeoutSec: 0 })).toThrow()
  })

  it('生命周期 argv', () => {
    expect(buildContainerStartArgs('web')).toEqual(['start', 'web'])
    expect(buildContainerStopArgs('web', 5)).toEqual(['stop', '-t', '5', 'web'])
    expect(buildContainerStopArgs('web')).toEqual(['stop', 'web'])
    expect(buildContainerRestartArgs('web')).toEqual(['container', 'restart', 'web'])
    expect(buildContainerRemoveArgs('web', true)).toEqual(['container', 'remove', '-f', 'web'])
    expect(buildContainerRemoveArgs('web')).toEqual(['container', 'remove', 'web'])
    expect(buildContainerPruneArgs()).toEqual(['container', 'prune'])
    expect(buildContainerLogsArgs('web', true, 10)).toEqual([
      'container',
      'logs',
      '-f',
      '--tail',
      '10',
      'web',
    ])
    expect(buildContainerLogsArgs('web', false, 999999)).toEqual([
      'container',
      'logs',
      '--tail',
      '5000',
      'web',
    ])
    expect(buildContainerCopyArgs('D:\\a', 'web:/b')).toEqual(['container', 'cp', 'D:/a', 'web:/b'])
    expect(() => buildContainerStartArgs('../evil')).toThrow()
    expect(() => buildContainerCopyArgs('D:\\a\u0000', '/b')).toThrow()
  })

  it('镜像 / 网络 / 卷 / 系统 argv', () => {
    expect(buildImagePullArgs('nginx:latest')).toEqual(['pull', 'nginx:latest'])
    expect(buildImageBuildArgs('app:dev', 'D:\\ctx')).toEqual(['build', '-t', 'app:dev', 'D:/ctx'])
    expect(() => buildImageBuildArgs('bad tag', 'D:\\ctx')).toThrow()
    expect(buildImageRemoveArgs('nginx:latest')).toEqual(['image', 'remove', 'nginx:latest'])
    expect(buildImagePruneArgs()).toEqual(['image', 'prune'])
    expect(buildImagePruneArgs(true)).toEqual(['image', 'prune', '--all'])

    expect(
      buildNetworkCreateArgs('net', {
        driver: 'bridge',
        subnet: '172.18.0.0/16',
        gateway: '172.18.0.1',
      }),
    ).toEqual([
      'network',
      'create',
      '-d',
      'bridge',
      '--subnet',
      '172.18.0.0/16',
      '--gateway',
      '172.18.0.1',
      'net',
    ])
    expect(buildNetworkRemoveArgs('net')).toEqual(['network', 'remove', 'net'])
    expect(buildNetworkConnectArgs('net', 'web')).toEqual(['network', 'connect', 'net', 'web'])
    expect(buildNetworkDisconnectArgs('net', 'web')).toEqual([
      'network',
      'disconnect',
      'net',
      'web',
    ])
    expect(buildNetworkPruneArgs()).toEqual(['network', 'prune'])
    expect(buildVolumeCreateArgs('vol')).toEqual(['volume', 'create', 'vol'])
    expect(buildVolumeRemoveArgs('vol')).toEqual(['volume', 'remove', 'vol'])
    expect(buildVolumePruneArgs()).toEqual(['volume', 'prune'])
    expect(buildSessionTerminateArgs()).toEqual(['system', 'session', 'terminate'])
    expect(buildSessionListArgs()).toEqual(['system', 'session', 'list', '--format', 'json'])
    expect(buildSystemInfoArgs()).toEqual(['system', 'info', '--format', 'json'])
    expect(buildContainerListArgs()).toEqual(['container', 'list', '--all', '--format', 'json'])
    expect(buildContainerListArgs(false)).toEqual(['container', 'list', '--format', 'json'])
    expect(buildImageListArgs()).toEqual(['image', 'list', '--format', 'json'])
    expect(buildStatsArgs()).toEqual(['stats', '-a', '--format', 'json'])
    expect(buildEventsArgs()).toEqual(['events'])
  })

  it('previewWslcCommand 对含空格参数加引号', () => {
    expect(previewWslcCommand(['run', '--name', 'my web'])).toBe("wslc.exe run --name 'my web'")
  })
})

describe('配方 / 设置辅助', () => {
  it('recipeToRunSpec 透传所有字段', () => {
    const recipe: ContainerRecipe = {
      id: 'r',
      label: 'R',
      image: 'nginx:latest',
      name: 'web',
      command: ['nginx'],
      ports: [{ host: 8080, container: 80 }],
      mounts: [],
      env: { A: '1' },
      detach: true,
      rm: false,
      stopTimeoutSec: 5,
      health: { cmd: 'true' },
    }
    expect(recipeToRunSpec(recipe)).toMatchObject({
      image: 'nginx:latest',
      name: 'web',
      command: ['nginx'],
      env: { A: '1' },
      health: { cmd: 'true' },
    })
  })

  it('默认配方 / 空设置', () => {
    expect(defaultContainerRecipe()).toMatchObject({
      id: 'recipe',
      image: 'ubuntu:latest',
      detach: true,
      rm: false,
    })
    expect(defaultContainerRecipe('x').id).toBe('x')
    expect(emptyWslcSettings()).toEqual({ session: {} })
  })

  it('normalizeHealthSpec 去空白并在空命令时返回 undefined', () => {
    expect(normalizeHealthSpec(undefined)).toBeUndefined()
    expect(normalizeHealthSpec({ cmd: '   ' })).toBeUndefined()
    expect(normalizeHealthSpec({ cmd: ' true ', retries: 0 })).toEqual({
      cmd: 'true',
      retries: 0,
    })
  })

  it('assertMount 统一路径并保留只读', () => {
    expect(assertMount({ host: 'D:\\a', container: '/b', readOnly: true })).toEqual({
      host: 'D:/a',
      container: '/b',
      readOnly: true,
    })
    expect(() => assertMount({ host: 'rel', container: '/b' })).toThrow()
  })
})

describe('0.2.0 review 回归：JSON 数组 / 表格列 / 安全边界', () => {
  it('`--format json` 返回单个 JSON 数组时正确解析（不是当作空列表）', () => {
    const json = JSON.stringify([
      { ID: 'a', Name: 'web', State: 'running', Status: 'Up 2 hours (healthy)' },
      { ID: 'b', Name: 'job', State: 'exited' },
    ])
    expect(parseContainerList(json).map((x) => x.name)).toEqual(['web', 'job'])
    expect(parseStats(JSON.stringify([{ Container: 'a', CPU: '1%' }]))).toHaveLength(1)
    expect(parseImageList(JSON.stringify([{ ID: 'i', Repository: 'nginx' }]))).toHaveLength(1)
  })

  it('Docker 表格含 CREATED 列：STATUS / PORTS / NAMES 不错位', () => {
    const table = [
      'CONTAINER ID   IMAGE          COMMAND   CREATED        STATUS                   PORTS                    NAMES',
      'abc123         nginx:latest   "nginx"   2 hours ago    Up 2 hours (healthy)     0.0.0.0:8080->80/tcp     web',
    ].join('\n')
    const [row] = parseContainerTable(table)
    expect(row).toMatchObject({
      id: 'abc123',
      name: 'web',
      image: 'nginx:latest',
      state: 'running',
      health: 'healthy',
      ports: [{ host: 8080, container: 80 }],
    })
  })

  it('容器 ID 允许 64 位；复制路径拒绝伪参数；磁盘根目录禁止挂载', () => {
    const full = 'a'.repeat(64)
    expect(buildContainerStartArgs(full)).toEqual(['start', full])
    expect(() => buildContainerCopyArgs('--help', 'web:/b')).toThrow()
    expect(() => buildContainerCopyArgs('D:\\', 'web:/b')).toThrow()
    expect(() => buildContainerRunArgs({ ...EMPTY_SPEC, network: 'host' })).toThrow()
  })

  it('环境变量值拒绝换行；健康检查时长非法时拒绝；宿主端口重复时拒绝', () => {
    expect(() => buildContainerRunArgs({ ...EMPTY_SPEC, env: { A: 'x\ny' } })).toThrow()
    expect(() =>
      buildContainerRunArgs({ ...EMPTY_SPEC, health: { cmd: 'true', interval: '5' } }),
    ).toThrow()
    expect(() =>
      buildContainerRunArgs({
        ...EMPTY_SPEC,
        ports: [
          { host: 8080, container: 80 },
          { host: 8080, container: 81 },
        ],
      }),
    ).toThrow()
  })

  it('命令预览脱敏环境变量值（日志/错误不泄露密钥）', () => {
    expect(previewWslcCommand(['run', '-e', 'TOKEN=secret', 'ubuntu'])).toBe(
      "wslc.exe run -e 'TOKEN=***' ubuntu",
    )
    expect(previewWslcCommand(['run', '-e', 'TOKEN=secret'], { redactSecrets: false })).toContain(
      'TOKEN=secret',
    )
  })
})

describe('WSL 3.0.3 真实输出形态（中文本地化 / 嵌套 system info / NDJSON 网络）', () => {
  it('中文容器表头不会被当成数据行；状态归一为 running/exited', () => {
    const table = [
      '容器 ID     映像        命令        已创建       状态        端口        名称',
      'abc123      nginx:latest   "nginx"     2 小时前     运行中      0.0.0.0:8080->80/tcp   web',
      'def456      alpine:3.20    "sh"        1 小时前     已停止      —                    job',
    ].join('\n')
    const rows = parseContainerTable(table)
    expect(rows).toHaveLength(2)
    expect(rows[0]).toMatchObject({ id: 'abc123', name: 'web', state: 'running' })
    expect(rows[1]).toMatchObject({ id: 'def456', name: 'job', state: 'exited' })
    expect(parseContainerTable('容器 ID  映像  命令  已创建  状态  端口  名称')).toEqual([])
  })

  it('system info 嵌套 Client/Server：版本、设置文件、会话', () => {
    const raw = JSON.stringify({
      Client: {
        Version: '3.0.3.0',
        SettingsFile: 'C:\\Users\\me\\AppData\\Local\\wslc\\settings.yaml',
      },
      Server: { SessionManagerVersion: '3.0.3', Sessions: [{ ID: 1, Name: 'wslc-cli-me' }] },
    })
    const info = parseSystemInfo(raw)
    expect(info.version).toBe('3.0.3.0')
    expect(info.settingsPath).toContain('settings.yaml')
    expect(parseSystemInfoSessions(raw)).toEqual([
      expect.objectContaining({ name: 'wslc-cli-me', state: 'running' }),
    ])
  })

  it('网络 NDJSON 的 Internal 是字符串 "false" 时不得误判为 true', () => {
    const [net] = parseNetworks(
      '{"ID":"n1","Name":"bridge","Driver":"bridge","Internal":"false"}\n',
    )
    expect(net).toMatchObject({ name: 'bridge', internal: false })
  })

  it('Docker stats 的 CPUPerc 键与 Size 字符串可解析', () => {
    expect(parseStats('{"Container":"c1","CPUPerc":"12.5%"}')[0]).toMatchObject({
      containerId: 'c1',
      cpuPercent: 12.5,
    })
    expect(parseImageList('{"ID":"i1","Repository":"nginx","Size":"10MiB"}')[0]!.sizeBytes).toBe(
      10 * 1024 ** 2,
    )
  })
})

describe('容器解析/校验边界补强（0.2.0 覆盖率）', () => {
  it('端口：对象/数组/字符串混合与非法值丢弃', () => {
    expect(parsePorts({ host: 1, container: 2 })).toEqual([{ host: 1, container: 2 }])
    expect(
      parsePorts([
        { HostPort: 8080, ContainerPort: 80, HostIp: '0.0.0.0' },
        { host: 0, container: 2 },
        '9090:90',
        'bad',
      ]),
    ).toEqual([
      { host: 8080, container: 80, address: '0.0.0.0' },
      { host: 9090, container: 90 },
    ])
    expect(parsePorts(42)).toEqual([])
  })

  it('容器摘要：Names 数组 / 状态前缀 / 健康推断 / 缺 id 用 name', () => {
    expect(
      parseContainerSummary({
        Names: ['/web'],
        Image: 'nginx',
        Status: 'Exited (0)',
      }),
    ).toMatchObject({ id: 'web', name: 'web', state: 'exited' })
    expect(
      parseContainerSummary({ Name: 'job', State: 'created', Status: 'Exited (0)' }),
    ).toMatchObject({ state: 'created', health: 'none' })
    expect(parseContainerSummary({ Name: 'h', Status: 'Up 1s (health: starting)' })).toMatchObject({
      health: 'starting',
    })
  })

  it('详情：Config.Env / Mounts RW / Networks 对象', () => {
    const d = parseContainerDetail({
      ID: 'a',
      Name: 'web',
      Config: { Env: ['A=1', 'B=x=y'] },
      Mounts: [{ Source: 'D:/a', Destination: '/a', RW: true }],
      Networks: { bridge: {}, custom: {} },
    })
    expect(d?.env).toEqual({ A: '1', B: 'x=y' })
    expect(d?.mounts).toEqual([{ host: 'D:/a', container: '/a', readOnly: false }])
    expect(d?.networks).toEqual(['bridge', 'custom'])
  })

  it('镜像/统计/网络/卷/会话的坏行与别名', () => {
    expect(parseImageList('{"Tag":""}\nnot-json')).toEqual([])
    expect(parseImageList('{"Repository":"nginx"}')[0]).toMatchObject({
      tag: 'latest',
      repository: 'nginx',
    })
    expect(parseStats('{"Name":"no-id"}')).toEqual([])
    expect(parseNetworks('{"Name":"","Driver":"x"}')).toEqual([])
    expect(parseNetworks('{"Name":"n","Internal":true,"Containers":{"a":{}}}')[0]).toMatchObject({
      internal: true,
      containers: ['a'],
    })
    expect(parseVolumes('{"Name":""}')).toEqual([])
    expect(parseVolumes('{"Name":"v"}')[0]).toMatchObject({ driver: 'local' })
    expect(parseSessionList('{"Name":"default","State":"running"}')[0]).toMatchObject({
      name: 'default',
      state: 'running',
    })
    expect(parseSessionList('ID  创建者 PID  显示名称\n1   123  wslc-cli-me')).toEqual([
      expect.objectContaining({ name: 'wslc-cli-me', state: 'running' }),
    ])
    expect(parseSystemInfo(null)).toEqual({ version: '', raw: '' })
  })

  it('argv 可选分支：no detach / rm / 空 env / 非法 cpus / health / 网络参数', () => {
    expect(
      buildContainerRunArgs({
        image: 'ubuntu',
        ports: [],
        mounts: [],
        env: {},
        detach: false,
        rm: true,
        cpus: 0.5,
        gpus: 'all',
      }),
    ).toEqual(['run', '--rm', '--cpus', '0.5', '--gpus', 'all', 'ubuntu'])
    expect(() =>
      buildContainerRunArgs({ image: 'ubuntu', ports: [], mounts: [], env: {}, cpus: 0 }),
    ).toThrow()
    expect(
      buildNetworkCreateArgs('n', {
        driver: 'bridge',
        subnet: '172.18.0.0/16',
        gateway: '172.18.0.1',
      }),
    ).toEqual([
      'network',
      'create',
      '-d',
      'bridge',
      '--subnet',
      '172.18.0.0/16',
      '--gateway',
      '172.18.0.1',
      'n',
    ])
    expect(() => buildNetworkCreateArgs('n', { subnet: '999.1.0.0/16' })).toThrow()
    expect(() => buildNetworkCreateArgs('n', { gateway: '1.2.3' })).toThrow()
    expect(() => buildContainerStopArgs('c', 0)).toThrow()
    expect(assertMount({ host: 'D:\\a', container: '/b', readOnly: true })).toEqual({
      host: 'D:/a',
      container: '/b',
      readOnly: true,
    })
  })
})
