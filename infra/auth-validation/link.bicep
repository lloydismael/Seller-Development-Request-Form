targetScope = 'subscription'
@allowed(['rg-booking-authcheck-8941'])
param resourceGroupName string = 'rg-booking-authcheck-8941'

resource testGroup 'Microsoft.Resources/resourceGroups@2023-07-01' existing = { name: resourceGroupName }
module link './link-resources.bicep' = {
  name: 'isolated-auth-link'
  scope: testGroup
}
