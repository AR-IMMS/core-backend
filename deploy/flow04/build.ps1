$ErrorActionPreference = 'Stop'
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
# Explicit allowlist: Docker never traverses local credential directories.
$buildContext = Join-Path ([System.IO.Path]::GetTempPath()) ('arimms-flow04-build-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $buildContext | Out-Null
foreach ($name in @('package.json', 'pnpm-lock.yaml', 'tsconfig.json', 'tsconfig.build.json', 'nest-cli.json')) {
    Copy-Item -LiteralPath (Join-Path $repoRoot $name) -Destination $buildContext
}
Copy-Item -LiteralPath (Join-Path $repoRoot 'src') -Destination $buildContext -Recurse
Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'Dockerfile') -Destination $buildContext
docker build -t arimms-core-flow04:local $buildContext
if ($LASTEXITCODE -ne 0) { throw 'Core image build failed' }
