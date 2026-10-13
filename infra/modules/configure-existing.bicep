param principalId string
@secure()
param adminPassword string
@secure()
param sessionSecret string
resource insights 'Microsoft.Insights/components@2020-02-02' existing = { name: 'appi-booking-prod-8941' }
module roles './role-assignments.bicep' = {
  name: 'booking-existing-roles'
  params: {
    principalId: principalId
    runtimeStorageAccountName: 'stbookingprod8941'
    applicationStorageAccountName: 'sellerdevelopment'
    appInsightsName: insights.name
  }
}
module settings './function-settings.bicep' = {
  name: 'booking-existing-settings'
  params: {
    functionAppName: 'func-booking-prod-8941'
    storageAccountName: 'stbookingprod8941'
    applicationStorageAccountName: 'sellerdevelopment'
    appInsightsConnectionString: insights.properties.ConnectionString
    adminUsername: 'admin'
    adminPassword: adminPassword
    sessionSecret: sessionSecret
  }
  dependsOn: [roles]
}
