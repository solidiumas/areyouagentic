# Sikkerhetsanalyse — areyouagentic

**Dato:** 2026-06-11
**Omfang:** Kodebasegjennomgang av monorepoet + hvordan det henger sammen med Vercel og Railway, vurdert opp mot den vedlagte passive sikkerhetsgjennomgangen av `areyouagentic.vercel.app`.
**Metode:** Statisk kodelesing av `apps/{web,api,worker}` og `packages/{shared,db,analyzers,config}`, deploy-konfigurasjon (`vercel.json`, Dockerfiles, `docker-compose.prod.yml`), `SECURITY.md` og personvern-/vilkårssider.

## Kort konklusjon

Kodebasen er **vesentlig mer moden enn den passive gjennomgangen antok**. Det finnes allerede en solid SSRF-validator, DNS-gate, rate limiting, streng CSP, sikkerhetsheadere og hemmelighets-isolering. Men kodelesingen avdekket **én konkret, kritisk SSRF-sårbarhet** som den passive gjennomgangen ikke kunne se, og som `SECURITY.md` feilaktig hevder er beskyttet:

> **Render-steget (Playwright) navigerer direkte til bruker-URL-en uten noen av SSRF-vernene.** All beskyttelse ligger i `safeFetch` — men `render`-steget bruker ikke `safeFetch`. Det starter en full headless Chromium mot URL-en, gjør sin egen DNS-oppslag, følger redirects automatisk og kjører JavaScript fra målsiden.

---

## Del 1 — Vurdering av den vedlagte gjennomgangen

Den passive rapporten treffer riktige temaer, men siden den ikke så koden bommer den på alvorlighetsgrad flere steder. Noen funn er allerede løst i koden, ett er **verre** enn antatt.

| Funn i rapporten                     | Faktisk status i koden                                                                                                                                                                                                                       |
| ------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 3.1 SSRF (kritisk)                   | **Delvis løst, delvis reelt og verre.** `validateAnalyzableUrl` (`packages/shared/src/schemas/url.ts`) + `safeFetch` (`apps/worker/src/lib/safeFetch.ts`) er førsteklasses for _fetch_-stien. Men **render-steget bypasser alt** (se Del 3). |
| 3.2 Offentlige rapporter via ID      | **Korrekt.** `GET /api/reports/:id` har ingen auth, ID-en er `cuid()` (v1 — tidsstempel + teller, svakt gjettbar), `Cache-Control: public`. Full URL med query-string lagres og vises rått.                                                  |
| 3.3 Ødelagte GitHub-/SECURITY-lenker | **Korrekt.** `siteConfig.links.github = https://github.com/areyouagentic` (en org, ikke et repo). Privacy-siden lenker til `github.com/areyouagentic/blob/main/SECURITY.md` — **garantert 404** (mangler repo-navn).                         |
| 3.4 Misbruk uten innlogging          | **Delvis løst.** Rate limiting finnes (`apps/api/src/lib/rateLimiter.ts`): globalt 30/min, analyze 5/min + 20/dag per IP. Kun per-IP; ingen CAPTCHA eller per-domene-grense.                                                                 |
| 3.5 Innhold til Anthropic            | **Mindre ille enn antatt.** Kun et _strukturert sammendrag_ (score, funn-titler, sidetittel, URL, booleans) sendes — **ikke** rå sidetekst (`apps/worker/src/lib/llm.ts`). Privacy-siden overdriver ("short summary of the page text").      |
| 3.6 Stored XSS                       | **I praksis løst.** Rapporten rendres med React/JSX (auto-escaping), ingen `dangerouslySetInnerHTML` for rapportinnhold. De tre `dangerouslySetInnerHTML` er statisk JSON-LD uten brukerinput. Streng CSP finnes i `next.config.ts`.         |
| 3.7 Prompt injection                 | **Reelt, men lav effekt by design.** LLM-en får aldri rå sidetekst, og deterministiske analyzere bestemmer scoren — LLM-en skriver bare verdikt/quick-wins. Eneste angreps-flate er sidetittel/URL i prompten.                               |
| 3.8 "Not indexed" ≠ privat           | **Korrekt.** Privacy-siden sier nettopp dette; ingen advarsel før analyse.                                                                                                                                                                   |
| 3.9 Ingen selvbetjent sletting       | **Korrekt.** Ingen DELETE-rute; kun 90-dagers cron (`apps/worker/src/retention.ts`) eller "kontakt oss via GitHub" (ødelagt lenke).                                                                                                          |
| 3.10 UX/troverdighet                 | De ødelagte lenkene er det reelle her.                                                                                                                                                                                                       |

### Funn gjennomgangen ikke hadde (fra kodelesing)

