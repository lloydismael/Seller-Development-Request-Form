# Structural checks operate on compiled ARM (array and languageVersion 2 symbolic resources).
function Get-ArmResources($Template) {
  if ($null -eq $Template.resources) { return }
  if ($Template.resources -is [array]) { $Template.resources }
  else { $Template.resources.PSObject.Properties | ForEach-Object { $_.Value } }
}
function Assert-ParentPreservation($Template, [string]$Path = 'main', [bool]$Link = $false) {
  foreach ($r in @(Get-ArmResources $Template)) {
    if ($r.existing -eq $true) { continue }
    if ($r.type -eq 'Microsoft.Resources/deployments') {
      if ($r.properties.mode -ne 'Incremental') { throw "Non-incremental nested deployment: $Path" }
      if ($null -eq $r.properties.template) { throw "Uninspectable linked template: $Path" }
      Assert-ParentPreservation $r.properties.template "$Path/$($r.name)" $Link
      continue
    }
    # Inspect even dormant definitions: a conditional parent write is still unacceptable.
    if ($r.type -eq 'Microsoft.Resources/resourceGroups' -or $r.type -eq 'Microsoft.Web/staticSites') {
      throw "Existing parent write: $Path/$($r.type)"
    }
    if ($r.type -like 'Microsoft.Web/staticSites/*' -and
        -not ($Link -and $Path -eq 'link' -and $r.type -eq 'Microsoft.Web/staticSites/linkedBackends')) {
      throw "Unexpected frontend child write: $Path/$($r.type)"
    }
    if ($r.type -like 'Microsoft.Storage/storageAccounts*') {
      $allowed = @('Microsoft.Storage/storageAccounts','Microsoft.Storage/storageAccounts/blobServices','Microsoft.Storage/storageAccounts/blobServices/containers')
      if ($Path -ne 'main/booking-runtime-storage' -or $r.type -notin $allowed) {
        throw "Storage write outside new runtime module: $Path/$($r.type)"
      }
      $expectedName = switch ($r.type) {
        'Microsoft.Storage/storageAccounts' { "[parameters('name')]" }
        'Microsoft.Storage/storageAccounts/blobServices' { "[format('{0}/{1}', parameters('name'), 'default')]" }
        'Microsoft.Storage/storageAccounts/blobServices/containers' { "[format('{0}/{1}/{2}', parameters('name'), 'default', parameters('deploymentContainerName'))]" }
      }
      if ($r.name -ne $expectedName) { throw "Unexpected runtime storage target: $Path" }
    }
    if ($r.resources) { Assert-ParentPreservation $r "$Path/child" $Link }
  }
}
function Assert-AuthBinding($Arm) {
  $wrapper = @(Get-ArmResources $Arm | Where-Object name -eq 'booking-backend-auth')[0]
  $auth = @(Get-ArmResources $wrapper.properties.template | Where-Object type -eq 'Microsoft.Web/sites/config')
  if ($auth.Count -ne 1 -or $auth[0].name -ne "[format('{0}/{1}', parameters('functionAppName'), 'authsettingsV2')]") { throw 'Unexpected auth target' }
  $props = $auth[0].properties
  if ($props.platform.enabled -ne $true -or $props.globalValidation.requireAuthentication -ne $true -or
      $props.globalValidation.unauthenticatedClientAction -ne 'Return401' -or $props.globalValidation.excludedPaths -or
      $props.httpSettings.requireHttps -ne $true) { throw 'Backend is not fail-closed HTTPS authentication' }
  $provider = $props.identityProviders.azureStaticWebApps
  if ($provider.enabled -ne $true -or $provider.registration.clientId -ne "[parameters('swaAuthClientId')]" -or
      @($props.identityProviders.PSObject.Properties).Count -ne 1) { throw 'SWA provider enabled/binding mismatch' }
  if ($wrapper.properties.parameters.swaAuthClientId.value -ne "[parameters('swaAuthClientId')]" -or
      $Arm.parameters.swaAuthClientId.type -ne 'string' -or $Arm.parameters.swaAuthClientId.minLength -lt 1 -or
      $Arm.parameters.swaAuthClientId.PSObject.Properties.Name -contains 'defaultValue') { throw 'Required root binding not preserved' }
  $apiName = @(Get-ArmResources $Arm | Where-Object name -eq 'booking-function-app')[0].properties.template.outputs.name.value
  if (-not $apiName -or $wrapper.properties.parameters.functionAppName.value -notmatch 'booking-function-app.*outputs.name.value') { throw 'Authentication not wired to API output' }
}
function Assert-RoleTuples($Arm) {
  $wrapper = @(Get-ArmResources $Arm | Where-Object name -eq 'booking-storage-roles')[0]
  $template = $wrapper.properties.template
  $roles = @(Get-ArmResources $template | Where-Object type -eq 'Microsoft.Authorization/roleAssignments')
  if ($roles.Count -ne 4 -or @(Get-ArmResources $template).Count -ne 4) { throw 'Expected exactly four scoped roles' }
  $tuples = @(
    @('Microsoft.Storage/storageAccounts','runtimeStorageAccountName','blobOwnerRole','b7e6dc6d-f1e8-4753-8033-0f276bb0955b'),
    @('Microsoft.Storage/storageAccounts','runtimeStorageAccountName','tableContributorRole','0a9a7e1f-b9d0-4cc4-a60d-0319b160aaa3'),
    @('Microsoft.Storage/storageAccounts','applicationStorageAccountName','tableContributorRole','0a9a7e1f-b9d0-4cc4-a60d-0319b160aaa3'),
    @('Microsoft.Insights/components','appInsightsName','metricsPublisherRole','3913510d-42f4-4e42-8a64-420c390055eb')
  )
  foreach ($tuple in $tuples) {
    $type,$parameter,$variable,$guid = $tuple
    $scope = "[resourceId('$type', parameters('$parameter'))]"
    $roleId = "[variables('$variable')]"
    $matches = @($roles | Where-Object { $_.scope -eq $scope -and $_.properties.roleDefinitionId -eq $roleId })
    if ($matches.Count -ne 1) { throw "Role scope tuple missing/duplicated: $parameter/$variable" }
    $r = $matches[0]
    if ($r.properties.principalId -ne "[parameters('principalId')]" -or $r.properties.principalType -ne 'ServicePrincipal' -or
        $r.name -ne "[guid(resourceId('$type', parameters('$parameter')), parameters('principalId'), variables('$variable'))]" -or
        $template.variables.$variable -ne "[subscriptionResourceId('Microsoft.Authorization/roleDefinitions', '$guid')]") { throw "Role principal/definition/name mismatch: $parameter/$variable" }
  }
  foreach ($mapping in @(@('principalId','booking-function-app','principalId'),@('runtimeStorageAccountName','booking-runtime-storage','name'),@('appInsightsName','booking-insights','name'))) {
    $key,$module,$output = $mapping
    if ($wrapper.properties.parameters.$key.value -notmatch "$module.*outputs\.$output\.value") { throw "Role input miswired: $key" }
  }
  if ($wrapper.properties.parameters.applicationStorageAccountName.value -ne "[parameters('applicationStorageAccountName')]") { throw 'Application role account miswired' }
}
function Invoke-BicepBuild([string]$File) {
  $oldPreference = $ErrorActionPreference
  try {
    $ErrorActionPreference = 'Continue'
    $lines = @(& az bicep build --file $File --stdout 2>&1)
    $exit = $LASTEXITCODE
  } finally { $ErrorActionPreference = $oldPreference }
  $stdout = [System.Collections.Generic.List[string]]::new()
  foreach ($line in $lines) {
    if ($line -is [System.Management.Automation.ErrorRecord]) {
      $message = $line.ToString()
      if ($line.Exception.Message) { $message = $line.Exception.Message }
      [Console]::Error.WriteLine($message)
    }
    else { $stdout.Add([string]$line) }
  }
  if ($exit -ne 0) { throw "Bicep compilation failed ($exit): $File; see stderr diagnostics" }
  ($stdout -join "`n") | ConvertFrom-Json
}