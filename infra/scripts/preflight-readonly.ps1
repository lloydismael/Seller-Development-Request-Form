[CmdletBinding()]
param([string]$RepoRoot = (Split-Path (Split-Path $PSScriptRoot -Parent) -Parent))
$ErrorActionPreference = 'Stop'
function Read-Az([string[]]$Arguments) {
  $old = $ErrorActionPreference
  try { $ErrorActionPreference = 'Continue'; $raw = & az @Arguments; $exit = $LASTEXITCODE }
  finally { $ErrorActionPreference = $old }
  if ($exit -ne 0) { throw "Read-only CLI check failed: $($Arguments[0])" }
  ($raw -join "`n") | ConvertFrom-Json
}
$p = (Get-Content (Join-Path $RepoRoot 'infra/main.parameters.json') -Raw | ConvertFrom-Json).parameters
$sub = Read-Az @('account','show','--query','{id:id,name:name}','-o','json')
# No login, account switch, registration, keys, data-plane requests or deployments.
if ($sub.id -ne '2a77b3d9-39da-4b42-8219-c6fd9b8a6165') { throw 'Active subscription differs from approved target' }
$providers = foreach ($ns in @('Microsoft.Web','Microsoft.Storage','Microsoft.Insights','Microsoft.OperationalInsights')) {
  Read-Az @('provider','show','--namespace',$ns,'--subscription',$sub.id,'--query','{namespace:namespace,state:registrationState}','-o','json')
}
if (@($providers | Where-Object state -ne 'Registered').Count) { throw 'Provider not registered; do not register automatically' }
$group = Read-Az @('group','show','--name',$p.resourceGroupName.value,'--subscription',$sub.id,'--query','{id:id,location:location}','-o','json')
$site = Read-Az @('staticwebapp','show','--name',$p.staticWebAppName.value,'--resource-group',$p.resourceGroupName.value,'--subscription',$sub.id,'--query','{id:id,sku:sku.name,location:location}','-o','json')
if ($site.sku -ne 'Standard') { throw 'Existing SWA must remain Standard' }
$links = Read-Az @('staticwebapp','backends','show','--name',$p.staticWebAppName.value,'--resource-group',$p.resourceGroupName.value,'--subscription',$sub.id,'-o','json')
$storage = Read-Az @('storage','account','show','--name',$p.applicationStorageAccountName.value,'--resource-group',$p.resourceGroupName.value,'--subscription',$sub.id,'--query','{id:id,location:location,tableEndpoint:primaryEndpoints.table}','-o','json')
$availability = Read-Az @('storage','account','check-name','--name',$p.storageAccountName.value,'--subscription',$sub.id,'-o','json')
[ordered]@{readOnly=$true;subscription=$sub;providers=$providers;group=$group;frontend=$site;linkedBackends=$links;applicationStorage=$storage;runtimeNameAvailability=$availability;limitations=@('No FC1 capacity guarantee; obtain quota/support evidence before provisioning.','No auth binding/live rejection proof, private inputs, ARM validation or what-if.','Name availability is transient; review inherited policies, locks, deployment permissions and existing target-name collisions separately.')} | ConvertTo-Json -Depth 8