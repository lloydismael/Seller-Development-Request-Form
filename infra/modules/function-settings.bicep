param functionAppName string
param storageAccountName string
param applicationStorageAccountName string
param appInsightsConnectionString string
param adminUsername string
@secure()
@minLength(32)
param adminPassword string
@secure()
@minLength(32)
param sessionSecret string

resource api 'Microsoft.Web/sites@2025-03-01' existing = { name: functionAppName }
resource runtimeStorage 'Microsoft.Storage/storageAccounts@2026-06-01' existing = { name: storageAccountName }
resource applicationStorage 'Microsoft.Storage/storageAccounts@2026-06-01' existing = {
  name: applicationStorageAccountName
}
resource settings 'Microsoft.Web/sites/config@2022-09-01' = {
  parent: api
  name: 'appsettings'
  properties: {
    NODE_ENV: 'production'
    ADMIN_USERNAME: adminUsername
    ADMIN_PASSWORD: adminPassword
    SESSION_SECRET: sessionSecret
    STORAGE_TABLE_ENDPOINT: applicationStorage.properties.primaryEndpoints.table
    AzureWebJobsStorage__accountName: runtimeStorage.name
    AzureWebJobsStorage__credential: 'managedidentity'
    AzureWebJobsStorage__blobServiceUri: runtimeStorage.properties.primaryEndpoints.blob
    AzureWebJobsStorage__queueServiceUri: runtimeStorage.properties.primaryEndpoints.queue
    AzureWebJobsStorage__tableServiceUri: runtimeStorage.properties.primaryEndpoints.table
    APPLICATIONINSIGHTS_CONNECTION_STRING: appInsightsConnectionString
    APPLICATIONINSIGHTS_AUTHENTICATION_STRING: 'Authorization=AAD'
  }
}
