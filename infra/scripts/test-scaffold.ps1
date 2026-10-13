[CmdletBinding()]
param([string]$RepoRoot = (Split-Path (Split-Path $PSScriptRoot -Parent) -Parent))
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'scaffold-checks.ps1')
Push-Location $RepoRoot
try {
  $arm = Invoke-BicepBuild 'infra/main.bicep'
  $tests = [System.Collections.Generic.List[string]]::new()
  function Reject-Mutation([string]$Name, [scriptblock]$Mutate, [scriptblock]$Check) {
    $copy = $arm | ConvertTo-Json -Depth 100 | ConvertFrom-Json
    & $Mutate $copy
    $rejected = $false
    try { & $Check $copy } catch { $rejected = $true }
    if (-not $rejected) { throw "Regression was not detected: $Name" }
    $tests.Add($Name)
  }
  Assert-ParentPreservation $arm
  Assert-AuthBinding $arm
  Assert-RoleTuples $arm
  $tests.Add('unchanged compiled ARM passes')
  Reject-Mutation 'deep symbolic SWA parent write' {
    param($a)
    $site = ($a.resources | Where-Object name -eq 'booking-function-app').properties.template.resources[0].properties.template
    $site.resources | Add-Member NoteProperty forbidden ([pscustomobject]@{type='Microsoft.Web/staticSites';name='SellerDevelopment'})
  } { param($a) Assert-ParentPreservation $a }
  Reject-Mutation 'deep array resource group write' {
    param($a)
    $t = ($a.resources | Where-Object name -eq 'booking-runtime-storage').properties.template
    $t.resources += [pscustomobject]@{type='Microsoft.Resources/resourceGroups';name='PersonalRG'}
  } { param($a) Assert-ParentPreservation $a }
  Reject-Mutation 'runtime account redirected to application storage' {
    param($a)
    ($a.resources | Where-Object name -eq 'booking-runtime-storage').properties.template.resources[0].name = 'sellerdevelopment'
  } { param($a) Assert-ParentPreservation $a }
  Reject-Mutation 'nested complete mode' { param($a) $a.resources[0].properties.mode = 'Complete' } { param($a) Assert-ParentPreservation $a }
  Reject-Mutation 'disabled SWA provider' {
    param($a)
    ($a.resources | Where-Object name -eq 'booking-backend-auth').properties.template.resources[0].properties.identityProviders.azureStaticWebApps.enabled = $false
  } { param($a) Assert-AuthBinding $a }
  Reject-Mutation 'literal SWA binding' {
    param($a)
    ($a.resources | Where-Object name -eq 'booking-backend-auth').properties.template.resources[0].properties.identityProviders.azureStaticWebApps.registration.clientId = 'guessed'
  } { param($a) Assert-AuthBinding $a }
  Reject-Mutation 'miswired root binding' {
    param($a)
    ($a.resources | Where-Object name -eq 'booking-backend-auth').properties.parameters.swaAuthClientId.value = 'guessed'
  } { param($a) Assert-AuthBinding $a }
  Reject-Mutation 'runtime Table role absent' {
    param($a)
    $t = ($a.resources | Where-Object name -eq 'booking-storage-roles').properties.template
    $t.resources = @($t.resources | Where-Object { $_.name -notmatch "runtimeStorageAccountName.*tableContributorRole" })
  } { param($a) Assert-RoleTuples $a }
  Reject-Mutation 'wrong role scope' {
    param($a)
    ($a.resources | Where-Object name -eq 'booking-storage-roles').properties.template.resources[0].scope = "[subscription().id]"
  } { param($a) Assert-RoleTuples $a }
  Reject-Mutation 'wrong role principal' {
    param($a)
    ($a.resources | Where-Object name -eq 'booking-storage-roles').properties.template.resources[0].properties.principalId = 'someone-else'
  } { param($a) Assert-RoleTuples $a }
  Reject-Mutation 'wrong canonical role GUID' {
    param($a)
    ($a.resources | Where-Object name -eq 'booking-storage-roles').properties.template.variables.tableContributorRole = 'incorrect'
  } { param($a) Assert-RoleTuples $a }
  Reject-Mutation 'API principal output miswired' {
    param($a)
    ($a.resources | Where-Object name -eq 'booking-storage-roles').properties.parameters.principalId.value = 'another-principal'
  } { param($a) Assert-RoleTuples $a }
  [ordered]@{passed=$true;count=$tests.Count;tests=$tests} | ConvertTo-Json -Depth 4
} finally { Pop-Location }