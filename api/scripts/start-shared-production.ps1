param([switch]$AcknowledgeLiveWrites, [Parameter(Mandatory=$true)][string]$CsatKeyFile)
$ErrorActionPreference='Stop'
if (-not $AcknowledgeLiveWrites) { throw 'Pass -AcknowledgeLiveWrites: localhost writes affect production.' }
$root=Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
$env:LOCAL_DATA_MODE='shared-production'
$env:SHARED_PRODUCTION_ACK='LIVE_DATA_WRITES'
$env:STORAGE_TABLE_ENDPOINT='https://sellerdevelopment.table.core.windows.net/'
$env:STORAGE_CONNECTION_STRING=''
$env:STORAGE_TEST_FILE=''
$env:WEBSITE_SITE_NAME=''
$env:NODE_ENV='development'
$env:AZURE_TENANT_ID='3250f76b-9ac9-409f-a84f-f4867a615ef3'
$secureKey=Import-Clixml (Resolve-Path $CsatKeyFile)
$env:CSAT_SIGNING_KEY=[Net.NetworkCredential]::new('', $secureKey).Password
$env:CSAT_PUBLIC_ORIGIN='https://sellerdevelopmentrf.clouditechsolution.com'
$bytes=New-Object byte[] 48
$rng=[Security.Cryptography.RandomNumberGenerator]::Create()
$rng.GetBytes($bytes); $rng.Dispose()
$env:SESSION_SECRET=[Convert]::ToBase64String($bytes)
Remove-Item Env:ADMIN_ALLOWED_ORIGINS -ErrorAction SilentlyContinue
Set-Location $root
node -e "(async()=>{const s=require('./api/src/store');await s.checkConnection();if(!await s.accounts.get('local-admin'))throw Error('Existing production admin required');const f=require('./api/src/forms');await f.published();console.log('Shared production prerequisites verified; no bootstrap performed.');})().catch(()=>{console.error('Shared production preflight failed. Check identity, table permissions and schema.');process.exitCode=1})"
if ($LASTEXITCODE -ne 0) { throw 'Preflight failed; server not started.' }
$ErrorActionPreference='Continue'
swa start app --swa-config-location app --api-location api --port 4281 --api-port 7071 --host localhost
