param functionAppName string
@minLength(1)
param swaAuthClientId string

resource api 'Microsoft.Web/sites@2025-03-01' existing = { name: functionAppName }
// Backend transport authentication is independent of the app's username/password cookie.
// No anonymous exceptions, including health: all browser traffic must arrive through the trusted SWA.
resource auth 'Microsoft.Web/sites/config@2022-09-01' = {
  parent: api
  name: 'authsettingsV2'
  properties: {
    platform: { enabled: true, runtimeVersion: '~1' }
    globalValidation: { requireAuthentication: true, unauthenticatedClientAction: 'Return401' }
    httpSettings: { requireHttps: true }
    identityProviders: {
      azureStaticWebApps: {
        enabled: true
        registration: { clientId: swaAuthClientId }
      }
    }
    login: { tokenStore: { enabled: false } }
  }
}
