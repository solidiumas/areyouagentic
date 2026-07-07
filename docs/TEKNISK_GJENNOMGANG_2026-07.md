# Teknisk gjennomgang — areyouagentic.com (juli 2026)

**Dato:** 2026-07-07
**Omfang:** Full gjennomgang av monorepoet (`apps/api`, `apps/web`, `apps/worker`, `packages/*`, CI/CD, Docker, dokumentasjon) med tanke på (1) profesjonalitet i struktur, (2) risiko for oss og forbrukere av løsningen, og (3) beredskap for Stripe-betaling.
**Kontekst:** Beta i produksjon — API + worker på Railway, web på Vercel, kode på GitHub.

---

## 1. Overordnet konklusjon

**Kodebasen er strukturert godt over gjennomsnittet for en beta.** Fundamentet er profesjonelt: pnpm/Turborepo-monorepo med streng TypeScript (`strict` + `noUncheckedIndexedAccess`), Zod-validert env som feiler ved oppstart, delt typet API-klient, sentralisert feilhåndtering med stabil feilkonvolutt, konstant-tid-sammenligning av tokens, PII-vasking i logger og Sentry, gjennomtenkt SSRF-beskyttelse med god testdekning, og prompt-injection-herding der LLM-en ikke kan påvirke karakteren. Sikkerhetsfunnene fra SIKKERHETSANALYSE (juni 2026) er i all hovedsak lukket (P0 SSRF, feil-orakel, gjettbare rapport-ID-er, selvbetjent sletting m.m.).

**Men det finnes reelle hull som kan skade oss eller brukerne**, konsentrert i tre sømmer:

1. **Database-livssyklusen er ødelagt:** det finnes ingen Prisma-migrasjoner i det hele tatt. Dokumentasjonen beskriver en `migrate deploy`-flyt som ville gjort ingenting, og runtime-imagene mangler uansett Prisma-CLI. Neste skjemaendring (som Stripe krever!) har i dag ingen trygg vei til produksjon.
2. **Retry/persistens/retention-sømmen i workeren:** ikke-idempotent lagring som kan flippe fullførte jobber til FAILED, retries som re-kjører dyr render + LLM, og R2-screenshots som aldri slettes (kostnad + personvernhull når R2 aktiveres).
3. **Feilhåndtering mot sluttbruker:** ingen error boundaries i web-appen (API nede = rå crash-side), ubegrenset polling, og server-side Sentry som sannsynligvis aldri initialiseres.

I tillegg: `trustProxy: true` gjør alle per-IP-kontroller (rate limits, Turnstile) omgåelige via spoofet `X-Forwarded-For` hvis Railway-topologien ikke er strengt bak én betrodd proxy.

**For Stripe:** det finnes ikke noe bruker-/konto-konsept noe sted — produktet er helt anonymt. Betaling er derfor netto nybygg (datamodell, auth, webhook-endepunkt, gating), men den rene arkitekturen gjør det til et veldefinert prosjekt, ikke en refaktorering. To konkrete tekniske blokkere i API-et må løses: global `bodyLimit` på 10 KB og manglende raw-body-håndtering for webhook-signaturverifisering.

---

## 2. Funn — prioritert

Severity: 🔴 Høy (kan skade drift/brukere/økonomi nå) · 🟠 Medium (reell risiko, bør planlegges) · 🟡 Lav (hygiene)

### 🔴 Høy

