# kerala-vehicle-lookup

Look up vehicle details and outstanding challans from a registration number.
Ships with an offline mock so the whole thing runs — CLI, HTTP API and UI —
without any credentials, plus one adapter you point at a real data provider when
you have a key.

```bash
npm install
npm test
npm run build && npm start        # http://localhost:3000
npm run lookup -- KL07BX1234      # same thing from the CLI
```

Out of the box `PROVIDER=mock`, so **everything you see is synthetic sample
data**. The UI and CLI both say so on every result.

---

## The finding this repo is built on

The short version: **there is no free, public, self-serve API for VAHAN or
eChallan data.** Anything that claims otherwise is worth a second look.

| Route | Reg number is enough? | Reality |
| --- | --- | --- |
| MVD Kerala portals | — | Web forms only, no documented API. Kerala challans (including Safe Kerala AI-camera ones) live in the central MoRTH eChallan system, so Kerala is not a separate integration target. |
| VAHAN "Know Your Vehicle Details" | Yes, for a human | Requires mobile-OTP login, and returns the owner name **masked** (`R**** K****`) under the DPDP Act, 2023. Not an API. |
| eChallan portal | Yes, for a human | Lookup by vehicle number behind a captcha. Undocumented internal JSON paths exist; using them breaks the portal's terms and is squarely a DPDP problem. Not a foundation for anything shippable. |
| MoRTH National Transport Repository | Yes, once approved | The legitimate direct route. The *Policy for Data Sharing from the National Transport Repository* (18 Aug 2025) opens VAHAN / Sarathi / eChallan / FASTag data to private entities by formal application, valid one year, renewed annually. Slow, and you need a stated lawful purpose. |
| Commercial aggregators | Yes | What people actually build on. Surepass, Invincible Ocean, Attestr, Eko, IDfy, Zoop and similar resell RC + challan lookups. Pay-per-call, business KYC required. **This is what `AggregatorProvider` targets.** |
| DigiLocker / API Setu | Only your own vehicle | Consent-based: the owner pulls their own RC. Cleanest under DPDP, useless for arbitrary plates. |

### One specific trap

Several blogs, and AI answers that have learned from them, confidently cite:

```
GET https://vahan.parivahan.gov.in/api/v1/vehicle/{registration_number}
"register at https://vahan.parivahan.gov.in/api/ for API access"
```

Neither the endpoint nor that signup page exists. It is a fabrication that has
propagated widely. Do not build against it.

Also worth knowing: MoRTH's 2019 **Bulk Data Sharing Policy** — the ₹3 crore/year
scheme that sold Vahan and Sarathi data — was scrapped in June 2020 over misuse
and privacy concerns. Older integration guides still reference it.

---

## Architecture

Everything sits behind one seam, `VehicleDataProvider`:

```
CLI ─┐
     ├─ LookupService ── privacy masking ── TtlCache ── VehicleDataProvider
HTTP ┘                                                   ├── MockProvider       (offline)
                                                         └── AggregatorProvider (real, needs key)
```

- **`src/regno.ts`** — parses and normalizes Indian plates (`kl-07 bx 1234` →
  `KL07BX1234`), including BH-series. Validation happens before any billable
  call goes out.
- **`src/rto.ts`** — Kerala RTO code → office. See the caveat below.
- **`src/privacy.ts`** — masking, applied by default.
- **`src/service.ts`** — orchestration, caching, partial-failure handling.
- **`src/providers/aggregator.ts`** — the real adapter.

Vehicle and challan lookups are separate provider calls because they are
separately priced and separately flaky. If the challan call fails you still get
the vehicle details, with `meta.partial: true` and the reason in `meta.warnings`.
Only a total failure throws.

### Wiring up a real provider

Copy `.env.example` to `.env`, set `PROVIDER=aggregator`, and fill in the base
URL, token and paths from your vendor's docs. The request shape is
env-configurable and the response mapping goes through an alias-tolerant `pick()`
that already handles `owner_name` / `ownerName` / `owner`, `{data:…}` /
`{result:…}` envelopes, and `"₹1,500"`-style amounts — so most vendors need
configuration only, not code. If a field comes back `null`, add the vendor's
name to the alias list in `mapVehicle` / `mapChallans`.

```bash
PROVIDER=aggregator \
AGGREGATOR_BASE_URL=https://your-vendor.example \
AGGREGATOR_TOKEN=xxx \
npm run lookup -- KL07BX1234
```

`test/aggregator.test.ts` drives the adapter with a stubbed `fetch` and covers
auth headers, 404-as-empty, non-retryable 401, and 5xx retry — so you can adjust
the mapping with a safety net and without spending calls.

### RTO table is deliberately incomplete

`src/rto.ts` contains only the **14 Kerala district RTOs** (KL-01 … KL-14).
Kerala also has many sub-RTOs (KL-15 upward) whose assignments change as offices
are reorganised, and that list is exactly the kind of detail that gets
hallucinated. Unknown codes resolve to `null` and surface as "Unknown RTO"
rather than a confident wrong answer. To complete it, source the office list
from MVD Kerala and extend the map — not from memory, and not from an AI summary.

## HTTP API

```
GET /api/v1/vehicles/:registrationNumber
GET /healthz
```

```jsonc
{
  "registrationNumber": "KL07BX1234",
  "plate":   { "formatted": "KL 07 BX 1234", "stateName": "Kerala", "rtoOffice": "Ernakulam" },
  "vehicle": { "ownerName": "M******* A*****", "makerModel": "i20 SPORTZ" },
  "challans": [ { "status": "PENDING", "amount": 500, "offences": ["Over speeding"] } ],
  "summary": { "pendingCount": 1, "pendingAmount": 500, "totalCount": 1 },
  "meta":    { "provider": "mock", "privacyMode": "masked", "cached": false, "partial": false }
}
```

Status codes: `400` malformed plate, `404` no route, `429` rate limited, `501`
provider misconfigured, `502`/`504` upstream problem.

## Legal and privacy

This is the part to get right before it goes anywhere near production.

- **`PRIVACY_MODE=masked` is the default**, mirroring what the public VAHAN
  portal itself returns post-DPDP. Owner name, chassis, engine and policy
  numbers are masked. Only switch to `full` if you have a lawful basis for the
  unmasked fields.
- **"Type any plate, see the owner" is the pattern the DPDP Act targets.** Safer
  designs: show masked data only, or verify ownership with an OTP to the
  RC-linked mobile before revealing anything personal.
- **Access logs hash the plate** with `AUDIT_SALT` rather than storing it, so you
  can spot abuse without building a searchable record of who looked up whom.
- **Aggregators are processors, not a legal basis.** Their terms typically
  require you to have your own lawful purpose and consent flow. Read them.
- Cached results are in-memory only and expire (default 10 minutes); nothing is
  persisted to disk.

## Status

- Mock path: complete and tested end to end (CLI, API, UI).
- Aggregator path: written and unit-tested against a stubbed `fetch`, but
  **never run against a live vendor** — it needs a paid key, and the sandbox this
  was built in blocks all outbound traffic to gov and vendor domains. Treat the
  first real call as the thing to verify, and expect to adjust field aliases.
