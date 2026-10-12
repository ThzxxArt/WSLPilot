/**
 * Windows 工具输出解码（M6 网络/设备）。
 * `netsh` / `usbipd` / `reg` 等控制台工具重定向到管道后按系统代码页输出，
 * 既不是 UTF-8 也不保证 UTF-16LE（与 wsl.exe 不同），必须先探测再解码，
 * 否则中文报错（如「请求的操作需要提升」）变成乱码，错误映射全部失效。
 */

const UTF8_STRICT = new TextDecoder('utf-8', { fatal: true })

function tryDecode(label: string, buf: Buffer): string | null {
  try {
    // fatal：非致命解码器（如 GBK）对非法序列只给 U+FFFD 而不抛错，
    // 会让降级链永远走不到 windows-1252 / latin1，西欧码页输出被硬解成乱码（review 根治）
    return new TextDecoder(label, { fatal: true }).decode(buf)
  } catch {
    return null
  }
}

function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text
}

/** UTF-16BE → 字符串（按字节交换转 LE 再解码，不依赖 TextDecoder 的 be 支持） */
function decodeUtf16BE(buf: Buffer): string {
  const even = buf.length - (buf.length % 2)
  const swapped = Buffer.alloc(even)
  for (let i = 0; i + 1 < even; i += 2) {
    swapped[i] = buf[i + 1]!
    swapped[i + 1] = buf[i]!
  }
  return swapped.toString('utf16le').replace(/\0/g, '')
}

/**
 * 解码 Windows 控制台工具输出：
 * 1. BOM 优先（review 0.1.2 根治：BOM 是最强编码信号）：
 *    FF FE → UTF-16LE；FE FF → UTF-16BE；EF BB BF → UTF-8
 * 2. UTF-16LE 启发式（出现 NUL 且奇数位 NUL 不少于偶数位）→ utf16le，兼容 wsl.exe 形态
 * 3. 严格 UTF-8；失败则按 GBK（cp936）回退，再退 windows-1252 / latin1 保证不抛错
 *
 * 说明：纯 CJK 的 UTF-16LE（全无 ASCII、全无 NUL）与 GBK 字节流在统计上不可区分；
 * Windows 控制台工具输出几乎总含 ASCII（程序名/端口/路径），实际不会踩到该歧义。
 */
export function decodeToolOutput(buf: Buffer | Uint8Array | null | undefined): string {
  if (!buf || buf.length === 0) return ''
  let b = Buffer.isBuffer(buf) ? buf : Buffer.from(buf)

  // ── 1. BOM 优先 ──
  if (b.length >= 2 && b[0] === 0xff && b[1] === 0xfe) {
    return b.subarray(2).toString('utf16le').replace(/\0/g, '')
  }
  if (b.length >= 2 && b[0] === 0xfe && b[1] === 0xff) {
    return decodeUtf16BE(b.subarray(2))
  }
  if (b.length >= 3 && b[0] === 0xef && b[1] === 0xbb && b[2] === 0xbf) {
    b = b.subarray(3)
  }

  // ── 2. UTF-16LE 启发式 ──
  let nulOdd = 0
  let nulEven = 0
  const end = b.length - (b.length % 2)
  for (let i = 0; i < end; i += 2) {
    if (b[i] === 0) nulEven++
    if (b[i + 1] === 0) nulOdd++
  }
  if (end > 0 && nulOdd > 0 && nulOdd >= nulEven) {
    // NUL 清理只在确认走 UTF-16 的路径执行（review 0.1.2）：
    // 非 UTF-16 文本中的 NUL 是合法内容，不得无条件删除
    return stripBom(b.toString('utf16le').replace(/\0/g, ''))
  }

  let text: string
  try {
    text = UTF8_STRICT.decode(b)
  } catch {
    /* 非 UTF-8：按 GBK 解析（中文 Windows 控制台默认代码页） */
    text = tryDecode('gbk', b) ?? tryDecode('windows-1252', b) ?? b.toString('latin1')
  }
  return stripBom(text)
}
