targetScope = 'subscription'
@allowed(['PersonalRG'])
param resourceGroupName string = 'PersonalRG'
param principalId string
@secure()
param adminPassword string
@secure()
param sessionSecret string

resource rg 'Microsoft.Resources/resourceGroups@2023-07-01' existing = { name: resourceGroupName }
module configuration './modules/configure-existing.bicep' = {
  name: 'booking-existing-configuration'
  scope: rg
  params: { principalId: principalId, adminPassword: adminPassword, sessionSecret: sessionSecret }
}
