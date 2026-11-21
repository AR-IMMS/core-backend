param(
    [Parameter(Mandatory)][ValidateSet('poc','staging')][string]$Environment,
    [Parameter(Mandatory)][ValidateSet('Read','Workflow','Recovery')][string]$Mode,
    [ValidateRange(12,2147483647)][int]$Fixture = 16
)
$ErrorActionPreference = 'Stop'
if ($Environment -eq 'staging') {
    throw 'Staging is not configured. The owning teams must approve the isolated environment and seed manifest before enabling it.'
}
$repo = (Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
Push-Location -LiteralPath $repo
$readEnv = 'FLOW04_EXPECT_TECH_WORK', 'FLOW04_REAL_TICKET_FIXTURE_ID', 'FLOW04_DISPOSABLE_HTTP_WORKFLOW'
$priorEnv = @{}
foreach ($name in $readEnv) { $priorEnv[$name] = [Environment]::GetEnvironmentVariable($name, 'Process') }
try {
    $scope = @(
        @('zammad-docker-compose-zammad-nginx-1','arimms-p0-zammad-private-v1'),
        @('core-backend-mongodb-1','arimms-p0-core-data-v1')
    )
    foreach ($entry in $scope) {
        $ports = docker inspect --format '{{json .HostConfig.PortBindings}}' $entry[0]
        if ($LASTEXITCODE -ne 0 -or $ports -notin @('{}','null')) { throw 'Private service has unexpected host bindings' }
        $networks = docker inspect --format '{{range $name, $network := .NetworkSettings.Networks}}{{$name}}{{end}}' $entry[0]
        if ($LASTEXITCODE -ne 0 -or $networks -ne $entry[1]) { throw 'Private service has unexpected network attachment' }
        $internal = docker network inspect --format '{{.Internal}}' $entry[1]
        if ($LASTEXITCODE -ne 0 -or $internal -ne 'true') { throw 'Expected internal Docker network' }
    }
    $gateway = docker ps --filter 'label=com.docker.compose.project=arimms-p0-maintenance' --filter 'label=com.docker.compose.service=admin-gateway' --quiet
    if ($LASTEXITCODE -ne 0 -or $gateway) { throw 'Close maintenance access before the selected PoC verification' }
    $ready = Invoke-WebRequest -UseBasicParsing -TimeoutSec 5 -Uri 'http://localhost:8082/health/ready'
    if ($ready.StatusCode -ne 200) { throw 'Selected Core is not ready' }

    if ($Mode -eq 'Recovery') {
        docker cp test core-backend-core-1:/app/test
        if ($LASTEXITCODE -ne 0) { throw 'Unable to copy test sources to the selected container' }
        node -e "const token=require('dotenv').parse(require('fs').readFileSync('.tmp/flow04-ticket-sessions.env')).CORE_OPERATOR_TOKEN; if(!token || !/^[A-Za-z0-9_.-]+$/.test(token)) process.exit(1); process.stdout.write(token);" | docker exec -i -e FLOW04_DISPOSABLE_RECOVERY=true -e FLOW04_AUTHENTICATED_RECOVERY=true core-backend-core-1 node -r ts-node/register -r tsconfig-paths/register test/ticket-recovery.real.ts
    } else {
        $env:FLOW04_EXPECT_TECH_WORK = 'true'
        $env:FLOW04_REAL_TICKET_FIXTURE_ID = [string]$Fixture
        $env:FLOW04_DISPOSABLE_HTTP_WORKFLOW = if ($Mode -eq 'Workflow') { 'true' } else { 'false' }
        node test/ticket-api.real.cjs
    }
    if ($LASTEXITCODE -ne 0) { throw 'WF-04 real verification did not pass. Review the sanitized result before retrying.' }
} finally {
    foreach ($name in $readEnv) { [Environment]::SetEnvironmentVariable($name, $priorEnv[$name], 'Process') }
    Pop-Location
}
