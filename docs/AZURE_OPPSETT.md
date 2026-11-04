# Oppsett på Azure

Engangsoppsett for å kjøre areyouagentic.com på Azure. Når dette er gjort,
skjer alle senere utrullinger med **Deploy**-workflowen i GitHub Actions
(se [`RUNBOOK.md`](RUNBOOK.md)). Hva som er sjekket av i drift, står i
[`DEPLOYMENT_CHECKLIST.md`](DEPLOYMENT_CHECKLIST.md).

Infrastrukturen er definert i [`infra/`](../infra):

- `main.bicep` – nettverk, logger, container registry, Postgres, Redis og
  Container Apps-miljøet.
- `apps.bicep` – web, api og worker, migrate-jobben og den daglige
  retention-jobben.
- `naming.bicep` – felles navneregler.

Alt havner i én resource group. Standardprefikset er `aya-prod`, så appene
heter `aya-prod-web`, `aya-prod-api` og `aya-prod-worker`.

## Hva du trenger

- Tilgang til Solidiumas sin Azure-tenant og en subscription der du er
  **Owner**. Du trenger dette for å gi GitHub Actions tilgang i steg 3.
- Admin-tilgang til `solidiumas/areyouagentic` i GitHub.
- Azure CLI lokalt: `brew install azure-cli`, deretter
  `az login --tenant <tenant-id>`.
- GitHub CLI (`gh`) innlogget med en konto som har admin-tilgang til repoet.

Alle kommandoene under bruker disse variablene. Sett dem først i terminalen:

```bash
SUBSCRIPTION_ID=<subscription-id>
TENANT_ID=<tenant-id>
RG=rg-areyouagentic-prod
LOCATION=norwayeast
REPO=solidiumas/areyouagentic
```

```bash
az account set --subscription "$SUBSCRIPTION_ID"
```

## 1. Resource group

```bash
az group create --name "$RG" --location "$LOCATION"
```

## 2. Registrer ressursleverandørene

Dette trengs bare én gang per subscription, og er ufarlig å kjøre på nytt:

```bash
for ns in Microsoft.App Microsoft.ContainerRegistry Microsoft.DBforPostgreSQL \
          Microsoft.Cache Microsoft.Network Microsoft.OperationalInsights \
          Microsoft.ManagedIdentity; do
  az provider register --namespace "$ns" --wait
done
```

## 3. Gi GitHub Actions tilgang (OIDC, uten lagrede passord)

Workflowen logger inn med en kortlevd token fra GitHub. Det finnes altså
ikke noe Azure-passord eller noen klientnøkkel som kan lekke.

```bash
APP_ID=$(az ad app create --display-name github-areyouagentic-deploy --query appId -o tsv)
az ad sp create --id "$APP_ID"
```

```bash
az ad app federated-credential create --id "$APP_ID" --parameters "{
  \"name\": \"github-production\",
  \"issuer\": \"https://token.actions.githubusercontent.com\",
  \"subject\": \"repo:$REPO:environment:production\",
  \"audiences\": [\"api://AzureADTokenExchange\"]
}"
```

Gi appen rettigheter, men bare på denne resource groupen:

```bash
RG_ID=$(az group show --name "$RG" --query id -o tsv)
az role assignment create --assignee "$APP_ID" --role Contributor --scope "$RG_ID"
az role assignment create --assignee "$APP_ID" --role "Role Based Access Control Administrator" --scope "$RG_ID"
```

Den siste rollen trengs fordi `main.bicep` gir appene lov til å hente
images fra registryet (`AcrPull`).

## 4. GitHub-miljøet `production`

Opprett miljøet: GitHub → repoet → **Settings → Environments → New
environment** → `production`. Under **Deployment branches and tags**,
begrens det til `main`.

Legg inn variablene. Ingen av dem er hemmelige:

```bash
gh variable set AZURE_CLIENT_ID       --env production --repo "$REPO" --body "$APP_ID"
gh variable set AZURE_TENANT_ID       --env production --repo "$REPO" --body "$TENANT_ID"
gh variable set AZURE_SUBSCRIPTION_ID --env production --repo "$REPO" --body "$SUBSCRIPTION_ID"
gh variable set AZURE_RESOURCE_GROUP  --env production --repo "$REPO" --body "$RG"
```

Legg inn hemmelighetene. Postgres-passordet genereres og sendes rett til
GitHub, så det vises aldri på skjermen:

```bash
openssl rand -base64 32 | gh secret set POSTGRES_ADMIN_PASSWORD --env production --repo "$REPO"
```

Anthropic-nøkkelen limer du inn når `gh` spør etter den. Den skal ikke
skrives i kommandolinjen:

```bash
gh secret set ANTHROPIC_API_KEY --env production --repo "$REPO"
```

Valgfritt. Uten disse er funksjonen bare skrudd av:

