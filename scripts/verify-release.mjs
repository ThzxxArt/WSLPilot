#!/usr/bin/env node
/**
 * 发布前一致性校验（0.1.4）。
 *
 * 目的：把“版本号 / tag / CHANGELOG / 产物 / 签名 / publisherName”从口头约定
 * 变成一条可执行命令，避免 0.1.3 那种“安装包未签名但 README 暗示已校验”的失真。
 *
 * 用法：
 *   node scripts/verify-release.mjs                 # 校验；未签名则失败
 *   node scripts/verify-release.mjs --allow-unsigned
 *   node scripts/verify-release.mjs --tag v0.1.4
 *   node scripts/verify-release.mjs --require-artifacts
 *
 * 退出码：0 通过；1 失败；2 用法错误。
 */
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const ROOT = resolve(import.meta.dirname, '..')
const argv = process.argv.slice(2)
let allowUnsigned = false
let requireArtifacts = false
let tagArg = ''
for (let i = 0; i < argv.length; i++) {
  const a = argv[i]
  if (a === '--allow-unsigned') {
    allowUnsigned = true
  } else if (a === '--require-artifacts') {
    requireArtifacts = true
  } else if (a === '--tag') {
    const value = argv[i + 1]
    if (!value || value.startsWith('--')) {
      console.error('用法错误：--tag 需要一个版本值（如 --tag v0.1.4）')
      process.exit(2)
    }
    tagArg = value
    i++
  } else if (a.startsWith('--tag=')) {
    tagArg = a.slice('--tag='.length)
    if (!tagArg) {
      console.error('用法错误：--tag= 不能为空')
      process.exit(2)
    }
  } else if (a === '-h' || a === '--help') {
    console.log(
      '用法：node scripts/verify-release.mjs [--allow-unsigned] [--require-artifacts] [--tag v0.1.4]',
    )
    process.exit(0)
  } else {
    console.error(`用法错误：未知参数 ${a}`)
    process.exit(2)
  }
}
const envTag = process.env.GITHUB_REF_NAME ?? ''
// 分支构建的 GITHUB_REF_NAME 是 master/main，不是发布 tag；只有 v* 才参与校验
const tag = tagArg || (envTag.startsWith('v') ? envTag : '')

const errors = []
const warnings = []
const ok = (m) => console.log(`  ✓ ${m}`)
const fail = (m) => {
  errors.push(m)
  console.log(`  ✗ ${m}`)
}
const warn = (m) => {
  warnings.push(m)
  console.log(`  ! ${m}`)
}

function readJson(p) {
  return JSON.parse(readFileSync(p, 'utf8'))
}

function expect(cond, message) {
  if (cond) ok(message)
  else fail(message)
}

console.log('WSLPilot release verification')

// 1) 版本一致性
const rootPkg = readJson(join(ROOT, 'package.json'))
const version = rootPkg.version
console.log(`\n[1/5] 版本一致性（${version}）`)
const versionFiles = [
  'package.json',
  'packages/shared/package.json',
  'packages/kit/package.json',
  'packages/ui/package.json',
  'apps/desktop/package.json',
]
for (const rel of versionFiles) {
  const v = readJson(join(ROOT, rel)).version
  expect(v === version, `${rel} = ${v}`)
}

// 2) CHANGELOG 首个版本段
console.log('\n[2/5] CHANGELOG')
const changelog = readFileSync(join(ROOT, 'CHANGELOG.md'), 'utf8')
const first = /^## \[([^\]]+)\]/m.exec(changelog)?.[1] ?? ''
expect(first === version, `首个版本段为 ${first || '（缺失）'}`)
expect(
  new RegExp(`^## \\[${version.replace(/\./g, '\\.')}\\]`, 'm').test(changelog),
  `存在 [${version}] 段落`,
)

// 3) tag
console.log('\n[3/5] Git tag')
if (!tag) {
  warn('未提供 --tag 或 GITHUB_REF_NAME（本地校验允许跳过）')
} else {
  expect(tag === `v${version}` || tag === version, `tag=${tag} 与版本 ${version} 匹配`)
}