| #   | Funn                                                                                                                                                                                                                                                                                                                                                          | Hvor                                                                              | Konsekvens                                                                                                                                                                               | Tiltak                                                                                                                                                             |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| H1  | **Ingen Prisma-migrasjoner finnes.** Skjema er lagt på med `db push`; `packages/db/prisma/` har ingen `migrations/`. RUNBOOK, `docker-compose.prod.yml` og `packages/db/README.md` beskriver `migrate deploy` — som ville anvendt null migrasjoner. Prisma-CLI er devDependency og finnes ikke i deploy-imagene. Ingen automatisk migrering i Railway-flyten. | `packages/db/prisma/`, `docs/RUNBOOK.md:57-66`                                    | Neste skjemaendring driver stille fra prod-DB; ingen rollback-historikk; Stripe-datamodellen kan ikke rulles trygt ut.                                                                   | Baseline: generer og commit init-migrasjon, innfør release-steg som kjører `migrate deploy` (egen migrate-container/pre-deploy-kommando i Railway), rett opp docs. |
| H2  | **`persist` er ikke idempotent.** `prisma.report.create` mot unik `jobId` + `attempts: 3` hos produsent → retry etter krasj mellom persist og ack kaster P2002 og markerer en reelt fullført jobb som FAILED. Retries re-kjører dessuten hele fetch + Playwright-render + betalt LLM-kall.                                                                    | `apps/worker/src/pipeline/stages/persist.ts:100`, `runAnalysis.ts:54-86`          | Inkonsistent terminaltilstand mot bruker + unødig LLM-/compute-kostnad ved hver transient feil.                                                                                          | `upsert` på `jobId` + terminal-status-guard øverst i `runAnalysis`.                                                                                                |
| H3  | **R2-screenshots slettes aldri.** Verken retention-cron eller brukersletting (`DELETE /api/reports/:id`) sletter R2-objektet — ingen `DeleteObjectCommand` finnes i kodebasen. Screenshot-nøkkel bruker dessuten semi-gjettbar v1-cuid (`screenshots/{jobId}.png`).                                                                                           | `apps/worker/src/retention.ts`, `apps/api/src/routes/reports.ts`, `persist.ts:47` | Ubegrenset lagringskostnad + personvernhull: bruker "sletter" rapporten, men fullside-screenshot består offentlig. (Dormant i beta siden R2 er utsatt — **må** lukkes før R2 aktiveres.) | R2-delete på begge slettestier; nøkle screenshots på ugjettbar rapport-ID.                                                                                         |
| H4  | **`trustProxy: true` gjør klient-IP spoofbar.** Hele `X-Forwarded-For`-kjeden stoles på; en klient kan rotere tilsynelatende IP og omgå 5/min-, 20/dag- og globale limits, og spoofe `remoteip` til Turnstile.                                                                                                                                                | `apps/api/src/server.ts:24`, `lib/rateLimiter.ts:34`                              | Alle misbrukskontroller kan omgås → LLM-/compute-kostnad og DoS-eksponering.                                                                                                             | Sett `trustProxy: 1` (eller Railway-proxyens CIDR) tilpasset faktisk topologi.                                                                                     |
| H5  | **Ingen error boundary i web-appen.** `report/[id]/page.tsx:85` re-kaster alle ikke-404-feil; ingen `error.tsx`/`global-error.tsx` finnes.                                                                                                                                                                                                                    | `apps/web/src/app/`                                                               | Bruker får Nexts rå "Application error"-side når API-et er nede/tregt — dårligste mulige inntrykk i beta.                                                                                | Legg til `error.tsx` + `global-error.tsx` med request-ID for support, pluss `loading.tsx` på rapportruten.                                                         |

### 🟠 Medium

