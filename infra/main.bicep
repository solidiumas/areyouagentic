// Core infrastructure for areyouagentic.com on Azure: network, logs,
// container registry, Postgres, Redis and the Container Apps environment.
// The apps and jobs that run in it are deployed separately by apps.bicep,
// after their images exist in the registry (see .github/workflows/deploy.yml).
//
//   az deployment group create -g <rg> -f infra/main.bicep \
//     -p postgresAdminPassword=<secret>
//
// Everything here is idempotent: redeploying with the same parameters is a
// no-op, which is why the deploy workflow runs it on every deploy.

targetScope = 'resourceGroup'

import { names, network } from 'naming.bicep'

@description('Short prefix for every resource name, e.g. "aya-prod".')
@minLength(3)
@maxLength(16)
param prefix string = 'aya-prod'

@description('Region for all resources. Defaults to the resource group\'s region.')
param location string = resourceGroup().location

@description('Postgres administrator login. Also the user in DATABASE_URL.')
param postgresAdminLogin string = 'ayaadmin'

@description('Postgres administrator password (from the POSTGRES_ADMIN_PASSWORD secret).')
@secure()
@minLength(16)
param postgresAdminPassword string

@description('Postgres compute size. Burstable B1ms is enough for the beta.')
param postgresSku string = 'Standard_B1ms'

@description('Azure Managed Redis size.')
param redisSku string = 'Balanced_B0'

@description('Days of Postgres point-in-time backups to keep (7–35).')
@minValue(7)
@maxValue(35)
param postgresBackupRetentionDays int = 7

var n = names(prefix, resourceGroup().id)
var tags = {
  app: 'areyouagentic'
  managedBy: 'bicep'
}

// ── Logs ───────────────────────────────────────────────────────────────────
resource logs 'Microsoft.OperationalInsights/workspaces@2023-09-01' = {
  name: n.logs
  location: location
  tags: tags
  properties: {
    sku: {
      name: 'PerGB2018'
    }
    retentionInDays: 30
  }
}

// ── Network ────────────────────────────────────────────────────────────────
// apps: the Container Apps environment (workload profiles need a delegated
// subnet, /27 minimum). postgres: Flexible Server's delegated subnet.
// private-endpoints: Redis. Nothing but the apps subnet can reach the data
// tier, and the data tier has no public endpoint at all.
resource vnet 'Microsoft.Network/virtualNetworks@2024-05-01' = {
  name: n.vnet
  location: location
  tags: tags
  properties: {
    addressSpace: {
      addressPrefixes: [network.vnet]
    }
    subnets: [
      {
        name: 'apps'
        properties: {
          addressPrefix: network.apps
          delegations: [
            {
              name: 'containerapps'
              properties: {
                serviceName: 'Microsoft.App/environments'
              }
            }
          ]
        }
      }
      {
        name: 'postgres'
        properties: {
          addressPrefix: network.postgres
          delegations: [
            {
              name: 'postgres'
              properties: {
                serviceName: 'Microsoft.DBforPostgreSQL/flexibleServers'
              }
            }
          ]
        }
      }
      {
        name: 'private-endpoints'
        properties: {
          addressPrefix: network.privateEndpoints
        }
      }
    ]
  }
}

// ── Container registry ─────────────────────────────────────────────────────
// Admin user stays off: the deploy workflow pushes with its own Entra
// identity and the apps pull with the managed identity below.
resource registry 'Microsoft.ContainerRegistry/registries@2023-07-01' = {
  name: n.registry
  location: location
  tags: tags
  sku: {
    name: 'Basic'
  }
  properties: {
    adminUserEnabled: false
  }
}

resource appsIdentity 'Microsoft.ManagedIdentity/userAssignedIdentities@2023-01-31' = {
  name: n.identity
  location: location
  tags: tags
}

var acrPullRoleId = subscriptionResourceId(
  'Microsoft.Authorization/roleDefinitions',
  '7f951dda-4ed3-4680-a7ca-43fe172d538d'
)

resource appsCanPull 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(registry.id, appsIdentity.id, acrPullRoleId)
  scope: registry
  properties: {
    roleDefinitionId: acrPullRoleId
    principalId: appsIdentity.properties.principalId
    principalType: 'ServicePrincipal'
  }
}

// ── Postgres ───────────────────────────────────────────────────────────────
resource postgresDns 'Microsoft.Network/privateDnsZones@2024-06-01' = {
  name: '${n.postgres}.private.postgres.database.azure.com'
  location: 'global'
  tags: tags
}

resource postgresDnsLink 'Microsoft.Network/privateDnsZones/virtualNetworkLinks@2024-06-01' = {
  parent: postgresDns
  name: '${n.vnet}-link'
  location: 'global'
  properties: {
    registrationEnabled: false
    virtualNetwork: {
      id: vnet.id
    }
  }
}

