/**
 * 提权辅助脚本（PowerShell）生成器 — 设计书 §14.3。
 *
 * Helper 只接受**结构化请求文件**（op 白名单 + 参数数组），绝不接受任意命令行：
 * - 脚本内嵌 op → program 白名单，与 shared/elevation 同源（禁止另抄一份）
 * - program 与 op 不匹配、未知 op 一律拒绝执行
 * - 参数以数组 splat 调用（`& $program @args`），不经 shell 拼接
 * - 结果写入独立 result.json，主进程读取后映射错误
 */
import { ELEVATION_PROGRAMS } from '@wslpilot/shared'

/** 生成 Helper 脚本全文（UTF-8 BOM 无关，PowerShell 5.1 兼容） */
export function buildElevationHelperScript(): string {
  const whitelist = JSON.stringify(ELEVATION_PROGRAMS)
  return `# WSLPilot elevation helper — auto-generated. DO NOT EDIT.
# 结构化请求执行器：只执行请求文件中声明的白名单操作（op + 参数数组）。
param(
  [Parameter(Mandatory = $true)][string]$RequestFile,
  [Parameter(Mandatory = $true)][string]$ResultFile
)
$ErrorActionPreference = 'Stop'

$allowed = ConvertFrom-Json @'
${whitelist}
'@

function Write-Result([hashtable]$payload) {
  $json = $payload | ConvertTo-Json -Compress -Depth 8
  [System.IO.File]::WriteAllText($ResultFile, $json, (New-Object System.Text.UTF8Encoding($false)))
}

$results = @()
try {
  $reqText = [System.IO.File]::ReadAllText($RequestFile)
  $req = ConvertFrom-Json $reqText
  $ops = @($req.ops)
  if ($ops.Count -eq 0) { throw 'request has no ops' }
  $opNames = @($allowed.PSObject.Properties | ForEach-Object { $_.Name })
  foreach ($item in $ops) {
    $op = [string]$item.op
    if ($opNames -notcontains $op) {
      $results += @{ op = $op; ok = $false; code = -1; stdout = ''; stderr = "op not allowed: $op"; error = 'op-not-allowed' }
      continue
    }
    $expected = [string]$allowed.$op
    $program = [string]$item.program
    if ($program -ne $expected) {
      $results += @{ op = $op; ok = $false; code = -1; stdout = ''; stderr = "program mismatch: $program"; error = 'program-mismatch' }
      continue
    }
    $argList = @()
    if ($null -ne $item.args) { foreach ($a in @($item.args)) { $argList += [string]$a } }
    $errTmp = [System.IO.Path]::GetTempFileName()
    try {
      $stdout = (& $program @argList 2>$errTmp | Out-String)
      $code = $LASTEXITCODE
      if ($null -eq $code) { $code = 0 }
      $stderr = ''
      if (Test-Path -LiteralPath $errTmp) { $stderr = [System.IO.File]::ReadAllText($errTmp) }
      $results += @{ op = $op; ok = ([int]$code -eq 0); code = [int]$code; stdout = [string]$stdout; stderr = [string]$stderr }
    } finally {
      Remove-Item -LiteralPath $errTmp -Force -ErrorAction SilentlyContinue
    }
  }
  Write-Result @{ canceled = $false; results = $results }
} catch {
  Write-Result @{ canceled = $false; error = [string]$_.Exception.Message; results = $results }
}
`
}
