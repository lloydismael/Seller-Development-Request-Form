param name string
param location string
param tags object

// Local minimal definition: reviewed AVM exposes workspace shared keys in ordinary outputs.
resource workspace 'Microsoft.OperationalInsights/workspaces@2026-03-01' = {
  name: name
  location: location
  tags: tags
  properties: {
    sku: { name: 'PerGB2018' }
    retentionInDays: 30
    features: {
      disableLocalAuth: true
      enableLogAccessUsingOnlyResourcePermissions: true
    }
    publicNetworkAccessForIngestion: 'Enabled'
    publicNetworkAccessForQuery: 'Enabled'
  }
}
output resourceId string = workspace.id
