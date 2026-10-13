targetScope = 'subscription'

@allowed(['rg-booking-authcheck-8941'])
param resourceGroupName string = 'rg-booking-authcheck-8941'
@allowed(['southeastasia'])
param location string = 'southeastasia'
param createdAt string
param deployedBy string = 'Lloyd'
param sessionId string = '89416f71-32ae-4d9a-9cb8-ac7fea2b45cd'

var tags = {
  'app-onboard-skill': 'true'
  'app-onboard-session-id': sessionId
  'created-at': createdAt
  environment: 'booking-authcheck-8941'
  'deployed-by': deployedBy
  purpose: 'isolated-auth-validation'
}

// New dedicated test group only. Never deploy this experiment into PersonalRG.
resource testGroup 'Microsoft.Resources/resourceGroups@2023-07-01' = {
  name: resourceGroupName
  location: location
  tags: tags
}

module resources './resources.bicep' = {
  name: 'isolated-auth-resources'
  scope: testGroup
  params: { location: location, tags: tags }
}

output testResourceGroup string = testGroup.name
output functionAppResourceId string = resources.outputs.functionAppResourceId
output functionAppHostname string = resources.outputs.functionAppHostname
output staticWebAppHostname string = resources.outputs.staticWebAppHostname