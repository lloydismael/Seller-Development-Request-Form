[CmdletBinding()]
param(
  [string]$RepoRoot = (Split-Path (Split-Path $PSScriptRoot -Parent) -Parent),
  [string]$PlanPath
)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'scaffold-checks.ps1')
$checks = [System.Collections.Generic.List[object]]::new()
function Assert-Check([string]$Name, [bool]$Passed, [string]$Detail) {
  $checks.Add([ordered]@{ name = $Name; passed = $Passed; detail = $Detail })
  if (-not $Passed) { throw "$Name failed: $Detail" }
}
Push-Location $RepoRoot
try {
  $arm = Invoke-BicepBuild 'infra/main.bicep'
  $raw = $arm | ConvertTo-Json -Depth 100 -Compress
  Assert-Check 'main compilation' $true 'az bicep build --file infra/main.bicep --stdout; stderr preserved'
  $link = Invoke-BicepBuild 'infra/link-backend.bicep'
  Assert-Check 'link compilation' $true 'az bicep build --file infra/link-backend.bicep --stdout; stderr preserved'
  $public = Get-Content infra/main.parameters.json -Raw | ConvertFrom-Json
  $plan = if ($PlanPath) { Get-Content $PlanPath -Raw | ConvertFrom-Json } else { $null }
  $source = (Get-ChildItem infra -Recurse -Filter *.bicep | ForEach-Object { Get-Content $_.FullName -Raw }) -join "`n"
  Assert-Check 'NO-KEYVAULT ARM' (-not ($raw -match 'Microsoft\.KeyVault/vaults|@Microsoft\.KeyVault|keyVaultUrl')) 'All nested ARM templates checked, no vault resource or secret reference.'
  if ($plan) { Assert-Check 'NO-KEYVAULT plan' (-not ($plan.services.name -match 'Key.?Vault')) 'Service and cost removed by explicit user override.' }
  Assert-Check 'public parameters exclude private inputs' (-not ($public.parameters.PSObject.Properties.Name -match 'adminPassword|sessionSecret|swaAuthClientId')) 'Secrets and unverified authentication identifier omitted, not placeholder values.'
  foreach ($n in @('adminPassword','sessionSecret')) {
    Assert-Check "root secure $n" ($arm.parameters.$n.type -eq 'secureString' -and -not $arm.parameters.$n.defaultValue) 'Required secureString, no default.'
  }
  $settings = $arm.resources | Where-Object name -eq 'booking-function-settings'
  foreach ($n in @('adminPassword','sessionSecret')) {
    Assert-Check "nested secure $n" ($settings.properties.template.parameters.$n.type -eq 'secureString') 'Protected across nested deployment boundary.'
  }
  Assert-Check 'no settings outputs' (-not $settings.properties.template.outputs) 'No app settings or authentication secrets output.'
  Assert-ParentPreservation $arm
  Assert-ParentPreservation $link 'link' $true
  Assert-Check 'recursive existing parent preservation' $true 'Array/symbolic nested ARM, incremental deployments, no existing RG/SWA/storage writes; runtime storage targets restricted.'
  $runtimeWrapper = $arm.resources | Where-Object name -eq 'booking-runtime-storage'
  Assert-Check 'runtime name input' ($runtimeWrapper.properties.parameters.name.value -eq "[parameters('storageAccountName')]" -and $public.parameters.storageAccountName.value -ne $public.parameters.applicationStorageAccountName.value) 'New runtime account cannot alias existing application account in public parameters.'
  $runtime = ($arm.resources | Where-Object name -eq 'booking-runtime-storage').properties.template
  $storage = $runtime.resources | Where-Object type -eq 'Microsoft.Storage/storageAccounts'
  Assert-Check 'new storage identity only' ($storage.properties.allowSharedKeyAccess -eq $false -and $storage.properties.allowBlobPublicAccess -eq $false) 'New runtime account rejects shared-key and anonymous blob access.'
  Assert-Check 'runtime module no keys' (-not (($runtime | ConvertTo-Json -Depth 100 -Compress) -match 'listKeys|AccountKey=')) 'No credential retrieval or export in local runtime template.'
  $workspace = ($arm.resources | Where-Object name -eq 'booking-log-analytics').properties.template
  Assert-Check 'workspace no keys' (-not (($workspace | ConvertTo-Json -Depth 100 -Compress) -match 'listKeys|SharedKey')) 'Minimal workspace has resource ID output only.'
  $apiWrapper = ($arm.resources | Where-Object name -eq 'booking-function-app').properties.template
  $siteDeployment = $apiWrapper.resources[0]
  $p = $siteDeployment.properties.parameters
  Assert-Check 'Flex runtime and memory' ($p.functionAppConfig.value.runtime.name -eq 'node' -and $p.functionAppConfig.value.runtime.version -eq '22' -and $p.functionAppConfig.value.scaleAndConcurrency.instanceMemoryMB -eq 2048) 'FC1 Node22, 2048 MB, no alwaysReady configuration.'
  Assert-Check 'Flex managed identity' ($p.managedIdentities.value.systemAssigned -eq $true -and $p.functionAppConfig.value.deployment.storage.authentication.type -eq 'SystemAssignedIdentity') 'System-assigned identity for site and deployment storage.'
  Assert-Check 'Flex settings' (-not ($source -match 'FUNCTIONS_WORKER_RUNTIME|FUNCTIONS_EXTENSION_VERSION|SCM_DO_BUILD_DURING_DEPLOYMENT|ENABLE_ORYX_BUILD|WEBSITE_RUN_FROM_PACKAGE|WEBSITE_CONTENTSHARE|alwaysOn:')) 'No deprecated Flex settings or alwaysOn override.'
  $siteTemplate = $siteDeployment.properties.template
  Assert-Check 'AVM configs empty by default' ($null -eq $siteTemplate.parameters.configs.defaultValue -and -not $p.configs) 'Generic credential-bearing config branches have zero loop iterations; app secrets bypass AVM.'
  Assert-Check 'AVM publishing policies unused' ($null -eq $siteTemplate.parameters.basicPublishingCredentialsPolicies.defaultValue -and -not $p.basicPublishingCredentialsPolicies) 'Generic publishing branches have zero loop iterations; none deploy to Flex.'
  Assert-AuthBinding $arm
  Assert-Check 'backend provider enabled and bound' $true 'Required root input wired to sole enabled SWA provider; HTTPS, Return401, no exceptions; live value not verified.'
  Assert-RoleTuples $arm
  Assert-Check 'four scoped role principal tuples' $true 'Runtime Blob Owner + runtime Table Contributor + application Table Contributor + Insights Metrics Publisher; exact GUID, scope, API identity, deterministic assignment names.'
  Assert-Check 'routing is separate' (@($link.resources).Count -eq 1 -and $link.resources[0].type -eq 'Microsoft.Web/staticSites/linkedBackends') 'Only linked child authored; frontend parent not redeclared.'
  if ($plan) {
    foreach ($n in @('functionAppName','planName','storageAccountName','deploymentContainerName','workspaceName','appInsightsName')) {
      Assert-Check "planned name $n" ($plan.naming.resources.name -contains $public.parameters.$n.value) 'Public value matches supplied approved plan.'
    }
    Assert-Check 'cost arithmetic' ([Math]::Abs(($plan.costEstimate.breakdown | Measure-Object monthlyUsd -Sum).Sum - $plan.costEstimate.monthlyUsd) -lt 0.000001) 'Supplied plan breakdown equals declared total; not a cost guarantee.'
  }
  $crlf = @(Get-ChildItem infra -Recurse -Filter *.bicep | Where-Object { [IO.File]::ReadAllText($_.FullName).Contains("`r") })
  Assert-Check 'LF Bicep' ($crlf.Count -eq 0) 'All generated Bicep files contain LF only.'
  $result = [ordered]@{ passed = $true; checks = $checks; planChecks = $(if ($plan) { 'passed' } else { 'skipped: supply -PlanPath to check private plan' }); limitations = @('Compiler diagnostics remain on stderr; documented API versions may still lack bundled local schemas.', 'Full provider validation deferred: secure inputs are not generated and SWA auth client ID is unverified.', 'Quota unverified; advertised FC1/Node22 support is not a capacity guarantee.', 'AVM contains dormant generic key/publishing branches; no secret inputs or configs supplied to those branches.') }
  $result | ConvertTo-Json -Depth 6
} finally { Pop-Location }