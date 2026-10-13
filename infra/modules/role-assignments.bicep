param principalId string
param runtimeStorageAccountName string
param applicationStorageAccountName string
param appInsightsName string

resource runtimeStorage 'Microsoft.Storage/storageAccounts@2026-06-01' existing = {
  name: runtimeStorageAccountName
}
resource applicationStorage 'Microsoft.Storage/storageAccounts@2026-06-01' existing = {
  name: applicationStorageAccountName
}
resource insights 'Microsoft.Insights/components@2020-02-02' existing = {
  name: appInsightsName
}

// HTTP-only host needs Blob Data Owner; deployment package access is covered by the same account role.
var blobOwnerRole = subscriptionResourceId(
  'Microsoft.Authorization/roleDefinitions',
  'b7e6dc6d-f1e8-4753-8033-0f276bb0955b'
)
var tableContributorRole = subscriptionResourceId(
  'Microsoft.Authorization/roleDefinitions',
  '0a9a7e1f-b9d0-4cc4-a60d-0319b160aaa3'
)
var metricsPublisherRole = subscriptionResourceId(
  'Microsoft.Authorization/roleDefinitions',
  '3913510d-42f4-4e42-8a64-420c390055eb'
)

resource hostBlobRole 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  scope: runtimeStorage
  name: guid(runtimeStorage.id, principalId, blobOwnerRole)
  properties: { roleDefinitionId: blobOwnerRole, principalId: principalId, principalType: 'ServicePrincipal' }
}
// AzureWebJobsStorage persists host diagnostic events in runtime Tables, not application Tables.
resource hostTablesRole 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  scope: runtimeStorage
  name: guid(runtimeStorage.id, principalId, tableContributorRole)
  properties: { roleDefinitionId: tableContributorRole, principalId: principalId, principalType: 'ServicePrincipal' }
}
resource applicationTablesRole 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  scope: applicationStorage
  name: guid(applicationStorage.id, principalId, tableContributorRole)
  properties: { roleDefinitionId: tableContributorRole, principalId: principalId, principalType: 'ServicePrincipal' }
}
resource telemetryRole 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  scope: insights
  name: guid(insights.id, principalId, metricsPublisherRole)
  properties: { roleDefinitionId: metricsPublisherRole, principalId: principalId, principalType: 'ServicePrincipal' }
}
