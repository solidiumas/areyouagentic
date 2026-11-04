// Apps and jobs on the Container Apps environment created by main.bicep:
// web, api, worker, the manual migrate job and the daily retention job.
//
// The deploy workflow runs this twice per deploy: first with
// migrateOnly=true (updates just the migrate job to the new image, which it
// then executes), then with migrateOnly=false (rolls web/api/worker and the
// retention job to the new images). That way the schema is migrated before
// any new code that depends on it starts serving.
//
// Secrets arrive as @secure() parameters (GitHub environment secrets) or are
// read from the data tier (Postgres FQDN, Redis access key), and are stored
// as per-app Container Apps secrets. Each app only gets the secrets it needs:
// ANTHROPIC_API_KEY exists on the worker alone.

targetScope = 'resourceGroup'

import { names, network } from 'naming.bicep'

@description('Must match the prefix main.bicep was deployed with.')
param prefix string = 'aya-prod'

param location string = resourceGroup().location

@description('Full image references, e.g. <registry>.azurecr.io/web:<sha>.')
param webImage string
param apiImage string
param workerImage string
param migrateImage string

@description('Deploy only the migrate job (first pass of a deploy).')
param migrateOnly bool = false

@description('Public origin of the web app. Empty = the Container Apps default hostname. Must equal the browser origin exactly (CORS).')
param appUrl string = ''

@description('Custom domains currently bound to web/api (from `az containerapp show`). Hostnames are bound once with the CLI — see docs/AZURE_OPPSETT.md — and every deploy passes the live bindings back so they are not wiped.')
param webCustomDomains array = []
param apiCustomDomains array = []

param postgresAdminLogin string = 'ayaadmin'

@secure()
param postgresAdminPassword string

@description('Worker only. Empty = the analysis runs without the LLM verdict.')
@secure()
param anthropicApiKey string = ''

@description('Basic-auth user/password for GET /api/metrics. Both empty = route disabled.')
param metricsUsername string = ''

@secure()
param metricsPassword string = ''

@description('Cloudflare Turnstile secret. Set together with NEXT_PUBLIC_TURNSTILE_SITE_KEY on the web build.')
@secure()
param turnstileSecretKey string = ''

@secure()
param sentryDsn string = ''

@description('Tag for Sentry events and logs.')
param sentryEnvironment string = 'production'

@description('Release id for Sentry (the deploy workflow passes the git SHA).')
param release string = ''

@description('Concurrent analyses per worker replica. Each runs its own Chromium page.')
param workerConcurrency int = 3

@description('Retention job schedule (UTC cron).')
param retentionCron string = '0 3 * * *'

var n = names(prefix, resourceGroup().id)

resource environment 'Microsoft.App/managedEnvironments@2025-01-01' existing = {
  name: n.environment
}

resource registry 'Microsoft.ContainerRegistry/registries@2023-07-01' existing = {
  name: n.registry
}

resource appsIdentity 'Microsoft.ManagedIdentity/userAssignedIdentities@2023-01-31' existing = {
  name: n.identity
}

resource postgres 'Microsoft.DBforPostgreSQL/flexibleServers@2024-08-01' existing = {
  name: n.postgres
}

resource redis 'Microsoft.Cache/redisEnterprise@2025-04-01' existing = {
  name: n.redis
}

resource redisDb 'Microsoft.Cache/redisEnterprise/databases@2025-04-01' existing = {
  parent: redis
  name: 'default'
}

var tags = {
  app: 'areyouagentic'
  managedBy: 'bicep'
}

var webOrigin = empty(appUrl) ? 'https://${n.web}.${environment.properties.defaultDomain}' : appUrl

var databaseUrl = 'postgresql://${postgresAdminLogin}:${uriComponent(postgresAdminPassword)}@${postgres.properties.fullyQualifiedDomainName}:5432/areyouagentic?sslmode=require&schema=public'
var redisUrl = 'rediss://:${uriComponent(redisDb.listKeys().primaryKey)}@${redis.properties.hostName}:10000'

var registries = [
  {
    server: registry.properties.loginServer
    identity: appsIdentity.id
  }
]

var identity = {
  type: 'UserAssigned'
  userAssignedIdentities: {
    '${appsIdentity.id}': {}
  }
}