| Navn                             | Type     | Hva                                                   |
| -------------------------------- | -------- | ----------------------------------------------------- |
| `METRICS_USERNAME`               | variabel | Brukernavn for `/api/metrics`                         |
| `METRICS_PASSWORD`               | secret   | Passord for `/api/metrics`                            |
| `TURNSTILE_SECRET_KEY`           | secret   | Cloudflare Turnstile. Sett sammen med site key        |
| `NEXT_PUBLIC_TURNSTILE_SITE_KEY` | variabel | Turnstile site key. Sett sammen med secret            |
| `SENTRY_DSN`                     | secret   | Sentry for api og worker                              |
| `NEXT_PUBLIC_SENTRY_DSN`         | variabel | Sentry i nettleseren (DSN-en er offentlig)            |
| `AZURE_PREFIX`                   | variabel | Annet navneprefiks enn `aya-prod`, f.eks. for staging |
| `APP_PUBLIC_URL`                 | variabel | Settes i steg 7, når eget domene er på plass          |
| `API_PUBLIC_URL`                 | variabel | Settes i steg 7, når eget domene er på plass          |

## 5. Første utrulling

GitHub → **Actions → Deploy → Run workflow** (branch `main`).

Første gang tar det typisk 20–40 minutter, fordi Postgres og Redis
opprettes. Senere utrullinger tar noen få minutter. Workflowen:

1. oppretter infrastrukturen (`main.bicep`),
2. bygger og pusher de fire imagene til registryet,
3. kjører migrasjonene mot den tomme databasen og venter på dem,
4. starter web, api, worker og retention-jobben (`apps.bicep`),
5. sjekker at `/health` og forsiden svarer.

Adressene står i loggen fra siste steg. De ser slik ut:

- web: `https://aya-prod-web.<noe>.norwayeast.azurecontainerapps.io`
- api: `https://aya-prod-api.<noe>.norwayeast.azurecontainerapps.io`

## 6. Sjekk at alt virker

Gå gjennom punkt 4 og 5 i `DEPLOYMENT_CHECKLIST.md`. Det viktigste:

- `curl <api>/health` gir `"database":"ok","redis":"ok"`.
- Forsiden lar deg analysere `https://example.com`, og rapporten vises.
- Den sjette analysen innen ett minutt gir 429.
- API-loggen viser din egen IP-adresse, ikke en intern `10.40.x.x`-adresse.
  Det bekrefter at `TRUST_PROXY` stemmer med Azure sin ingress. Viser loggen
  en intern adresse, deler alle brukere samme rate-limit, og det må rettes
  før lansering.

## 7. Eget domene

Container Apps lager og fornyer TLS-sertifikatene selv. Hent først
verdiene du trenger til DNS-oppføringene:

```bash
az containerapp env show -g "$RG" -n aya-prod-env \
  --query '{ip: properties.staticIp, verification: properties.customDomainConfiguration.customDomainVerificationId, domain: properties.defaultDomain}'
```

Legg inn hos DNS-leverandøren:

| Navn        | Type  | Verdi                    |
| ----------- | ----- | ------------------------ |
| `@` (apex)  | A     | `ip` fra kommandoen over |
| `asuid`     | TXT   | `verification`           |
| `api`       | CNAME | `aya-prod-api.<domain>`  |
| `asuid.api` | TXT   | `verification`           |

Når DNS har slått igjennom, koble domenene til appene. Dette gjøres én
gang; senere utrullinger tar vare på bindingene:

```bash
az containerapp hostname add  -g "$RG" -n aya-prod-web --hostname areyouagentic.com
az containerapp hostname bind -g "$RG" -n aya-prod-web --hostname areyouagentic.com \
  --environment aya-prod-env --validation-method HTTP
```

```bash
az containerapp hostname add  -g "$RG" -n aya-prod-api --hostname api.areyouagentic.com
az containerapp hostname bind -g "$RG" -n aya-prod-api --hostname api.areyouagentic.com \
  --environment aya-prod-env --validation-method CNAME
```

Pek appen mot de nye adressene, og kjør **Deploy** på nytt. Det bygger
web-imaget med de nye URL-ene og oppdaterer CORS i API-et:

```bash
gh variable set APP_PUBLIC_URL --env production --repo "$REPO" --body https://areyouagentic.com
gh variable set API_PUBLIC_URL --env production --repo "$REPO" --body https://api.areyouagentic.com
```

Vil du også ha `www.areyouagentic.com`, legger du det til på samme måte som
`api`, med CNAME til `aya-prod-web.<domain>`.

## 8. Rydd opp etter Railway og Vercel

- GitHub → repoet → **Settings → GitHub Apps / Integrations**: avinstaller
  Vercel og Railway. Det fjerner Vercel-sjekken på PR-er.
- Slett Vercel-prosjektet `nrth-ai-s-projects/areyouagentic`, og det som
  måtte være igjen i Railway.

## Kostnader

De faste postene er:

- Worker-en, som alltid har én instans med 2 vCPU og 4 GiB.
- Postgres (Burstable B1ms).
- Azure Managed Redis (Balanced B0).
- Web og API, som har én instans hver.

Registryet (Basic) og Log Analytics koster lite ved dagens volum. Sett opp
et budsjettvarsel: **Cost Management → Budgets** på resource groupen.

Vil du spare mer, er det enkleste å la worker-en skalere til null når køen
er tom. Det krever en KEDA-regel på Redis-køen, og er ikke satt opp ennå.
