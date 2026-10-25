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