// 4) 产物与 latest.yml sha512
console.log('\n[4/5] 构建产物')
const releaseDir = join(ROOT, 'apps/desktop/release')
const setupName = `WSLPilot-${version}-x64-setup.exe`
const setupPath = join(releaseDir, setupName)
const portableName = `WSLPilot-${version}-x64-portable.exe`
const portablePath = join(releaseDir, portableName)
const hasArtifacts = existsSync(setupPath)
const hasPortable = existsSync(portablePath)
if (!hasArtifacts) {
  if (requireArtifacts) fail(`缺少产物 ${setupName}`)
  else warn(`未找到 ${setupName}（仅校验元数据；CI 打包后请加 --require-artifacts）`)
} else {
  ok(`找到 ${setupName}`)
  if (hasPortable) ok(`找到 ${portableName}`)
  else if (requireArtifacts) fail(`缺少免安装产物 ${portableName}`)
  else warn(`未找到 ${portableName}（便携版产物缺失）`)
  const latestPath = join(releaseDir, 'latest.yml')
  if (!existsSync(latestPath)) {
    fail('缺少 latest.yml（自动更新元数据）')
  } else {
    const latest = readFileSync(latestPath, 'utf8')
    expect(
      new RegExp(`^version:\\s*${version.replace(/\./g, '\\.')}\\s*$`, 'm').test(latest),
      `latest.yml version = ${version}`,
    )
    const byUrl = new Map(
      [...latest.matchAll(/url:\s*(\S+)[\s\S]*?sha512:\s*([A-Za-z0-9+/=]+)/g)].map((m) => [
        m[1],
        m[2],
      ]),
    )
    for (const file of [setupName, portableName]) {
      if (!existsSync(join(releaseDir, file))) continue
      const sha = byUrl.get(file)
      if (!sha) {
        // electron-builder 的 latest.yml 只列自动更新用的 setup；portable 是独立产物，
        // 不参与 sha512 自动更新校验。要求它必须出现在 latest.yml 会制造假红。
        if (file === portableName) {
          warn(`latest.yml 未列出便携版 ${portableName}（便携版不参与自动更新）`)
        } else {
          fail(`${file} 存在但 latest.yml 没有 sha512`)
        }
        continue
      }
      const actual = createHash('sha512')
        .update(readFileSync(join(releaseDir, file)))
        .digest('base64')
      expect(sha === actual, `${file} sha512 与 latest.yml 一致`)
    }
  }
}

// 5) 签名 / publisherName
console.log('\n[5/5] 代码签名与更新校验')
const appUpdatePath = join(releaseDir, 'win-unpacked/resources/app-update.yml')
if (hasArtifacts && process.platform === 'win32') {
  try {
    const out = execFileSync(
      'powershell.exe',
      [
        '-NoProfile',
        '-Command',
        `(Get-AuthenticodeSignature -LiteralPath '${setupPath.replace(/'/g, "''")}').Status`,
      ],
      { encoding: 'utf8' },
    ).trim()
    if (out === 'Valid') ok('安装包 Authenticode 签名有效')
    else if (allowUnsigned) warn(`安装包未签名（${out}），已按 --allow-unsigned 放行`)
    else fail(`安装包未签名（${out}）；请签名或显式 --allow-unsigned`)
  } catch (e) {
    if (allowUnsigned) warn(`签名检测失败（${e.message}），已按 --allow-unsigned 放行`)
    else fail(`签名检测失败：${e.message}`)
  }
} else if (hasArtifacts) {
  // 非 Windows 无法调用 Get-AuthenticodeSignature：带产物时不能静默“通过”，
  // 必须显式 --allow-unsigned，否则本地/CI 在错误平台会得到假绿。
  if (allowUnsigned) {
    warn(
      '非 Windows：无法校验 Authenticode，已按 --allow-unsigned 放行（发布前必须在 Windows 复验）',
    )
  } else {
    fail('非 Windows 且存在产物：无法校验 Authenticode；请在 Windows 上复验或显式 --allow-unsigned')
  }
} else {
  warn('非 Windows 或无产物：跳过 Authenticode 检测（发布前必须在 Windows 上复验）')
}

const builderConfigPath = join(ROOT, 'apps/desktop/electron-builder.yml')
const builderConfig = existsSync(builderConfigPath) ? readFileSync(builderConfigPath, 'utf8') : ''
const builderVerify = /verifyUpdateCodeSignature:\s*(true|false)/.exec(builderConfig)?.[1]
const builderPublisher = /publisherName:\s*(.+)/.exec(builderConfig)?.[1]?.trim()
if (existsSync(appUpdatePath)) {
  const yml = readFileSync(appUpdatePath, 'utf8')
  // app-update.yml 由 electron-builder 生成，通常不含 verifyUpdateCodeSignature；
  // 真正的开关在 electron-builder.yml 的 win 段，必须合并判断，否则永远 warning。
  const verify = /verifyUpdateCodeSignature:\s*(true|false)/.exec(yml)?.[1] ?? builderVerify
  const publisher = /publisherName:\s*(.+)/.exec(yml)?.[1]?.trim() ?? builderPublisher
  if (verify === 'true' && !publisher) {
    const msg =
      'verifyUpdateCodeSignature=true 但没有 publisherName（electron-updater 不会真正校验发布者）'
    if (allowUnsigned) warn(msg)
    else fail(msg + '；请配置 publisherName 或显式 --allow-unsigned')
  } else if (verify === 'true' && publisher) {
    ok(`更新签名校验启用，publisherName=${publisher}`)
  } else {
    warn('verifyUpdateCodeSignature 未启用（发布说明须如实披露）')
  }
} else {
  warn('未找到 win-unpacked/resources/app-update.yml（未打包或未生成更新元数据）')
}

console.log('\n结果')
if (warnings.length) {
  console.log(`  警告 ${warnings.length} 条：`)
  for (const w of warnings) console.log(`   - ${w}`)
}
if (errors.length) {
  console.log(`  失败 ${errors.length} 条：`)
  for (const e of errors) console.log(`   - ${e}`)
  process.exit(1)
}
console.log('  通过 ✓')