// Secrets + env shared by everything that talks to the data tier.
var dataSecrets = [
  { name: 'database-url', value: databaseUrl }
  { name: 'redis-url', value: redisUrl }
]
var dataEnv = [
  { name: 'DATABASE_URL', secretRef: 'database-url' }
  { name: 'REDIS_URL', secretRef: 'redis-url' }
  { name: 'LOG_LEVEL', value: 'info' }
]

// Optional values become secrets/env only when set: Container Apps rejects
// empty secret values, and the apps' Zod env treats unset as "feature off".
var sentrySecrets = empty(sentryDsn) ? [] : [{ name: 'sentry-dsn', value: sentryDsn }]
var sentryEnv = concat(
  empty(sentryDsn) ? [] : [{ name: 'SENTRY_DSN', secretRef: 'sentry-dsn' }],
  [{ name: 'SENTRY_ENVIRONMENT', value: sentryEnvironment }],
  empty(release) ? [] : [{ name: 'SENTRY_RELEASE', value: release }]
)

var apiSecrets = concat(
  dataSecrets,
  sentrySecrets,
  empty(metricsPassword) ? [] : [{ name: 'metrics-password', value: metricsPassword }],
  empty(turnstileSecretKey) ? [] : [{ name: 'turnstile-secret-key', value: turnstileSecretKey }]
)
var apiEnv = concat(
  dataEnv,
  sentryEnv,
  [
    { name: 'APP_URL', value: webOrigin }
    { name: 'TRUST_PROXY', value: network.apps }
  ],
  empty(metricsUsername) || empty(metricsPassword)
    ? []
    : [
        { name: 'METRICS_USERNAME', value: metricsUsername }
        { name: 'METRICS_PASSWORD', secretRef: 'metrics-password' }
      ],
  empty(turnstileSecretKey) ? [] : [{ name: 'TURNSTILE_SECRET_KEY', secretRef: 'turnstile-secret-key' }]
)

var workerSecrets = concat(
  dataSecrets,
  sentrySecrets,
  empty(anthropicApiKey) ? [] : [{ name: 'anthropic-api-key', value: anthropicApiKey }]
)
var workerEnv = concat(
  dataEnv,
  sentryEnv,
  [{ name: 'WORKER_CONCURRENCY', value: string(workerConcurrency) }],
  empty(anthropicApiKey) ? [] : [{ name: 'ANTHROPIC_API_KEY', secretRef: 'anthropic-api-key' }]
)

// ── Migrate job ────────────────────────────────────────────────────────────
// Started by the deploy workflow (`az containerapp job start`), never on a
// schedule. Runs inside the VNet because Postgres has no public endpoint.
resource migrateJob 'Microsoft.App/jobs@2025-01-01' = {
  name: n.migrateJob
  location: location
  tags: tags
  identity: identity
  properties: {
    environmentId: environment.id
    workloadProfileName: 'Consumption'
    configuration: {
      triggerType: 'Manual'
      replicaTimeout: 600
      replicaRetryLimit: 0
      manualTriggerConfig: {
        parallelism: 1
        replicaCompletionCount: 1
      }
      registries: registries
      secrets: [dataSecrets[0]]
    }
    template: {
      containers: [
        {
          name: 'migrate'
          image: migrateImage
          env: [dataEnv[0]]
          resources: {
            cpu: json('0.5')
            memory: '1Gi'
          }
        }
      ]
    }
  }
}

// ── Web ────────────────────────────────────────────────────────────────────
resource web 'Microsoft.App/containerApps@2025-01-01' = if (!migrateOnly) {
  name: n.web
  location: location
  tags: tags
  identity: identity
  properties: {
    environmentId: environment.id
    workloadProfileName: 'Consumption'
    configuration: {
      activeRevisionsMode: 'Single'
      ingress: {
        external: true
        targetPort: 3000
        transport: 'auto'
        allowInsecure: false
        customDomains: webCustomDomains
      }
      registries: registries
      secrets: sentrySecrets
    }
    template: {
      containers: [
        {
          name: 'web'
          image: webImage
          env: sentryEnv
          resources: {
            cpu: json('0.5')
            memory: '1Gi'
          }
          probes: [
            {
              type: 'Liveness'
              tcpSocket: { port: 3000 }
            }
            {
              type: 'Readiness'
              httpGet: { path: '/', port: 3000 }
              initialDelaySeconds: 5
              periodSeconds: 10
            }
          ]
        }
      ]
      scale: {
        minReplicas: 1
        maxReplicas: 3
      }
    }
  }
}

