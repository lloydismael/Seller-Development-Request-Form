param name string
param location string
param tags object
param planResourceId string
param deploymentStorageUri string
param frontendOrigins array

module site 'br/public:avm/res/web/site:0.19.0' = {
  name: 'flex-function'
  params: {
    name: name
    location: location
    kind: 'functionapp,linux'
    serverFarmResourceId: planResourceId
    managedIdentities: { systemAssigned: true }
    httpsOnly: true
    publicNetworkAccess: 'Enabled'
    clientAffinityEnabled: false
    siteConfig: {
      minTlsVersion: '1.2'
      ftpsState: 'Disabled'
      cors: { allowedOrigins: frontendOrigins, supportCredentials: false }
    }
    functionAppConfig: {
      runtime: { name: 'node', version: '22' }
      deployment: {
        storage: {
          type: 'blobContainer'
          value: deploymentStorageUri
          authentication: { type: 'SystemAssignedIdentity' }
        }
      }
      scaleAndConcurrency: {
        instanceMemoryMB: 2048
        maximumInstanceCount: 100
      }
    }
    tags: tags
    enableTelemetry: false
  }
}
output name string = site.outputs.name
output resourceId string = site.outputs.resourceId
output principalId string = site.outputs.systemAssignedMIPrincipalId!
output defaultHostname string = site.outputs.defaultHostname
