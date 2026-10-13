[CmdletBinding()]
param(
  [ValidateSet('Preview', 'Deploy')][string]$Phase = 'Preview',
  [ValidateSet('Bootstrap', 'Configuration')][string]$Stage = 'Bootstrap'
)
$ErrorActionPreference = 'Stop'
$repo = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
$session = Join-Path $repo '.copilot-azure/sessions/89416f71-32ae-4d9a-9cb8-ac7fea2b45cd'
$storePath = Join-Path $session 'production-secrets.clixml'
$runner = Join-Path $PSScriptRoot 'production-deploy.cjs'
$old = $ErrorActionPreference
$templatePath = if ($Stage -eq 'Configuration') { 'infra/configure-backend.bicep' } else { 'infra/main.bicep' }
try {
  $ErrorActionPreference = 'Continue'
  $compiled = & az bicep build --file (Join-Path $repo $templatePath) --stdout
  $compileExit = $LASTEXITCODE
} finally { $ErrorActionPreference = $old }
if ($compileExit -ne 0) { throw 'Production template compilation failed' }
$template = ($compiled -join "`n") | ConvertFrom-Json

if (-not (Test-Path $storePath)) {
  $rng = [Security.Cryptography.RandomNumberGenerator]::Create()
  try {
    $passwordBytes = New-Object byte[] 32; $secretBytes = New-Object byte[] 48
    $rng.GetBytes($passwordBytes); $rng.GetBytes($secretBytes)
    $private = @{
      Password = (ConvertTo-SecureString ([Convert]::ToBase64String($passwordBytes)) -AsPlainText -Force)
      Secret = (ConvertTo-SecureString ([Convert]::ToBase64String($secretBytes)) -AsPlainText -Force)
    }
    # SecureStrings serialize using Windows DPAPI, not plaintext.
    $private | Export-Clixml -LiteralPath $storePath
    $acl = Get-Acl $storePath
    $acl.SetAccessRuleProtection($true, $false)
    $user = [Security.Principal.WindowsIdentity]::GetCurrent().Name
    foreach ($identity in @($user, 'NT AUTHORITY\SYSTEM')) {
      $acl.AddAccessRule((New-Object Security.AccessControl.FileSystemAccessRule($identity, 'FullControl', 'Allow')))
    }
    Set-Acl -LiteralPath $storePath -AclObject $acl
  } finally {
    $rng.Dispose()
    if ($passwordBytes) { [Array]::Clear($passwordBytes, 0, $passwordBytes.Length) }
    if ($secretBytes) { [Array]::Clear($secretBytes, 0, $secretBytes.Length) }
  }
}
$private = Import-Clixml -LiteralPath $storePath
$parameters = (Get-Content (Join-Path $repo 'infra/main.parameters.json') -Raw | ConvertFrom-Json).parameters
if ($Stage -eq 'Configuration') {
  $principal = & az functionapp identity show --name func-booking-prod-8941 --resource-group PersonalRG --subscription 2a77b3d9-39da-4b42-8219-c6fd9b8a6165 --query principalId -o tsv
  if ($LASTEXITCODE -ne 0 -or -not $principal) { throw 'Production identity lookup failed' }
  $parameters = [pscustomobject]@{ resourceGroupName = @{ value = 'PersonalRG' }; principalId = @{ value = $principal.Trim() } }
}
$pointers = @()
try {
  foreach ($entry in @(@('adminPassword', $private.Password), @('sessionSecret', $private.Secret))) {
    $ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($entry[1]); $pointers += $ptr
    $parameters | Add-Member -NotePropertyName $entry[0] -NotePropertyValue @{ value = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr) } -Force
  }
  if ($Stage -eq 'Bootstrap') {
    $parameters | Add-Member -NotePropertyName 'swaAuthClientId' -NotePropertyValue @{ value = 'yellow-mushroom-07fa45d00.4.azurestaticapps.net' } -Force
    $parameters | Add-Member -NotePropertyName 'configureBackend' -NotePropertyValue @{ value = $false } -Force
  }
  # Pipe private inputs into the SDK process, never arguments or a plaintext parameter file.
  $payload = @{ phase = $Phase; stage = $Stage; template = $template; parameters = $parameters } | ConvertTo-Json -Depth 100 -Compress
  $payload | & node $runner
  if ($LASTEXITCODE -ne 0) { throw 'Deployment runner failed; see sanitized status above' }
} finally {
  foreach ($ptr in $pointers) { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr) }
  $payload = $null; $parameters = $null; $private = $null
}