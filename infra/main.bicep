targetScope = 'subscription'

param environmentName string
@allowed(['southeastasia'])
param location string
param sessionId string
param deployedBy string
param createdAt string
@allowed(['PersonalRG'])
param resourceGroupName string
param functionAppName string
param planName string
param storageAccountName string
param deploymentContainerName string
param workspaceName string
param appInsightsName string
@allowed(['sellerdevelopment'])
param applicationStorageAccountName string
@allowed(['SellerDevelopment'])
param staticWebAppName string
param frontendOrigins array
param adminUsername string = 'admin'
// Bootstrap creates a protected empty host; configure identity-dependent roles/settings afterward.
param configureBackend bool = true

// Required verified SWA provider binding identifier; its derivation must have authoritative evidence.
@minLength(1)
param swaAuthClientId string
@secure()
@minLength(32)
param adminPassword string
@secure()
@minLength(32)
param sessionSecret string

var tags = {
  'app-onboard-skill': 'true'
  'app-onboard-session-id': sessionId
  'created-at': createdAt
  environment: environmentName
  'deployed-by': deployedBy
}

// Existing group: never create it, replace its tags, or assume ownership of unrelated resources.
resource rg 'Microsoft.Resources/resourceGroups@2023-07-01' existing = {
  name: resourceGroupName
}

module runtimeStorage './modules/runtime-storage.bicep' = {
  name: 'booking-runtime-storage'
  scope: rg
  params: {
    name: storageAccountName
    deploymentContainerName: deploymentContainerName
    location: location
    tags: tags
  }
}

module hostingPlan './modules/hosting-plan.bicep' = {
  name: 'booking-hosting-plan'
  scope: rg
  params: { name: planName, location: location, tags: tags }
}

module workspace './modules/log-analytics.bicep' = {
  name: 'booking-log-analytics'
  scope: rg
  params: { name: workspaceName, location: location, tags: tags }
}

module insights './modules/application-insights.bicep' = {
  name: 'booking-insights'
  scope: rg
  params: {
    name: appInsightsName
    location: location
    workspaceResourceId: workspace.outputs.resourceId
    tags: tags
  }
}

module api './modules/function-app.bicep' = {
  name: 'booking-function-app'
  scope: rg
  params: {
    name: functionAppName
    location: location
    tags: tags
    planResourceId: hostingPlan.outputs.resourceId
    deploymentStorageUri: runtimeStorage.outputs.deploymentStorageUri
    frontendOrigins: frontendOrigins
  }
}

module roles './modules/role-assignments.bicep' = if (configureBackend) {
  name: 'booking-storage-roles'
  scope: rg
  params: {
    principalId: api.outputs.principalId
    runtimeStorageAccountName: runtimeStorage.outputs.name
    applicationStorageAccountName: applicationStorageAccountName
    appInsightsName: insights.outputs.name
  }
}

module authentication './modules/backend-auth.bicep' = {
  name: 'booking-backend-auth'
  scope: rg
  params: {
    functionAppName: api.outputs.name
    swaAuthClientId: swaAuthClientId
  }
}

// Secure inputs never enter AVM's ordinary object parameters and are never output.
module settings './modules/function-settings.bicep' = if (configureBackend) {
  name: 'booking-function-settings'
  scope: rg
  params: {
    functionAppName: api.outputs.name
    storageAccountName: runtimeStorage.outputs.name
    applicationStorageAccountName: applicationStorageAccountName
    appInsightsConnectionString: insights.outputs.connectionString
    adminUsername: adminUsername
    adminPassword: adminPassword
    sessionSecret: sessionSecret
  }
  dependsOn: [roles, authentication]
}

// Routing cutover is a separate template AFTER code deploy and backend protection proof.
output functionAppResourceId string = api.outputs.resourceId
output functionAppHostname string = api.outputs.defaultHostname
output staticWebAppReferenceName string = staticWebAppName
output deploymentContainerUri string = runtimeStorage.outputs.deploymentStorageUri
