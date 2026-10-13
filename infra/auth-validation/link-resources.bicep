resource frontend 'Microsoft.Web/staticSites@2025-05-01' existing = { name: 'swa-booking-authcheck-8941' }
resource api 'Microsoft.Web/sites@2026-08-01' existing = { name: 'func-booking-authcheck-8941' }
// Test-only link: never references the production SWA or publishes code.
resource link 'Microsoft.Web/staticSites/linkedBackends@2025-05-01' = {
  parent: frontend
  name: api.name
  properties: { backendResourceId: api.id, region: 'southeastasia' }
}