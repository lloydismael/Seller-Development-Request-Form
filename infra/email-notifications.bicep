targetScope = 'resourceGroup'

@description('Standalone opt-in only. Never include in main.bicep without separate approval.')
param enabled bool = false

@description('Required explicit consent: documented ECS data geography is United States, not the Function region.')
@allowed([true])
param unitedStatesDataConsent bool

@description('Required explicit approval of pay-as-you-go email, Table, Function, and telemetry costs.')
@allowed([true])
param costApproved bool

@description('Required lifecycle consent: ACS Email retires September 30, 2028; onboarding/expansion restrictions begin October 23, 2026. Recheck eligibility before deploying.')
@allowed([true])
param retirementRiskAccepted bool

@description('First deploy domain; deploy sender only after Domain, SPF, DKIM and DKIM2 are Verified in ECS.')
@allowed([
  'domain'
  'sender'
])
param provisioningStage string = 'domain'

@minLength(1)
@maxLength(63)
param emailServiceName string

@description('NEW dedicated ACS resource name, not an existing shared Communication Service.')
@minLength(1)
@maxLength(63)
param communicationServiceName string

@description('Actual DNS domain/subdomain controlled by the operator. No example domain is provisioned by default.')
@minLength(1)
@maxLength(253)
param senderDomain string

@description('Object/principal ID of the existing separately linked Function managed identity, NOT its client ID. No Function app is created or modified.')
@minLength(36)
@maxLength(36)
param functionManagedIdentityPrincipalId string

@description('Display name for the noreply sender. This does not create an inbound mailbox.')
param senderDisplayName string = 'Booking notifications'

param tags object = {}

var approved = enabled && unitedStatesDataConsent && costApproved && retirementRiskAccepted
var provisionSender = approved && provisioningStage == 'sender'
var dataLocation = 'United States'
var roleDefinitionName = guid(resourceGroup().id, communicationServiceName, 'booking-email-sender-v1')

resource emailService 'Microsoft.Communication/emailServices@2025-09-01' = if (approved) {
  name: emailServiceName
  location: 'global'
  tags: tags
  properties: {
    dataLocation: dataLocation
  }
}

resource domain 'Microsoft.Communication/emailServices/domains@2025-09-01' = if (approved) {
  parent: emailService
  name: senderDomain
  location: 'global'
  tags: tags
  properties: {
    domainManagement: 'CustomerManaged'
    userEngagementTracking: 'Disabled'
  }
}

resource sender 'Microsoft.Communication/emailServices/domains/senderUsernames@2025-09-01' = if (provisionSender) {
  parent: domain
  name: 'noreply'
  properties: {
    username: 'noreply'
    displayName: senderDisplayName
  }
}

resource communicationService 'Microsoft.Communication/communicationServices@2025-09-01' = if (provisionSender) {
  name: communicationServiceName
  location: 'global'
  tags: tags
  properties: {
    dataLocation: dataLocation
    disableLocalAuth: true
    publicNetworkAccess: 'Enabled'
    linkedDomains: [
      domain.id
    ]
  }
}

// Official SMTP custom-role guidance documents these coarse actions; no send-only built-in role or invented GUID.
resource emailSenderRole 'Microsoft.Authorization/roleDefinitions@2022-04-01' = if (provisionSender) {
  name: roleDefinitionName
  properties: {
    roleName: 'Booking email sender ${communicationServiceName}-${uniqueString(resourceGroup().id)}'
    description: 'Documented ACS email permissions, restricted by assignment to this dedicated ACS resource; no keys, delete, or RBAC management.'
    type: 'CustomRole'
    assignableScopes: [
      resourceGroup().id
    ]
    permissions: [
      {
        actions: [
          'Microsoft.Communication/CommunicationServices/Read'
          'Microsoft.Communication/CommunicationServices/Write'
          'Microsoft.Communication/EmailServices/write'
        ]
        notActions: []
        dataActions: []
        notDataActions: []
      }
    ]
  }
}

resource emailSenderAssignment 'Microsoft.Authorization/roleAssignments@2022-04-01' = if (provisionSender) {
  scope: communicationService
  name: guid(communicationService.id, functionManagedIdentityPrincipalId, roleDefinitionName)
  properties: {
    roleDefinitionId: emailSenderRole.id
    principalId: functionManagedIdentityPrincipalId
    principalType: 'ServicePrincipal'
    description: 'Existing Function managed identity email access to dedicated ACS resource only.'
  }
}

output emailDomainResourceId string = approved ? domain.id : ''
output dnsVerificationRecords object = approved ? domain!.properties.verificationRecords : {}
output dnsVerificationStates object = approved ? domain!.properties.verificationStates : {}
output emailEndpoint string = provisionSender ? 'https://${communicationService!.properties.hostName}' : ''
output emailSenderAddress string = provisionSender ? 'noreply@${domain!.properties.fromSenderDomain}' : ''
output emailSenderRoleDefinitionId string = provisionSender ? emailSenderRole.id : ''
output deploymentStage string = approved ? provisioningStage : 'disabled'
