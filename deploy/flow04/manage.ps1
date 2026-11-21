param(
    [ValidateSet('Start','OpenMaintenance','CloseMaintenance','StopCore')]
    [string]$Action = 'Start',
    [string]$ZammadProject = 'C:/ARIMMS-Services/zammad-docker-compose',
    [switch]$Build
)
$ErrorActionPreference = 'Stop'
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
$env:FLOW04_REPO_ROOT = $repoRoot
$coreArgs = @('compose','-p','core-backend','-f',(Join-Path $repoRoot 'compose.yaml'),'-f',(Join-Path $PSScriptRoot 'core.private.yaml'))
$adminArgs = @('compose','-f',(Join-Path $PSScriptRoot 'admin.private.yaml'),'--profile','maintenance')
$zammadArgs = @('compose','-p','zammad-docker-compose','--project-directory',$ZammadProject,'-f',(Join-Path $ZammadProject 'docker-compose.yml'),'-f',(Join-Path $PSScriptRoot 'zammad.private.yaml'))
$zammadServices = @('zammad-postgresql','zammad-redis','zammad-memcached','zammad-elasticsearch','zammad-railsserver','zammad-scheduler','zammad-websocket','zammad-nginx','zammad-backup')
function Invoke-Docker([string[]]$CommandArguments) {
    & docker @CommandArguments
    if ($LASTEXITCODE -ne 0) { throw 'Docker operation failed; stop and inspect before retrying' }
}
function Assert-PrivateEndpoint([string]$Container, [string]$Network, [string]$Alias) {
    $bindings = Invoke-Docker @('inspect','--format','{{json .HostConfig.PortBindings}}',$Container)
    $networks = Invoke-Docker @('inspect','--format','{{json .NetworkSettings.Networks}}',$Container) | ConvertFrom-Json
    $networkProperties = @($networks.PSObject.Properties)
    if ($bindings -notin @('{}','null') -or $networkProperties.Count -ne 1 -or
        $networkProperties[0].Name -ne $Network -or $Alias -notin $networkProperties[0].Value.Aliases) {
        throw "Unexpected port binding, network or DNS alias on $Container"
    }
    $isInternal = Invoke-Docker @('network','inspect','--format','{{.Internal}}',$Network)
    if ($isInternal -ne 'true') { throw "Network $Network is not internal" }
}
function Start-Core {
    Assert-PrivateEndpoint 'zammad-docker-compose-zammad-nginx-1' 'arimms-p0-zammad-private-v1' 'zammad-nginx'
    Invoke-Docker ($coreArgs + @('up','-d','--wait','--wait-timeout','120','--no-build','mongodb'))
    Assert-PrivateEndpoint 'core-backend-mongodb-1' 'arimms-p0-core-data-v1' 'mongodb'
    Invoke-Docker ($coreArgs + @('up','-d','--wait','--wait-timeout','120','--no-build','core'))
    Invoke-Docker @('exec','core-backend-core-1','node','-e',"const dns = require('node:dns/promises'); Promise.all([dns.lookup('mongodb'), fetch('http://zammad-nginx:8080/api/v1/users/me', {headers:{Authorization:'Token token=' + process.env.ZAMMAD_API_TOKEN}, redirect:'error', signal:AbortSignal.timeout(5000)}).then(async r => { if (!r.ok || (await r.json()).id !== Number(process.env.ZAMMAD_SERVICE_USER_ID)) throw Error(); })]).catch(() => { console.error('Mongo DNS or private Zammad authenticated read failed'); process.exitCode = 1; });")
    Write-Host 'Secured Core ready at http://localhost:8082/api/docs'
}
if ($Build -and $Action -ne 'Start') { throw '-Build is only valid with -Action Start' }
switch ($Action) {
    'Start' {
        if ($Build) { & (Join-Path $PSScriptRoot 'build.ps1') }
        Invoke-Docker ($adminArgs + @('stop','admin-gateway'))
        Invoke-Docker @('image','inspect','arimms-core-flow04:local','--format','{{.Id}}')
        Invoke-Docker ($zammadArgs + @('up','-d','--wait','--wait-timeout','180','--no-build') + $zammadServices)
        Start-Core
    }
    'OpenMaintenance' {
        # Stop Core first: no authorization decisions while administrative state changes.
        Invoke-Docker ($coreArgs + @('stop','core'))
        Invoke-Docker ($adminArgs + @('up','-d'))
    }
    'CloseMaintenance' {
        Invoke-Docker ($adminArgs + @('stop','admin-gateway'))
        # Caller must finish and verify maintenance before invoking this action.
        Start-Core
    }
    'StopCore' { Invoke-Docker ($coreArgs + @('stop','core')) }
}
