targetScope = 'resourceGroup'
module auth './modules/backend-auth.bicep' = {
  name: 'booking-final-auth'
  params: {
    functionAppName: 'func-booking-prod-8941'
    swaAuthClientId: 'yellow-mushroom-07fa45d00.4.azurestaticapps.net'
  }
}