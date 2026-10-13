@allowed(['southeastasia'])
param location string
param tags object

// Reuse reviewed keyless runtime storage and pinned FC1 hosting modules unchanged.
module storage '../modules/runtime-storage.bicep' = {
  name: 'test-runtime-storage'
  params: {
    name: 'stbookingauth8941'
    deploymentContainerName: 'function-releases'
    location: location
    tags: tags
  }
}
module plan '../modules/hosting-plan.bicep' = {
  name: 'test-flex-plan'
  params: { name: 'asp-booking-authcheck-8941', location: location, tags: tags }
}

// Empty host: no booking source, private app settings or production data roles.
resource api 'Microsoft.Web/sites@2026-08-01' = {
  name: 'func-booking-authcheck-8941'
  location: location
  tags: tags
  kind: 'functionapp,linux'
  identity: { type: 'SystemAssigned' }
  properties: {
    serverFarmId: plan.outputs.resourceId
    httpsOnly: true
    publicNetworkAccess: 'Enabled'
    clientAffinityEnabled: false
    siteConfig: { minTlsVersion: '1.2', ftpsState: 'Disabled' }
    functionAppConfig: {
      runtime: { name: 'node', version: '22' }
      deployment: {
        storage: {
          type: 'blobContainer'
          value: storage.outputs.deploymentStorageUri
          authentication: { type: 'SystemAssignedIdentity' }
        }
      }
      scaleAndConcurrency: { instanceMemoryMB: 2048, maximumInstanceCount: 40 }
    }
  }
}

resource runtime 'Microsoft.Storage/storageAccounts@2026-06-01' existing = { name: 'stbookingauth8941' }
var blobRole = subscriptionResourceId('Microsoft.Authorization/roleDefinitions', 'b7e6dc6d-f1e8-4753-8033-0f276bb0955b')
var tableRole = subscriptionResourceId('Microsoft.Authorization/roleDefinitions', '0a9a7e1f-b9d0-4cc4-a60d-0319b160aaa3')
resource blobAccess 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  scope: runtime
  name: guid(runtime.id, api.id, blobRole)
  properties: { principalId: api.identity.principalId, principalType: 'ServicePrincipal', roleDefinitionId: blobRole }
}
resource tableAccess 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  scope: runtime
  name: guid(runtime.id, api.id, tableRole)
  properties: { principalId: api.identity.principalId, principalType: 'ServicePrincipal', roleDefinitionId: tableRole }
}
resource settings 'Microsoft.Web/sites/config@2022-09-01' = {
  parent: api
  name: 'appsettings'
  properties: {
    AzureWebJobsStorage__accountName: runtime.name
    AzureWebJobsStorage__credential: 'managedidentity'
  }
  dependsOn: [blobAccess, tableAccess]
}

resource frontend 'Microsoft.Web/staticSites@2025-05-01' = {
  name: 'swa-booking-authcheck-8941'
  location: 'eastasia'
  tags: tags
  sku: { name: 'Standard', tier: 'Standard' }
  properties: {}
}

// Linking is intentionally excluded. Azure creates the provider in a separate approved test operation.
output functionAppResourceId string = api.id
output functionAppHostname string = api.properties.defaultHostName
output staticWebAppHostname string = frontend.properties.defaultHostname
