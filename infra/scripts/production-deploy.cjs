// The ARM SDK sends secureString parameters in memory and polls its deployment LRO.
// Never serialize the input, token, full ARM errors or what-if settings to disk/logs.
const path = require('node:path');
const root = path.resolve(__dirname, '../..');
const dependencies = path.join(root, '.copilot-azure/sessions/89416f71-32ae-4d9a-9cb8-ac7fea2b45cd/deploy-tools/node_modules');
const { AzureCliCredential } = require(path.join(root, 'api/node_modules/@azure/identity'));
const { ResourceManagementClient } = require(path.join(dependencies, '@azure/arm-resources'));
const subscription = '2a77b3d9-39da-4b42-8219-c6fd9b8a6165';
(async () => {
  let input = '';
  for await (const chunk of process.stdin) input += chunk;
  const { phase, stage, template, parameters } = JSON.parse(input); input = '';
  if (!['Preview', 'Deploy'].includes(phase)) throw new Error('Invalid phase');
  if (!['Bootstrap', 'Configuration'].includes(stage)) throw new Error('Invalid stage');
  const deploymentName = `booking-prod-8941-${stage.toLowerCase()}`;
  const client = new ResourceManagementClient(new AzureCliCredential(), subscription);
  const body = { location: 'southeastasia', properties: { mode: 'Incremental', template, parameters } };
  if (phase === 'Preview') {
    const result = await client.deployments.beginWhatIfAtSubscriptionScopeAndWait(`${deploymentName}-preview`, body);
    const redact = message => ['adminPassword', 'sessionSecret'].reduce((text, name) => text.split(parameters[name].value).join('[REDACTED]'), String(message || ''));
    const errorCodes = error => error ? [{ code: error.code, target: error.target, message: redact(error.message) }, ...(error.details || []).flatMap(errorCodes)] : [];
    console.log(JSON.stringify({ phase, status: result.status, errors: errorCodes(result.error), changes: (result.changes || []).map(c => ({ type: c.changeType, id: c.resourceId })) }));
    if (result.error || result.status !== 'Succeeded') process.exitCode = 1;
  } else {
    const result = await client.deployments.beginCreateOrUpdateAtSubscriptionScopeAndWait(deploymentName, body);
    console.log(JSON.stringify({ phase, status: result.properties?.provisioningState }));
    if (result.properties?.provisioningState !== 'Succeeded') process.exitCode = 1;
  }
})().catch(error => {
  console.error(JSON.stringify({ failed: true, code: error.code || 'DeploymentError', status: error.statusCode || null }));
  process.exitCode = 1;
});