resource postgres 'Microsoft.DBforPostgreSQL/flexibleServers@2024-08-01' = {
  name: n.postgres
  location: location
  tags: tags
  sku: {
    name: postgresSku
    tier: 'Burstable'
  }
  properties: {
    version: '16'
    administratorLogin: postgresAdminLogin
    administratorLoginPassword: postgresAdminPassword
    authConfig: {
      passwordAuth: 'Enabled'
      activeDirectoryAuth: 'Disabled'
    }
    storage: {
      storageSizeGB: 32
      autoGrow: 'Enabled'
    }
    backup: {
      backupRetentionDays: postgresBackupRetentionDays
      geoRedundantBackup: 'Disabled'
    }
    highAvailability: {
      mode: 'Disabled'
    }
    network: {
      delegatedSubnetResourceId: '${vnet.id}/subnets/postgres'
      privateDnsZoneArmResourceId: postgresDns.id
      publicNetworkAccess: 'Disabled'
    }
  }
  dependsOn: [postgresDnsLink]
}

resource database 'Microsoft.DBforPostgreSQL/flexibleServers/databases@2024-08-01' = {
  parent: postgres
  name: 'areyouagentic'
  properties: {
    charset: 'UTF8'
    collation: 'en_US.utf8'
  }
}

// ── Redis (Azure Managed Redis) ────────────────────────────────────────────
// BullMQ needs noeviction (an evicted job key is a silently lost job) and
// TLS on port 10000. EnterpriseCluster exposes one endpoint, so the plain
// ioredis client works unchanged; QUEUE_PREFIX keeps BullMQ's keys in one
// slot. Reached only through the private endpoint below.
resource redis 'Microsoft.Cache/redisEnterprise@2025-04-01' = {
  name: n.redis
  location: location
  tags: tags
  sku: {
    name: redisSku
  }
  properties: {
    minimumTlsVersion: '1.2'
    highAvailability: 'Disabled'
  }
}

resource redisDb 'Microsoft.Cache/redisEnterprise/databases@2025-04-01' = {
  parent: redis
  name: 'default'
  properties: {
    clientProtocol: 'Encrypted'
    port: 10000
    clusteringPolicy: 'EnterpriseCluster'
    evictionPolicy: 'NoEviction'
    accessKeysAuthentication: 'Enabled'
  }
}

resource redisDns 'Microsoft.Network/privateDnsZones@2024-06-01' = {
  name: 'privatelink.redis.azure.net'
  location: 'global'
  tags: tags
}

resource redisDnsLink 'Microsoft.Network/privateDnsZones/virtualNetworkLinks@2024-06-01' = {
  parent: redisDns
  name: '${n.vnet}-link'
  location: 'global'
  properties: {
    registrationEnabled: false
    virtualNetwork: {
      id: vnet.id
    }
  }
}

resource redisEndpoint 'Microsoft.Network/privateEndpoints@2024-05-01' = {
  name: '${n.redis}-pe'
  location: location
  tags: tags
  properties: {
    subnet: {
      id: '${vnet.id}/subnets/private-endpoints'
    }
    privateLinkServiceConnections: [
      {
        name: 'redis'
        properties: {
          privateLinkServiceId: redis.id
          groupIds: ['redisEnterprise']
        }
      }
    ]
  }
  dependsOn: [redisDb]
}

resource redisEndpointDns 'Microsoft.Network/privateEndpoints/privateDnsZoneGroups@2024-05-01' = {
  parent: redisEndpoint
  name: 'default'
  properties: {
    privateDnsZoneConfigs: [
      {
        name: 'redis'
        properties: {
          privateDnsZoneId: redisDns.id
        }
      }
    ]
  }
}

// ── Container Apps environment ─────────────────────────────────────────────
resource environment 'Microsoft.App/managedEnvironments@2025-01-01' = {
  name: n.environment
  location: location
  tags: tags
  properties: {
    appLogsConfiguration: {
      destination: 'log-analytics'
      logAnalyticsConfiguration: {
        customerId: logs.properties.customerId
        sharedKey: logs.listKeys().primarySharedKey
      }
    }
    vnetConfiguration: {
      infrastructureSubnetId: '${vnet.id}/subnets/apps'
      internal: false
    }
    workloadProfiles: [
      {
        name: 'Consumption'
        workloadProfileType: 'Consumption'
      }
    ]
    zoneRedundant: false
  }
}

// The deploy workflow reads these to tag/push images and to derive the
// default public URLs (https://<app>.<defaultDomain>) before a custom
// domain is attached.
output registryName string = registry.name
output registryLoginServer string = registry.properties.loginServer
output environmentDefaultDomain string = environment.properties.defaultDomain
output webAppName string = n.web
output apiAppName string = n.api
output workerAppName string = n.worker
output migrateJobName string = n.migrateJob