| #   | Funn                                                                                                                                                                                                                                                                                                           | Hvor                                                             | Tiltak                                                                                                                                                     |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| M1  | Dedup har TOCTOU-race (check-then-create uten unik constraint) **og** 60s in-flight-vindu kortere enn analysetid → trege analyser dedupliseres aldri, duplikatjobber spawnes.                                                                                                                                  | `apps/api/src/routes/analyze.ts:34,106-157`                      | Match PENDING/RUNNING uavhengig av `createdAt`; partiell unik indeks på `normalizedUrl` for aktive statuser.                                               |
| M2  | Ingen timeouts på Redis/Postgres-kall: med `maxRetriesPerRequest: null` kan enqueue og `/health` **henge** i stedet for å fast-faile 503.                                                                                                                                                                      | `apps/api/src/lib/queue.ts:29-33`, `routes/health.ts`            | `Promise.race` med få sekunders timeout, evt. egen kortlevd ioredis-tilkobling for health/enqueue.                                                         |
| M3  | Jobb-timeout avbryter ingenting: `Promise.race` rejecter, men ingen `AbortSignal` trådes inn i stages — Chromium og LLM-kallet fortsetter å jobbe. LLM-kallet har heller ingen SDK-timeout (~10 min default).                                                                                                  | `apps/worker/src/worker.ts:48-56`, `lib/llm.ts:109-125`          | Deadline-basert `AbortController` gjennom `AnalysisContext`; `{ timeout, maxRetries: 1 }` på Anthropic-kallet.                                             |
| M4  | JSONB skrives uten Zod-validering i produksjonsstien — bryter skjemaets egen kontrakt («validate on write»); feil data eksploderer først ved lesing hos konsument.                                                                                                                                             | `persist.ts:111-113`                                             | `findingsSchema.parse(...)` m.fl. før write.                                                                                                               |
| M5  | Server/edge-Sentry initialiseres sannsynligvis aldri — `instrumentation.ts` mangler (påkrevd for @sentry/nextjs v8 på Next 15). Feilene fra H5 er dermed uovervåket.                                                                                                                                           | `apps/web/`                                                      | Legg til `src/instrumentation.ts` med `register()`; verifiser med bevisst testfeil.                                                                        |
| M6  | Ubegrenset polling i frontend: fast 1,5s-intervall for alltid ved hengende jobb; ingen backoff, cap eller pause ved skjult fane.                                                                                                                                                                               | `apps/web/src/components/analyzing-checklist.tsx:104`            | Cap + eksponentiell backoff etter stall-terskel + `visibilitychange`-pause.                                                                                |
| M7  | `turbo.json` `globalEnv` mangler alle variabler koden faktisk leser (spesielt `NEXT_PUBLIC_API_URL` som bakes inn i web-bundelen) → cache-treff kan shippe web-build som peker på feil API. Lister samtidig døde `SESSION_SECRET`/`JWT_SECRET` som ingen kode leser.                                           | `turbo.json:5-19`                                                | Legg inn alle build-påvirkende vars; fjern/koble de døde.                                                                                                  |
| M8  | E2E (Playwright, `apps/web/e2e/`) kjøres aldri i CI; rate-limit-testen er `skipIf(CI)`; ingen migrasjons-/driftsjekk i CI.                                                                                                                                                                                     | `.github/workflows/ci.yml`                                       | Kjør e2e mot bygget server i CI; legg til `prisma migrate diff`-gate (etter H1).                                                                           |
| M9  | RUNBOOK beskriver GHCR/Fly-deploy og tag-rollback som **ikke brukes** — reell flyt er Railway/Vercel git-push. Operatør som følger RUNBOOK i en hendelse gjør feil ting.                                                                                                                                       | `docs/RUNBOOK.md:26-67`                                          | Skriv om deploy/rollback til Railway/Vercel-virkeligheten.                                                                                                 |
| M10 | DNS-rebinding TOCTOU i både fetch- og render-sti er dokumentert og bevisst, men den forutsatte nettverks-egress-brannmuren er **uverifisert på Railway** (ingen sjekkliste-punkt). `normalizedUrl` lagrer dessuten sensitive query-verdier i klartekst (dedup-nøkkel), stikk i strid med maskeringen av `url`. | `apps/worker/src/lib/safeFetch.ts:170-186`, `analyze.ts:143-147` | Verifiser/konfigurer egress-blokkering (metadata/RFC1918) på Railway og før det inn i DEPLOYMENT_CHECKLIST; hash dedup-nøkkelen (`sha256(normalizedUrl)`). |
| M11 | Cookie-banner-detektoren matcher nesten alle elementer og går O(n²) på DOM opptil 10 MB — reell CPU-kostnad per jobb. Fullside-screenshot er ubegrenset (minne + R2-kost).                                                                                                                                     | `packages/analyzers/src/performance.ts:28`, `render.ts:74`       | Snevre selektor til plausible modal-røtter; klipp/cap screenshot.                                                                                          |
| M12 | Misbruksherding delvis: Turnstile er av som standard, per-domene rate limit (fra sikkerhetsanalysen P2.11) er ikke implementert, `/api/metrics` har basic-auth uten rate limit.                                                                                                                                | `apps/api/src/lib/env.ts`, `routes/metrics.ts:52`                | Slå på Turnstile i prod; vurder per-domene-limit; moderat rate limit på metrics.                                                                           |

### 🟡 Lav (hygiene — tas løpende)

