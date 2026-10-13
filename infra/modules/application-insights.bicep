param name string
param location string
param workspaceResourceId string
param tags object

// AVM provisions Microsoft.Insights/components; no local duplicate resource.
module component 'br/public:avm/res/insights/component:0.6.0' = {
  name: 'workspace-insights'
  params: {
    name: name
    location: location
    workspaceResourceId: workspaceResourceId
    applicationType: 'web'
    kind: 'web'
    disableIpMasking: false
    disableLocalAuth: true
    retentionInDays: 30
    tags: tags
    enableTelemetry: false
  }
}
output name string = component.outputs.name
output connectionString string = component.outputs.connectionString
