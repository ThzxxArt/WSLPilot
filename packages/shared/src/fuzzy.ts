/**
 * 轻量模糊匹配（子序列 + 打分）— M5 命令面板。
 * 设计书 §13.3 要求模糊匹配；此处自研实现（无额外运行时依赖），语义对齐 Fuse.js 常用打分：
 * 连续命中、词首命中、越早命中越好、缺口有惩罚。
 */

export interface FuzzyResult {
  score: number
  /** 命中字符在 text 中的下标（升序） */
  indices: number[]
}

const EMPTY: FuzzyResult = { score: 0, indices: [] }

function isWordBoundary(text: string, index: number): boolean {
  if (index === 0) return true
  const prev = text[index - 1]!
  return /[\s\-_./\\:，。、·（）()【】[\]]/.test(prev)
}

/**
 * query 对 text 的模糊匹配；不匹配返回 null。
 * 空 query 返回 score 0（调用方按「无过滤」处理）。
 */
export function fuzzyMatch(query: string, text: string): FuzzyResult | null {
  const q = query.trim().toLowerCase()
  if (q === '') return EMPTY
  const t = text.toLowerCase()
  const indices: number[] = []
  let score = 0
  let ti = 0
  let prevIndex = -2
  for (let qi = 0; qi < q.length; qi++) {
    const ch = q[qi]!
    if (ch === ' ') {
      // 空格只作为分隔：允许跳过，不惩罚
      continue
    }
    const found = t.indexOf(ch, ti)
    if (found < 0) return null
    indices.push(found)
    // 基础分
    score += 10
    // 连续命中奖励
    if (found === prevIndex + 1) score += 8
    // 词首命中奖励（缩写匹配，如 dl → distro list）
    if (isWordBoundary(text, found)) score += 10
    // 越早命中越好（最多 +5）
    score += Math.max(0, 5 - Math.floor(found / 4))
    // 缺口惩罚
    if (prevIndex >= 0 && found > prevIndex + 1) {
      score -= Math.min(10, found - prevIndex - 1)
    }
    prevIndex = found
    ti = found + 1
  }
  // 全等 / 前缀额外加分（更贴合「最佳匹配」直觉）
  if (t === q) score += 30
  else if (t.startsWith(q)) score += 12
  return { score, indices }
}

export interface RankedItem<T> {
  item: T
  score: number
  indices: number[]
}

/**
 * 过滤并按分数降序排列。
 * - query 为空：原序返回全部（score 0）
 * - query 有空格：按空白分词，每词都需命中（AND），分数累加
 */
export function filterRanked<T>(
  items: readonly T[],
  query: string,
  textOf: (item: T) => string,
): RankedItem<T>[] {
  const q = query.trim()
  if (q === '') {
    return items.map((item) => ({ item, score: 0, indices: [] }))
  }
  const terms = q.split(/\s+/).filter((s) => s !== '')
  const out: RankedItem<T>[] = []
  for (const item of items) {
    const text = textOf(item)
    let total = 0
    const indices: number[] = []
    let ok = true
    for (const term of terms) {
      const r = fuzzyMatch(term, text)
      if (!r) {
        ok = false
        break
      }
      total += r.score
      indices.push(...r.indices)
    }
    if (ok) {
      out.push({ item, score: total, indices: [...new Set(indices)].sort((a, b) => a - b) })
    }
  }
  out.sort((a, b) => b.score - a.score)
  return out
}