// ── API ────────────────────────────────────────────────────────────────────
// Liveness is a TCP check on purpose: /health fans out to Postgres + Redis,
// and a data-tier blip must take replicas out of rotation (readiness), not
// restart-loop them (liveness).
resource api 'Microsoft.App/containerApps@2025-01-01' = if (!migrateOnly) {
  name: n.api
  location: location
  tags: tags
  identity: identity
  properties: {
    environmentId: environment.id
    workloadProfileName: 'Consumption'
    configuration: {
      activeRevisionsMode: 'Single'
      ingress: {
        external: true
        targetPort: 4000
        transport: 'auto'
        allowInsecure: false
        customDomains: apiCustomDomains
      }
      registries: registries
      secrets: apiSecrets
    }
    template: {
      containers: [
        {
          name: 'api'
          image: apiImage
          env: apiEnv
          resources: {
            cpu: json('0.5')
            memory: '1Gi'
          }
          probes: [
            {
              type: 'Liveness'
              tcpSocket: { port: 4000 }
            }
            {
              type: 'Readiness'
              httpGet: { path: '/health', port: 4000 }
              initialDelaySeconds: 5
              periodSeconds: 10
              timeoutSeconds: 5
            }
          ]
        }
      ]
      scale: {
        minReplicas: 1
        maxReplicas: 3
      }
    }
  }
}

// ── Worker ─────────────────────────────────────────────────────────────────
// No ingress: it only pulls jobs from Redis. Sized for Chromium — each of the
// WORKER_CONCURRENCY slots renders a full page. The health server on :4001
// is probed from inside the environment.
resource worker 'Microsoft.App/containerApps@2025-01-01' = if (!migrateOnly) {
  name: n.worker
  location: location
  tags: tags
  identity: identity
  properties: {
    environmentId: environment.id
    workloadProfileName: 'Consumption'
    configuration: {
      activeRevisionsMode: 'Single'
      registries: registries
      secrets: workerSecrets
    }
    template: {
      containers: [
        {
          name: 'worker'
          image: workerImage
          env: workerEnv
          resources: {
            cpu: json('2')
            memory: '4Gi'
          }
          probes: [
            {
              type: 'Liveness'
              tcpSocket: { port: 4001 }
            }
            {
              type: 'Readiness'
              httpGet: { path: '/ready', port: 4001 }
              initialDelaySeconds: 10
              periodSeconds: 15
              timeoutSeconds: 5
            }
          ]
        }
      ]
      scale: {
        minReplicas: 1
        maxReplicas: 1
      }
    }
  }
}

// ── Retention job ──────────────────────────────────────────────────────────
// Deletes analyses (and their screenshots) older than RETENTION_DAYS. Same
// image as the worker, different entrypoint.
resource retentionJob 'Microsoft.App/jobs@2025-01-01' = if (!migrateOnly) {
  name: n.retentionJob
  location: location
  tags: tags
  identity: identity
  properties: {
    environmentId: environment.id
    workloadProfileName: 'Consumption'
    configuration: {
      triggerType: 'Schedule'
      replicaTimeout: 1800
      replicaRetryLimit: 1
      scheduleTriggerConfig: {
        cronExpression: retentionCron
        parallelism: 1
        replicaCompletionCount: 1
      }
      registries: registries
      secrets: concat(dataSecrets, sentrySecrets)
    }
    template: {
      containers: [
        {
          name: 'retention'
          image: workerImage
          command: ['node', 'dist/retention.js']
          env: concat(dataEnv, sentryEnv)
          resources: {
            cpu: json('0.5')
            memory: '1Gi'
          }
        }
      ]
    }
  }
}

output webOrigin string = webOrigin
output apiOrigin string = 'https://${n.api}.${environment.properties.defaultDomain}'
