param name string
param location string
param tags object

// AVM provisions Microsoft.Web/serverfarms; no local duplicate resource.
module plan 'br/public:avm/res/web/serverfarm:0.5.0' = {
  name: 'flex-plan'
  params: {
    name: name
    location: location
    kind: 'functionapp'
    skuName: 'FC1'
    reserved: true
    zoneRedundant: false
    tags: tags
    enableTelemetry: false
  }
}
output resourceId string = plan.outputs.resourceId
