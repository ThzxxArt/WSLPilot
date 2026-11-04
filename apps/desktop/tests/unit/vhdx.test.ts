import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { randomUUID } from 'node:crypto'
import { readVhdxVirtualSize } from '../../src/main/services/vhdx'

const REGION_OFFSET = 192 * 1024
const METADATA_OFFSET = 2 * 1024 * 1024
const METADATA_REGION_GUID = '06A27C8B90479A4BB8FE575F050F886E'
const VIRTUAL_SIZE_GUID = '2442A52F1BCD7648B2115DBED83BF4B8'

function guidBytes(hex: string): Buffer {
  return Buffer.from(hex, 'hex')
}

function makeVhdx(virtualSize: bigint): Buffer {
  const buf = Buffer.alloc(METADATA_OFFSET + 1024 * 1024)
  buf.write('vhdxfile', 0, 'ascii')
  buf.write('regi', REGION_OFFSET, 'ascii')
  buf.writeUInt32LE(2, REGION_OFFSET + 8)
  guidBytes('6677C22D23F600429D64115E9BFD4A08').copy(buf, REGION_OFFSET + 16)
  buf.writeBigUInt64LE(BigInt(3 * 1024 * 1024), REGION_OFFSET + 32)
  guidBytes(METADATA_REGION_GUID).copy(buf, REGION_OFFSET + 16 + 32)
  buf.writeBigUInt64LE(BigInt(METADATA_OFFSET), REGION_OFFSET + 16 + 32 + 16)
  buf.writeUInt32LE(1024 * 1024, REGION_OFFSET + 16 + 32 + 24)

  buf.write('metadata', METADATA_OFFSET, 'ascii')
  buf.writeUInt16LE(1, METADATA_OFFSET + 10)
  guidBytes(VIRTUAL_SIZE_GUID).copy(buf, METADATA_OFFSET + 32)
  buf.writeUInt32LE(64, METADATA_OFFSET + 32 + 16)
  buf.writeUInt32LE(8, METADATA_OFFSET + 32 + 20)
  buf.writeBigUInt64LE(virtualSize, METADATA_OFFSET + 64)
  return buf
}

describe('readVhdxVirtualSize', () => {
  let dir: string
  beforeEach(async () => {
    dir = join(tmpdir(), `wslpilot-vhdx-${randomUUID()}`)
    await fs.mkdir(dir, { recursive: true })
  })
  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true })
  })

  it('读取 VHDX 元数据中的虚拟容量（不是物理文件大小）', async () => {
    const p = join(dir, 'ext4.vhdx')
    await fs.writeFile(p, makeVhdx(1099511627776n))
    await expect(readVhdxVirtualSize(p)).resolves.toBe(1099511627776)
  })

  it('非 VHDX / 缺元数据 → undefined（调用方必须拒绝破坏性 resize）', async () => {
    const p = join(dir, 'bad.vhdx')
    await fs.writeFile(p, Buffer.from('not a vhdx'))
    await expect(readVhdxVirtualSize(p)).resolves.toBeUndefined()
    await expect(readVhdxVirtualSize(join(dir, 'missing.vhdx'))).resolves.toBeUndefined()
  })
})

describe('readVhdxVirtualSize 破坏性输入（0.2.0 覆盖率与安全反例）', () => {
  let dir: string
  beforeEach(async () => {
    dir = join(tmpdir(), `wslpilot-vhdx-bad-${randomUUID()}`)
    await fs.mkdir(dir, { recursive: true })
  })
  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true })
  })

  async function writeVariant(name: string, mutate: (b: Buffer) => Buffer) {
    const p = join(dir, name)
    await fs.writeFile(p, mutate(makeVhdx(1024n ** 3n)))
    return readVhdxVirtualSize(p)
  }

  it('魔数/区域签名/区域数量非法 → undefined', async () => {
    await expect(
      writeVariant('magic.vhdx', (b) => {
        b.write('notvhdx!', 0, 'ascii')
        return b
      }),
    ).resolves.toBeUndefined()
    await expect(
      writeVariant('regi.vhdx', (b) => {
        b.write('bad!', REGION_OFFSET, 'ascii')
        return b
      }),
    ).resolves.toBeUndefined()
    await expect(
      writeVariant('count0.vhdx', (b) => {
        b.writeUInt32LE(0, REGION_OFFSET + 8)
        return b
      }),
    ).resolves.toBeUndefined()
    await expect(
      writeVariant('countMax.vhdx', (b) => {
        b.writeUInt32LE(4096, REGION_OFFSET + 8)
        return b
      }),
    ).resolves.toBeUndefined()
  })

  it('区域表截断 / 缺 metadata 区域 / offset 超安全整数 → undefined', async () => {
    await expect(
      writeVariant('trunc.vhdx', (b) => b.subarray(0, REGION_OFFSET + 20)),
    ).resolves.toBeUndefined()
    await expect(
      writeVariant('noguid.vhdx', (b) => {
        b.writeUInt32LE(1, REGION_OFFSET + 8)
        b.write('00'.repeat(16), REGION_OFFSET + 16, 'hex')
        return b
      }),
    ).resolves.toBeUndefined()
    await expect(
      writeVariant('bigoff.vhdx', (b) => {
        b.writeUInt32LE(1, REGION_OFFSET + 8)
        b.write('00'.repeat(16), REGION_OFFSET + 16, 'hex')
        b.writeBigUInt64LE(BigInt(Number.MAX_SAFE_INTEGER) + 1n, REGION_OFFSET + 16 + 16)
        return b
      }),
    ).resolves.toBeUndefined()
  })

  it('元数据头/数量/条目 Guid/长度/越界/零值全部拒绝', async () => {
    await expect(
      writeVariant('mdsig.vhdx', (b) => {
        b.write('badmeta!', METADATA_OFFSET, 'ascii')
        return b
      }),
    ).resolves.toBeUndefined()
    await expect(
      writeVariant('mdcount0.vhdx', (b) => {
        b.writeUInt16LE(0, METADATA_OFFSET + 10)
        return b
      }),
    ).resolves.toBeUndefined()
    await expect(
      writeVariant('mdcountmax.vhdx', (b) => {
        b.writeUInt16LE(4096, METADATA_OFFSET + 10)
        return b
      }),
    ).resolves.toBeUndefined()
    await expect(
      writeVariant('mdguid.vhdx', (b) => {
        b.write('00'.repeat(16), METADATA_OFFSET + 32, 'hex')
        return b
      }),
    ).resolves.toBeUndefined()
    await expect(
      writeVariant('mdlen.vhdx', (b) => {
        b.writeUInt32LE(4, METADATA_OFFSET + 32 + 20)
        return b
      }),
    ).resolves.toBeUndefined()
    await expect(
      writeVariant('mdoff.vhdx', (b) => {
        b.writeUInt32LE(900 * 1024, METADATA_OFFSET + 32 + 16)
        return b
      }),
    ).resolves.toBeUndefined()
    await expect(
      writeVariant('zero.vhdx', (b) => {
        b.writeBigUInt64LE(0n, METADATA_OFFSET + 64)
        return b
      }),
    ).resolves.toBeUndefined()
    await expect(
      writeVariant('huge.vhdx', (b) => {
        b.writeBigUInt64LE(BigInt(Number.MAX_SAFE_INTEGER) + 1n, METADATA_OFFSET + 64)
        return b
      }),
    ).resolves.toBeUndefined()
  })

  it('元数据条目截断 → undefined', async () => {
    await expect(
      writeVariant('mdtrunc.vhdx', (b) => b.subarray(0, METADATA_OFFSET + 40)),
    ).resolves.toBeUndefined()
  })
})
