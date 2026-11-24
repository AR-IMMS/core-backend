param([string]$ImageTag = 'arimms-core-flow04:local')

$ErrorActionPreference = 'Stop'
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
# Explicit allowlist: Docker never traverses local credential directories.
$buildContext = Join-Path ([System.IO.Path]::GetTempPath()) ('arimms-flow04-build-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $buildContext | Out-Null
try {
    foreach ($name in @('package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml', 'tsconfig.json', 'tsconfig.build.json', 'nest-cli.json')) {
        Copy-Item -LiteralPath (Join-Path $repoRoot $name) -Destination $buildContext
    }
    Copy-Item -LiteralPath (Join-Path $repoRoot 'src') -Destination $buildContext -Recurse
    Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'Dockerfile') -Destination $buildContext
    docker build -t $ImageTag $buildContext
    if ($LASTEXITCODE -ne 0) { throw 'Core image build failed' }
} finally {
    $staged = Get-Item -LiteralPath $buildContext
    $tempRoot = (Resolve-Path -LiteralPath ([System.IO.Path]::GetTempPath())).Path.TrimEnd([System.IO.Path]::DirectorySeparatorChar)
    if ($staged.Parent.FullName -eq $tempRoot -and $staged.Name -match '^arimms-flow04-build-[a-f0-9]{32}$') {
        Remove-Item -LiteralPath $staged.FullName -Recurse
    }
}