- Fastify-interne feilkoder (`FST_ERR_*`) lekker som klient-facing `code` (`errorHandler.ts:111`).
- Turnstile-siteverify validerer ikke `hostname`/`action`.
- Signal-handlere registreres etter `app.listen`; foreldreløs PENDING-rad ved krasj mellom create og enqueue (trenger reaper).
- `AnalysisJob.id` er fortsatt v1-cuid (kun `Report.id` ble oppgradert til cuid2).
- `RETENTION_DAYS` leses rått fra `process.env` utenom Zod-env; udokumentert i `.env.example`.
- Retention sletter på alder uansett status (kan i teorien slette RUNNING-jobb).
- Turnstile-token nullstilles ikke ved resubmit; tidsstempel i rapport bruker serverens tidssone; ingen `loading.tsx` på rapportruten.
- Duplisert `jaccardWords` med ulik tom-mengde-semantikk; død kode i `contentClarity.ts:62` og `structuredData.ts:248-250`; død konstant `TIMEOUTS.job`.
- Ny `chromium.launch()` per jobb (ingen browser-pool) — kald-start-kostnad.
- `pageSize` måles kun via `content-length` (ofte fraværende) → undertelling og kunstig god performance-score.
- Ingen tester for `/api/metrics`, enqueue-feil→503, `turnstileGuard`-branchene eller `/health` degradert.
- `vercel.json` er hardkoblet til Root Directory `apps/web` (udokumentert) og kjører unødvendig `prisma generate` for web.
- Flytende Node-minor (`>=20`); misvisende cache-kommentar i `ci.yml`.

---

## 3. Tiltaksplan

### Fase 0 — Stabilisering (før noe annet, ~3–5 dagsverk)

> **Status 2026-07-07: gjennomført i kode.** Init-migrasjon committed og
> verifisert mot ren database; Migrate-workflow lagt til; persist gjort
> idempotent med terminal-guard; `trustProxy: 1`; error boundaries +
> `instrumentation.ts` i web; timeouts på enqueue/health/LLM; R2-sletting i
> retention + delete-rute med ugjettbare screenshot-nøkler. To manuelle steg
> gjenstår (se DEPLOYMENT_CHECKLIST §3): GitHub-secret `PROD_DATABASE_URL` og
> engangs `prisma migrate resolve --applied 0_init` mot beta-databasen.
> Full AbortSignal-gjennomtråding i pipeline er bevisst utsatt til fase 1.

Dette er forutsetninger for Stripe (H1) og de tingene som kan skade brukere/økonomi i dag.

1. **H1 — Migrasjonsbaseline.** `prisma migrate diff` → init-migrasjon committes, prod baselines med `migrate resolve`. Legg `prisma` tilgjengelig i et migrate-steg (Railway pre-deploy-kommando eller egen one-off-tjeneste). Oppdater RUNBOOK/db-README til å matche.
2. **H2 — Idempotent persist.** `upsert` + terminal-status-guard. Liten endring, stor effekt (korrekthet + kostnad).
3. **H4 — `trustProxy: 1`.** Én linje + verifisering mot Railway-topologi.
4. **H5 — Error boundaries** (`error.tsx`, `global-error.tsx`, `loading.tsx`) + **M5 `instrumentation.ts`** slik at feilene også overvåkes.
5. **M2/M3 — Timeouts:** race med timeout på health/enqueue; SDK-timeout på Anthropic-kallet (AbortController-gjennomtråding kan vente til fase 1).
6. **H3 (del 1) — R2-sletting** kodes inn i retention + delete-ruten nå (dormant, men da er hullet lukket før R2 skrus på); bytt screenshot-nøkkel til rapport-ID.

### Fase 1 — Herding og drift (~1–2 uker, kan delvis parallelt med fase 2)

7. M1 dedup-fix (aktiv-status-match + partiell unik indeks — krever migrasjon fra fase 0).
8. M3 full AbortSignal-gjennomtråding i pipeline.
9. M4 Zod-validering på JSONB-write.
10. M6 polling-cap/backoff/visibility i frontend.
11. M7 turbo.json env-opprydding (fjern døde `SESSION_SECRET`/`JWT_SECRET` eller ta dem i bruk i fase 2-auth).
12. M8 CI: e2e-kjøring, migrasjonsgate, rate-limit-test i CI.
13. M9 RUNBOOK-omskriving til Railway/Vercel.
14. M10 verifiser egress-brannmur på Railway + hash dedup-nøkkel.
15. M11 analyzer-ytelse (selektor + screenshot-cap). M12 slå på Turnstile i prod.
16. Lav-funn tas som løpende småfikser / "good first issues".

