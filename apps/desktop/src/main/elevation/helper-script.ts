/**
 * 提权辅助脚本（PowerShell）生成器 — 设计书 §14.3。
 *
 * v2 起 Helper 只接受 **op + 结构化 params**，绝不接受 program/args：
 * - 脚本内嵌 op → program 白名单，与 shared/elevation 同源
 * - argv 由 Helper 按 op 从 params 重建（与 shared/commands 的 build*Args 同语义）
 * - 参数以数组 splat 调用（`& $program @args`），不经 shell 拼接
 * - 结果写入独立 result.json，主进程读取后映射错误
 *
 * 这样载荷在进程创建后不可变（不落 %TEMP% 请求文件）；脚本文件由调用方在提权进程内
 * 先做 SHA-256 校验再从内存执行，同用户低权进程无法在 UAC 弹窗期间替换 op/params
 * 或 helper 脚本；op 白名单与 argv 重建仍保留。
 */
import { ELEVATION_PROGRAMS } from '@wslpilot/shared'

/** 生成 Helper 脚本全文（UTF-8；**写盘需带 BOM** —— Windows PowerShell 5.1 对无 BOM 文件按 ANSI 解码） */
export function buildElevationHelperScript(): string {
  const whitelist = JSON.stringify(ELEVATION_PROGRAMS)
  return `# WSLPilot elevation helper — auto-generated. DO NOT EDIT.
# 结构化请求执行器：只按 op + params 重建白名单操作的 argv。
param(
  # 请求载荷经命令行 base64 传入：UAC 弹窗期间临时文件可被同用户改写，
  # 命令行在进程创建后不可变，避免 op/params 被替换（v2 只解决了 argv 注入）。
  [Parameter(Mandatory = $true)][string]$PayloadBase64,
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

function Assert-DistroName([object]$value) {
  $s = [string]$value
  if ([string]::IsNullOrWhiteSpace($s)) { throw 'distro name is empty' }
  if ($s.Length -gt 200) { throw 'distro name too long' }
  if ($s -match '[\\x00-\\x1F\\x7F]') { throw 'distro name contains control characters' }
  if ($s.Contains('..')) { throw 'distro name contains ..' }
  if ($s -match '[\\\\/:?\\"<>|]') { throw 'distro name contains forbidden characters' }
  return $s
}

function Assert-Path([object]$value) {
  $s = [string]$value
  if ([string]::IsNullOrWhiteSpace($s)) { throw 'path is empty' }
  if ($s.Length -gt 1024) { throw 'path too long' }
  if ($s -match '[\\x00-\\x1F\\x7F]') { throw 'path contains control characters' }
  return $s
}

function Assert-Size([object]$value) {
  $s = [string]$value
  # WSL ParseMemorySize 大小写敏感，且没有小数：50G/50 合法，50gb/1.5GB 非法
  if ($s -cnotmatch '^\\d+(B|K|KB|M|MB|G|GB|T|TB)?$') { throw "invalid size: $s" }
  return $s
}

function Assert-User([object]$value) {
  $s = [string]$value
  if ($s -notmatch '^[A-Za-z_][A-Za-z0-9_-]{0,31}$') { throw "invalid user: $s" }
  return $s
}

function Assert-Port([object]$value) {
  $n = 0
  if (-not [int]::TryParse([string]$value, [ref]$n) -or $n -lt 1 -or $n -gt 65535) {
    throw "invalid port: $value"
  }
  return $n
}

function Assert-Version([object]$value) {
  $n = 0
  if (-not [int]::TryParse([string]$value, [ref]$n) -or ($n -ne 1 -and $n -ne 2)) {
    throw "invalid WSL version: $value"
  }
  return $n
}

function Assert-Address([object]$value) {
  $s = [string]$value
  if ([string]::IsNullOrWhiteSpace($s) -or $s.Length -gt 255) { throw 'invalid address' }
  if ($s -match '[\\x00-\\x1F\\x7F\\s]') { throw 'address contains whitespace/control characters' }
  return $s
}

function Build-Args([string]$op, [object]$p) {
  switch ($op) {
    'netsh.portproxy.add' {
      return @('interface', 'portproxy', 'add', 'v4tov4',
        "listenaddress=$(Assert-Address $p.listenAddress)",
        "listenport=$(Assert-Port $p.listenPort)",
        "connectaddress=$(Assert-Address $p.connectAddress)",
        "connectport=$(Assert-Port $p.connectPort)")
    }
    'netsh.portproxy.delete' {
      return @('interface', 'portproxy', 'delete', 'v4tov4',
        "listenaddress=$(Assert-Address $p.listenAddress)",
        "listenport=$(Assert-Port $p.listenPort)")
    }
    'usbipd.bind' {
      $id = [string]$p.busId
      if ($id -notmatch '^\\d{1,3}-\\d{1,3}(\\.\\d{1,3})*$') { throw "invalid busid: $id" }
      return @('bind', '--busid', $id)
    }
    'usbipd.unbind' {
      $id = [string]$p.busId
      if ($id -notmatch '^\\d{1,3}-\\d{1,3}(\\.\\d{1,3})*$') { throw "invalid busid: $id" }
      return @('unbind', '--busid', $id)
    }
    'wsl.move' {
      return @('--manage', (Assert-DistroName $p.name), '--move', (Assert-Path $p.path))
    }
    'wsl.install' {
      $a = @('--install')
      if ($null -ne $p.name -and [string]$p.name -ne '') { $a += @('-d', (Assert-DistroName $p.name)) }
      if ($null -ne $p.location -and [string]$p.location -ne '') { $a += @('--location', (Assert-Path $p.location)) }
      if ($null -ne $p.version) { $a += @('--version', [string](Assert-Version $p.version)) }
      if ($p.enableWsl1 -eq $true -or [string]$p.version -eq '1') { $a += '--enable-wsl1' }
      if ($null -ne $p.vhdSize -and [string]$p.vhdSize -ne '') { $a += @('--vhd-size', (Assert-Size $p.vhdSize)) }
      if ($p.fixedVhd -eq $true) { $a += '--fixed-vhd' }
      if ($p.webDownload -eq $true) { $a += '--web-download' }
      # 默认 true；只有显式 false（老 WSL plain 重试）才不追加
      if ($p.noLaunch -ne $false) { $a += '--no-launch' }
      return $a
    }
    'wsl.setVersion' {
      return @('--set-version', (Assert-DistroName $p.name), [string](Assert-Version $p.version))
    }
    'wsl.update' {
      $a = @('--update')
      if ($p.preRelease -eq $true) { $a += '--pre-release' }
      return $a
    }
    'wsl.setDefaultVersion' {
      return @('--set-default-version', [string](Assert-Version $p.version))
    }
    'wsl.setSparse' {
      $flag = if ($p.sparse -eq $true) { 'true' } else { 'false' }
      return @('--manage', (Assert-DistroName $p.name), '--set-sparse', $flag)
    }
    'wsl.compact' {
      return @('--manage', (Assert-DistroName $p.name), '--compact')
    }
    'wsl.resize' {
      return @('--manage', (Assert-DistroName $p.name), '--resize', (Assert-Size $p.size))
    }
    'wsl.setDefaultUser' {
      return @('--manage', (Assert-DistroName $p.name), '--set-default-user', (Assert-User $p.user))
    }
    default { throw "op has no argv builder: $op" }
  }
}

$results = @()
try {
  $reqText = [System.Text.Encoding]::UTF8.GetString(
    [System.Convert]::FromBase64String($PayloadBase64)
  )
  $req = ConvertFrom-Json $reqText
  if ([int]$req.v -ne 2) { throw "unsupported request version: $($req.v)" }
  $ops = @($req.ops)
  if ($ops.Count -eq 0) { throw 'request has no ops' }
  $opNames = @($allowed.PSObject.Properties | ForEach-Object { $_.Name })
  foreach ($item in $ops) {
    $op = [string]$item.op
    if ($opNames -notcontains $op) {
      $results += @{ op = $op; ok = $false; code = -1; stdout = ''; stderr = "op not allowed: $op"; error = 'op-not-allowed' }
      continue
    }
    $program = [string]$allowed.$op
    $errTmp = [System.IO.Path]::GetTempFileName()
    $prevEnc = [Console]::OutputEncoding
    try {
      $argList = @(Build-Args $op $item.params)
      # wsl.exe 以 UTF-16LE（Unicode）输出，须先切换控制台编码，否则按 OEM 码页解码会乱码；
      # 其余程序恢复默认编码。失败也要在 finally 还原 $prevEnc。
      if ([System.IO.Path]::GetFileName($program) -ieq 'wsl.exe') {
        [Console]::OutputEncoding = [System.Text.Encoding]::Unicode
      } else {
        [Console]::OutputEncoding = [System.Text.Encoding]::Default
      }
      $stdout = (& $program @argList 2>$errTmp | Out-String)
      $code = $LASTEXITCODE
      if ($null -eq $code) { $code = 0 }
      $stderr = ''
      if (Test-Path -LiteralPath $errTmp) {
        $stderr = [System.IO.File]::ReadAllText($errTmp, [Console]::OutputEncoding)
      }
      $results += @{ op = $op; ok = ([int]$code -eq 0); code = [int]$code; stdout = [string]$stdout; stderr = [string]$stderr }
    } catch {
      $results += @{ op = $op; ok = $false; code = -1; stdout = ''; stderr = [string]$_.Exception.Message; error = 'invalid-params' }
    } finally {
      [Console]::OutputEncoding = $prevEnc
      Remove-Item -LiteralPath $errTmp -Force -ErrorAction SilentlyContinue
    }
  }
  Write-Result @{ canceled = $false; results = $results }
} catch {
  Write-Result @{ canceled = $false; error = [string]$_.Exception.Message; results = $results }
}
`
}
