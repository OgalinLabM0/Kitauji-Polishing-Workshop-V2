$ErrorActionPreference = 'Stop'

function Copy-DirectoryContents {
  param(
    [Parameter(Mandatory = $true)][string]$Source,
    [Parameter(Mandatory = $true)][string]$Destination
  )

  New-Item -ItemType Directory -Path $Destination -Force | Out-Null
  Get-ChildItem -LiteralPath $Source -Force | ForEach-Object {
    try {
      Copy-Item -LiteralPath $_.FullName -Destination $Destination -Recurse -Force -ErrorAction Stop
    } catch {
      Write-Warning "跳过当前被占用的二进制运行库文件：$($_.Name)"
    }
  }
}

$projectRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$electronDist = [IO.Path]::GetFullPath((Join-Path $projectRoot 'node_modules\electron\dist'))
$releaseRoot = [IO.Path]::GetFullPath((Join-Path $projectRoot 'release'))
$targetName = '北宇治润色工坊V2-win-x64'
$target = [IO.Path]::GetFullPath((Join-Path $releaseRoot $targetName))
$expectedPrefix = $releaseRoot.TrimEnd([IO.Path]::DirectorySeparatorChar) + [IO.Path]::DirectorySeparatorChar

if (-not $target.StartsWith($expectedPrefix, [StringComparison]::OrdinalIgnoreCase)) {
  throw "正式构建目标不在预期 release 目录内：$target"
}

Push-Location $projectRoot
try {
  & npm.cmd run build
  if ($LASTEXITCODE -ne 0) {
    throw "生产构建失败，退出码：$LASTEXITCODE"
  }
} finally {
  Pop-Location
}

if (-not (Test-Path -LiteralPath $electronDist -PathType Container)) {
  throw "未找到 Electron 运行时。请先在 Version2 中执行 npm install。"
}

if (Test-Path -LiteralPath $target) {
  $resolvedTarget = [IO.Path]::GetFullPath((Resolve-Path -LiteralPath $target).Path)
  if (-not $resolvedTarget.Equals($target, [StringComparison]::OrdinalIgnoreCase)) {
    throw "拒绝清理非预期正式构建目录：$resolvedTarget"
  }
  try {
    Remove-Item -LiteralPath $resolvedTarget -Recurse -Force -ErrorAction Stop
  } catch {
    Write-Warning "主程序二进制文件可能被占用，将保留 Electron 底层动态库并就地覆盖更新前端与后端代码包。"
  }
}

New-Item -ItemType Directory -Path $releaseRoot -Force | Out-Null
Copy-DirectoryContents -Source $electronDist -Destination $target

$appRoot = Join-Path $target 'resources\app'
Copy-DirectoryContents -Source (Join-Path $projectRoot 'dist\electron') -Destination (Join-Path $appRoot 'electron')
Copy-DirectoryContents -Source (Join-Path $projectRoot 'dist\renderer') -Destination (Join-Path $appRoot 'renderer')
Get-ChildItem -LiteralPath (Join-Path $appRoot 'electron') -Filter '*.test.cjs' -File -Recurse | ForEach-Object {
  Remove-Item -LiteralPath $_.FullName -Force
}
$sourcePackage = Get-Content -Raw -LiteralPath (Join-Path $projectRoot 'package.json') | ConvertFrom-Json
$appPackage = Get-Content -Raw -LiteralPath (Join-Path $projectRoot 'packaging\app-package.json') | ConvertFrom-Json
$appPackage.version = $sourcePackage.version
$appPackage | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath (Join-Path $appRoot 'package.json') -Encoding utf8
Copy-Item -LiteralPath (Join-Path $projectRoot 'packaging\使用说明.txt') -Destination (Join-Path $target '使用说明.txt') -Force
Copy-DirectoryContents -Source (Join-Path $projectRoot 'samples') -Destination (Join-Path $target '导入示例')

$defaultExecutable = Join-Path $target 'electron.exe'
$productExecutable = Join-Path $target '北宇治润色工坊V2.exe'
if (Test-Path -LiteralPath $defaultExecutable -PathType Leaf) {
  if (Test-Path -LiteralPath $productExecutable) {
    try {
      Remove-Item -LiteralPath $productExecutable -Force -ErrorAction Stop
      Move-Item -LiteralPath $defaultExecutable -Destination $productExecutable -Force
    } catch {
      Remove-Item -LiteralPath $defaultExecutable -Force -ErrorAction SilentlyContinue
    }
  } else {
    Move-Item -LiteralPath $defaultExecutable -Destination $productExecutable -Force
  }
} elseif (-not (Test-Path -LiteralPath $productExecutable -PathType Leaf)) {
  throw "未找到主程序可执行文件：$productExecutable"
}

$fileCount = (Get-ChildItem -LiteralPath $target -File -Recurse).Count
$sizeBytes = (Get-ChildItem -LiteralPath $target -File -Recurse | Measure-Object -Property Length -Sum).Sum
$sizeMiB = [math]::Round($sizeBytes / 1MB, 1)

Write-Host "正式便携版已生成：$target"
Write-Host "文件数：$fileCount；大小：$sizeMiB MiB"
