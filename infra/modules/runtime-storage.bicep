param name string
param deploymentContainerName string
param location string
param tags object

// Local minimal definition: reviewed AVM exports storage credentials, which this app does not need.
resource storage 'Microsoft.Storage/storageAccounts@2026-06-01' = {
  name: name
  location: location
  tags: tags
  kind: 'StorageV2'
  sku: { name: 'Standard_LRS' }
  properties: {
    accessTier: 'Hot'
    allowSharedKeyAccess: false
    defaultToOAuthAuthentication: true
    allowBlobPublicAccess: false
    allowCrossTenantReplication: false
    supportsHttpsTrafficOnly: true
    minimumTlsVersion: 'TLS1_2'
    publicNetworkAccess: 'Enabled'
    networkAcls: { bypass: 'None', defaultAction: 'Allow' }
    encryption: {
      keySource: 'Microsoft.Storage'
      requireInfrastructureEncryption: true
      services: {
        blob: { enabled: true, keyType: 'Account' }
        queue: { enabled: true, keyType: 'Account' }
        table: { enabled: true, keyType: 'Account' }
        file: { enabled: true, keyType: 'Account' }
      }
    }
  }
}
resource blobs 'Microsoft.Storage/storageAccounts/blobServices@2026-06-01' = {
  parent: storage
  name: 'default'
  properties: {}
}
resource releases 'Microsoft.Storage/storageAccounts/blobServices/containers@2026-06-01' = {
  parent: blobs
  name: deploymentContainerName
  properties: { publicAccess: 'None' }
}
output name string = storage.name
output resourceId string = storage.id
output deploymentStorageUri string = '${storage.properties.primaryEndpoints.blob}${releases.name}'
