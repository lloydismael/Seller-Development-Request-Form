targetScope = 'resourceGroup'
@allowed(['SellerDevelopment'])
param staticWebAppName string = 'SellerDevelopment'
@allowed(['func-booking-prod-8941'])
param functionAppName string = 'func-booking-prod-8941'
@allowed(['southeastasia'])
param backendRegion string = 'southeastasia'

resource frontend 'Microsoft.Web/staticSites@2025-03-01' existing = { name: staticWebAppName }
resource api 'Microsoft.Web/sites@2025-03-01' existing = { name: functionAppName }
// Separately approved routing cutover only after backend auth, code and identity/storage checks.
resource link 'Microsoft.Web/staticSites/linkedBackends@2025-03-01' = {
  parent: frontend
  name: functionAppName
  properties: { backendResourceId: api.id, region: backendRegion }
}