- **A. Render-steg-SSRF (kritisk)** — hovedfunnet, se Del 3.
- **B. SSRF-orakel via feilmelding.** `safeFetch` returnerer f.eks. _"Hostname X resolves to 10.0.0.5, which is in a blocked range"_. Dette lagres som `errorMessage` og vises i UI-et (`apps/web/src/components/analyzing-checklist.tsx`) via `GET /api/jobs/:id`. En bruker kan dermed kartlegge intern DNS/IP.
- **C. Skjermbilde i offentlig R2.** Render lagrer fullside-screenshot i R2 med offentlig URL. Kombinert med funn A = intern-innhold kan eksfiltreres til en offentlig bøtte.
- **D. Doc/virkelighet-gap.** `SECURITY.md` og privacy-siden beskriver vern/databehandling som ikke stemmer med koden — i seg selv en tillits- og compliance-risiko.

### Det som allerede er bra (ikke bruk tid her)

`validateAnalyzableUrl` (IPv4-obfuskering, IPv6, IPv4-mapped, CGNAT, metadata-IP), `safeFetch` (DNS-gate, redirect-revalidering per hopp, størrelse-/timeout-tak), rate limiting, CSP/HSTS/sikkerhetsheadere på web, helmet på API, Zod-validering av env, pino-redaksjon av hemmeligheter, isolering av Anthropic-nøkkel til worker, JSX-escaping i rapportvisning, retention-cron.

---

## Del 2 — Arkitektur og hvordan repoet henger sammen med Vercel og Railway

Monorepo (pnpm workspaces + Turborepo): `apps/web` (Next.js), `apps/api` (Fastify), `apps/worker` (BullMQ + Playwright) og delte `packages/{analyzers,db,shared,config}`.

```
Nettleser ──POST /api/analyze──▶ VERCEL: apps/web (Next.js SSR + CSP/HSTS-headere)
                                   │  kaller API via NEXT_PUBLIC_API_URL
                                   ▼
                          RAILWAY: apps/api  (Fastify :4000)
                            • validateAnalyzableUrl   ← SSRF-gate #1 (kun ved innsending, kun literal-IP)
                            • rate-limit (Redis/Upstash)
                            • lagre AnalysisJob(PENDING) → Postgres (Neon)
                            • enqueue → Redis/BullMQ
                                   │
                                   ▼
                          RAILWAY: apps/worker  (Playwright-image, ~1.6 GB)
                            fetch-steg  ── safeFetch ──▶ mål   ✅ DNS-gate + redirect-revalidering per hopp
                            render-steg ── page.goto ──▶ mål   ❌ INGEN gate: egen DNS, auto-redirects, kjører JS
                            analyze (deterministisk + Claude Haiku — kun strukturert sammendrag)
                            persist → Report (Postgres) + screenshot → Cloudflare R2 (offentlig URL)
                                   ▲
  Nettleser ◀── GET /api/jobs/:id, /api/reports/:id  (ingen auth, cuid-id, Cache-Control: public)
```

- **Vercel** kjører **kun** `apps/web` (`apps/web/vercel.json`: installer på rot, `prisma generate`, `turbo run build --filter=@areyouagentic/web`, Next standalone). Web-laget har de sterke headerne (CSP/HSTS) fra `apps/web/next.config.ts`.
- **Railway** (eller Fly) kjører **api** og **worker** som containere (egne Dockerfiles). Worker er den eneste som rører Anthropic-nøkkel og R2-credentials — god hemmelighets-isolering, bekreftet i `apps/worker/src/lib/env.ts` vs. `apps/api/src/lib/env.ts`.
- **Datalag:** Postgres (Neon/Supabase), Redis/Upstash (BullMQ-kø + rate-limit-store), R2 (screenshots).
- **Hemmelighets-håndtering:** `.env` er git-ignorert og har **aldri** vært committet (verifisert mot hele git-historikken) — kun `.env.example` er sjekket inn.

**Sikkerhetskonsekvens av nettopp dette oppsettet:** worker-containeren på Railway/Fly har tilgang til plattformens interne nettverk og potensielt cloud-metadata-endepunktet `169.254.169.254`. Render-bypasset (Del 3) er altså utnyttbart akkurat i miljøet de deployer til — og forsvaret må ligge i appen, ikke i plattformen.

---

## Del 3 — Hovedfunn: SSRF via render-steget

`apps/worker/src/pipeline/runAnalysis.ts` sier det selv i kommentaren:

> _"fetch and render are independent (render goes to the URL itself, it doesn't need rawHtml) → run in parallel"_

`apps/worker/src/pipeline/stages/render.ts` gjør `await page.goto(ctx.url, …)` direkte. Konsekvenser:

1. **DNS-rebinding:** `safeFetch` sin `resolveHostnameSafely` (hele forsvaret mot rebinding) brukes ikke her. Chromium resolver selv ved navigering — `evil.example.com → 169.254.169.254` blokkeres på fetch-stien, men **følges** på render-stien.
2. **Redirect-SSRF:** Chromium følger 3xx automatisk. En offentlig URL som 302-redirecter til `http://169.254.169.254/latest/meta-data/...` følges (mens `safeFetch` revaliderer hvert hopp).
3. **JS-drevet SSRF:** Målsiden kjører JavaScript. En ondsinnet side kan `fetch('http://10.0.0.x/...')` eller mot metadata-endepunktet, skrive svaret inn i DOM-en, og det havner i fullside-screenshotet som lagres offentlig i R2.

**Impact:** lese cloud-metadata (avhengig av plattform), nå interne tjenester/andre containere, portskanne internt nett, og eksfiltrere via det offentlig lagrede skjermbildet. Dette er nøyaktig trusselen `SECURITY.md` punkt 1 sier er "in scope" og løst — men beskyttelsen dekker bare den ene av to nettverksstier.

**Utnyttbarhetens omfang er plattform-avhengig** (Fly blokkerer noe metadata-trafikk; Railway varierer), men RFC1918-interne tjenester og container-loopback er nåbare uavhengig av plattform. Derfor må forsvaret ligge i appen.

---

## Del 4 — Tiltaksplan (prioritert)

### P0 — Kritisk, fikses først

1. **Lukk render-steg-SSRF.** Tre lag, helst alle:
   - **App-lag (nødvendig):** Resolver verten via `resolveHostnameSafely` _før_ `page.goto`; avvis blokkerte mål med `PermanentJobError`. Bruk `context.route('**/*', …)` som revaliderer hver request (shape + DNS-klassifisering) og `route.abort()`-er blokkerte mål — dekker hovednavigasjon, redirects og JS-drevne subrequests. Cap antall redirects.
   - **Nettverkslag (defense-in-depth):** Blokker egress fra worker-containeren til `169.254.169.254`, `10/8`, `172.16/12`, `192.168/16`, `127/8`, `fc00::/7`, `fe80::/10`. Skal ikke avhenge av plattformen.
2. **Stopp intern-IP-lekkasje i feilmeldinger.** Map `safeFetch`-reasons til generiske brukermeldinger; behold detaljene kun i server-logg (`fetch.ts`, `runAnalysis.ts` → `errorMessage`).
3. **R2-hardening (deploy):** ikke gjør bøtta listbar; vurder signerte URL-er. (Render-fiksen fjerner selve eksfiltreringsvektoren.)

### P1 — Høy

4. **Fiks rapporteringskanal + doc/virkelighet-gap:** rett `siteConfig.links.github`, fiks SECURITY.md-lenken og Anthropic-/"public unlisted"-formuleringen i `privacy/page.tsx`. Sørg for at `security@areyouagentic.com` finnes.
5. **Uglette-bare rapport-ID-er:** bytt `Report.id` fra `cuid()` til `cuid(2)` (cuid2, kryptografisk tilfeldig) — ID-en er den eneste tilgangskontrollen.
6. **Sensitive query-parametre:** masker/strip tokens i lagret `url`/`finalUrl`. Legg advarsel ved input-feltet: "rapporten er offentlig via lenke; ikke send private/tokeniserte URL-er; offentlig sideinnhold kan sendes til Anthropic".
7. **Selvbetjent sletting:** delete-token vist én gang ved analyse + `DELETE /api/reports/:id`; behold 90-dagers cron som fallback.

### P2 — Medium

8. **CORS:** `credentials: false` (ingen cookies brukes).
9. **JSON-LD:** trygg serialisering som escaper `<`/`>`/`&` (defense-in-depth).
10. **Prompt injection-hygiene:** delimiters rundt `pageTitle`/`finalUrl` i prompten, merk dem som ikke-betrodd; behold deterministisk score som fasit; regresjonstest med injection-tittel.
11. **Misbrukshardening:** valgfri (env-gated) Cloudflare Turnstile-verifisering på `POST /api/analyze`, samt per-registrerbart-domene-grense på mål-verten.

### Branch-strategi

- `docs/sikkerhetsanalyse` — dette dokumentet.
- `security/p0-ssrf` — P0 (off `main`).
- `security/p1-exposure` — P1 (off `security/p0-ssrf`).
- `security/p2-hardening` — P2 (off `security/p1-exposure`).

P0 fullføres og verifiseres før P1 påbegynnes.