### Fase 2 — Stripe (se del 4, ~2–3 uker)

---

## 4. Stripe-implementeringsplan

### 4.1 Nåsituasjon og hovedbeslutning

Det finnes **ingen** auth-, bruker- eller kontokonsept i noen del av stacken. DB har kun `AnalysisJob` og `Report`; eneste eierskapsprimitiv er engangs-delete-token. `SESSION_SECRET`/`JWT_SECRET` er provisjonert i env men leses ikke av kode.

**Forretningsbeslutning — AVGJORT 2026-07-07:** Det blir **alternativ B — engangskjøp uten konto/innlogging**. Begrunnelse: kjøperne kjøper sjelden mange rapporter; håpet er gjenkjøp av ny rapport etter at de har fikset siden sin. Ingen innlogging kreves, men alle kjøp skal **logges og lagres**.

- ~~Alternativ A — Konto + abonnement~~ (ikke valgt; kan bygges senere oppå B hvis behovet oppstår)
- **Alternativ B — Engangskjøp uten konto (valgt):** betal per analyse/premium-rapport; Checkout Session knyttet til jobb-ID, entitlement som capability-token (samme mønster som delete-token). Kjøp persisteres i en `Purchase`-tabell (Stripe customer-e-post, beløp, session-/payment-intent-ID, hvilken rapport) — det dekker regnskap, support og gjenkjøpsanalyse uten kontoer.

**Stripe Checkout (hosted redirect) brukes, ikke Elements** — da forblir PCI-omfanget minimalt og CSP-en («ingen tredjeparts-script») kan stå urørt; kun redirect til `checkout.stripe.com` kreves. E-postadressen samles inn av Stripe Checkout selv (`customer_email`/receipt), så vi trenger ingen egen e-postutsendelse.

### 4.2 Teknisk plan

**Steg 0 — Forutsetninger (fase 0 må være ferdig):** migrasjonsflyt (H1) er en hard blokker; H2/H4 bør også være inne før man tar betalt for tjenesten.

**Steg 1 — Datamodell** (`packages/db`, via ny migrasjon — ingen brukertabell nødvendig):

```
Purchase(id cuid2, jobId FK→AnalysisJob (SetNull ved sletting av jobb),
         stripeCheckoutSessionId unique, stripePaymentIntentId unique,
         customerEmail,            // fra Stripe Checkout — vår kjøpslogg
         amountTotal, currency, status (pending|paid|refunded),
         accessTokenHash,          // capability-token som låser opp betalt innhold
         createdAt, paidAt)
StripeEvent(id = event.id PK, type, processedAt)   // webhook-idempotens
```

Kjøpsloggen lever i `Purchase` (regnskaps-/supportkrav) og skal **ikke** slettes av retention-cronen selv om analysejobben slettes — derav `SetNull`, ikke `Cascade`.

**Steg 2 — Entitlement uten innlogging (capability-token, samme mønster som delete-token):**

- Ved fullført betaling genereres et engangs-/access-token; kun hashen lagres (`accessTokenHash`), plaintext vises/lagres hos kjøperen (sessionStorage + i Stripe-kvitteringens redirect-URL).
- Betalt innhold låses opp med `x-access-token`-header (konstant-tid-verifisering finnes allerede i `deleteToken.ts`-mønsteret). Ingen CORS-/cookie-endringer nødvendig — `credentials: false` består.

**Steg 3 — Webhook-endepunkt (API på Railway — riktig hosting, allerede offentlig HTTPS):**

- `POST /api/webhooks/stripe` med **route-scopet raw-body-parser** (`parseAs: 'buffer'` / `fastify-raw-body`) — ikke rør den globale JSON-parseren.
- **Hev `bodyLimit` per-route** (global 10 KB er for lite for Stripe-events).
- **Unnta ruten fra rate limiting** (Stripe-retries må ikke 429-es) og Turnstile/CORS-origin-krav.
- Verifiser signatur (`constructEvent`) **før** noe annet; 400 ved feil uten intern lekkasje.
- **Idempotens:** insert `event.id` i `StripeEvent` med unik constraint; no-op ved duplikat. Svar 2xx raskt; tyngre arbeid async via eksisterende BullMQ-kø.
- Håndter minst: `checkout.session.completed` (→ marker Purchase `paid`, sett `paidAt`), `checkout.session.expired`, `charge.refunded` (→ `refunded`, trekk tilbake entitlement).

