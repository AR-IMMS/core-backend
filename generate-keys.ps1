$ErrorActionPreference = 'Stop'
$privatePath = Join-Path $PWD 'iam-jwt-private.pem'
$publicPath = Join-Path $PWD 'iam-jwt-public.pem'
$envPath = Join-Path $PWD '.env.local'

try {
    Write-Host 'Generating a local RSA key pair with OpenSSL...' -ForegroundColor Cyan
    & openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:2048 -out $privatePath
    if ($LASTEXITCODE -ne 0) { throw 'OpenSSL failed to generate the private key.' }

    & openssl pkey -in $privatePath -pubout -out $publicPath
    if ($LASTEXITCODE -ne 0) { throw 'OpenSSL failed to derive the public key.' }

    $privateKey = (Get-Content -LiteralPath $privatePath -Raw) -replace '\r?\n', '\n'
    $publicKey = (Get-Content -LiteralPath $publicPath -Raw) -replace '\r?\n', '\n'
    $lines = @()
    if (Test-Path -LiteralPath $envPath) {
        $lines = @(Get-Content -LiteralPath $envPath)
    }

    $lines = @($lines | Where-Object {
        $_ -notmatch '^IAM_JWT_PRIVATE_KEY=' -and
        $_ -notmatch '^IAM_JWT_PUBLIC_KEY='
    })
    $lines += "IAM_JWT_PRIVATE_KEY=`"$privateKey`""
    $lines += "IAM_JWT_PUBLIC_KEY=`"$publicKey`""
    Set-Content -LiteralPath $envPath -Value $lines -Encoding utf8

    Write-Host 'Updated JWT keys in .env.local. Keep this ignored file private.' -ForegroundColor Green
}
finally {
    Remove-Item -LiteralPath $privatePath, $publicPath -ErrorAction SilentlyContinue
}
