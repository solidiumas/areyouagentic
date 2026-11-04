// Resource names shared by main.bicep, apps.bicep and the deploy workflow.
// Globally unique names (registry, Postgres, Redis) get a suffix derived from
// the resource group id, so redeploying into the same group is idempotent and
// a second environment in another group never collides.

// Address plan for the VNet. The apps subnet is also the API's TRUST_PROXY:
// the Container Apps ingress connects to the API from inside it.
@export()
var network = {
  vnet: '10.40.0.0/16'
  apps: '10.40.0.0/23'
  postgres: '10.40.2.0/24'
  privateEndpoints: '10.40.3.0/24'
}

@export()
type Names = {
  logs: string
  vnet: string
  registry: string
  postgres: string
  redis: string
  identity: string
  environment: string
  web: string
  api: string
  worker: string
  migrateJob: string
  retentionJob: string
}

@export()
func names(prefix string, resourceGroupId string) Names => {
  logs: '${prefix}-logs'
  vnet: '${prefix}-vnet'
  registry: take(toLower(replace('${prefix}${uniqueString(resourceGroupId)}', '-', '')), 50)
  postgres: '${prefix}-pg-${take(uniqueString(resourceGroupId), 6)}'
  redis: '${prefix}-redis-${take(uniqueString(resourceGroupId), 6)}'
  identity: '${prefix}-apps-id'
  environment: '${prefix}-env'
  web: '${prefix}-web'
  api: '${prefix}-api'
  worker: '${prefix}-worker'
  migrateJob: '${prefix}-migrate'
  retentionJob: '${prefix}-retention'
}