**Steg 4 — Gating (API):**

- Gratisnivå som i dag; betalt innhold (f.eks. full rapport/premium-funn) gates med `x-access-token`-oppslag mot `Purchase` i rapport-/analyze-rutene. Naturlig innsettingspunkt ved siden av eksisterende `dailyLimiter`/`turnstileGuard`.

**Steg 5 — Billing-ruter (API):**

- `POST /api/billing/checkout-session` (oppretter Checkout Session med `client_reference_id = jobId`, `success_url` med `{CHECKOUT_SESSION_ID}`), `GET /api/billing/session/:id/claim` (etter redirect: verifiser betalt session → utsted access-token én gang). Ingen Customer Portal nødvendig for engangskjøp.

**Steg 6 — Web:**

- `/pricing` (statisk server-component, gjenbruk `Card`/`Badge`/`Button`), kjøpsknapp på rapportsiden → checkout-redirect, `/billing/success` (claimer token, lagrer i sessionStorage à la delete-token) + `/billing/cancelled`.
- CSP: **ingen endring** nødvendig med hosted Checkout. (Velges Elements senere: `js.stripe.com` i `script-src`, `api.stripe.com` i `connect-src`, `frame-src` for Stripe — alt samlet i `buildCsp()` i `next.config.ts`.)

**Steg 7 — Konfig og drift:**

- `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, price-ID-er inn i Zod-env (`apps/api/src/lib/env.ts`), `.env.example` og Railway-vars. Stripe-secrets hører hjemme på **API-et**, ikke worker (matcher eksisterende secret-isolasjon der Anthropic-nøkkelen er worker-only).
- Test mode + Stripe CLI (`stripe listen`) lokalt; egen webhook-secret per miljø.
- Overvåkning: webhook-feilrate inn i `/api/metrics`; Stripe-dashboard-alerts for failed payments.

**Steg 8 — Test:**

- Enhetstester: signaturverifisering (gyldig/ugyldig/replay), idempotens (duplikat event.id), entitlement-gating.
- Integrasjon: full checkout→webhook→entitlement-flyt i test mode; e2e for pricing→checkout-redirect.

### 4.3 Estimat (alternativ B — valgt)

| Arbeid                                                     | Estimat         |
| ---------------------------------------------------------- | --------------- |
| Steg 1 datamodell (`Purchase` + `StripeEvent`) + migrasjon | 1 dag           |
| Steg 2 access-token-entitlement                            | 1 dag           |
| Steg 3 webhook-endepunkt (raw body, bodyLimit, idempotens) | 2–3 dager       |
| Steg 4–5 gating + billing-ruter                            | 1–2 dager       |
| Steg 6 web (pricing/kjøpsknapp/success/cancelled)          | 2 dager         |
| Steg 7–8 konfig, test, prodsetting                         | 1–2 dager       |
| **Totalt**                                                 | **~1–1,5 uker** |

---

## 5. Hva som allerede er bra (og bør bevares)

- SSRF-forsvaret (obfuskert IPv4, IPv6-mapped, metadata-IP, redirect-revalidering, subresource-gating i render) er grundig og godt testet — det vanligste dødspunktet for «hent vilkårlig URL»-tjenester er håndtert.
- LLM-integrasjonen er kostnadskontrollert (Haiku, 400 tokens, prompt-caching) og injection-herdet (deterministiske scores er autoritative).
- Analyzer-pakken er den mest modne delen: deterministisk, vekter som beviselig normaliserer, fixture-drevne tester.
- Web-appen er XSS-trygg i rapportrendering, har ekte CSP, god a11y/SEO, og ingen hemmeligheter i `NEXT_PUBLIC_*`.
- `.env` er aldri committet (verifisert mot git-historikk); Dockerfiler er multi-stage, non-root, med healthchecks.
- DEPLOYMENT_CHECKLIST er ærlig om hva som faktisk er gjort — behold den disiplinen.

---

_Rapporten er basert på fire parallelle dybdegjennomganger (API, web, worker/analyzers/db, infra/CI/docs) av kodebasen slik den står på `main` (9461dbf)._
