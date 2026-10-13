// Only the isolated host is targeted. This value was read from Azure after test linking.
resource api 'Microsoft.Web/sites@2025-03-01' existing = {
  name: 'func-booking-authcheck-8941'
}
resource auth 'Microsoft.Web/sites/config@2022-09-01' = {
  parent: api
  name: 'authsettingsV2'
  properties: {
    platform: { enabled: true, runtimeVersion: '~1' }
    globalValidation: {
      requireAuthentication: true
      unauthenticatedClientAction: 'Return401'
      excludedPaths: []
    }
    httpSettings: { requireHttps: true }
    identityProviders: {
      azureStaticWebApps: {
        enabled: true
        registration: { clientId: 'red-tree-011474e00.5.azurestaticapps.net' }
      }
    }
    login: { tokenStore: { enabled: false } }
  }
}
