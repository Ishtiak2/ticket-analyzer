# Implementation Plan — Ticket Analyzer

**Project:** Ticket Analyzer (bKash presents SUST CSE Carnival 2026 — Codex Community Hackathon)
**Author:** Solutions Architecture Pass — pre-build phase
**Status:** Draft for review — no application code written yet
**Source of truth:** Appendix A of `SUST_CSE_Carnival_2026_Workshop_Task_Instructions.md` (the Reference PRD)

---

## 0. How to Use This Document

This is the blueprint we execute against in later steps. It translates the PRD + architecture diagram into concrete engineering decisions, a repository skeleton, contracts, environment variables, a build/deploy pipeline, and a validation plan. Every later coding session should be a direct, mechanical implementation of one milestone in Section 9 — if it isn't, we update this plan first.

---

## 1. Source-Document Conflicts & Resolution Decisions

The PRD body, the API example, the data-model table, and the architecture-diagram text don't all agree with each other. Rather than discover these mid-build, we resolve them now. **These are binding decisions for implementation** unless you tell me otherwise before we start coding.

| # | Conflict | Where it appears | Decision | Rationale |
|---|----------|-------------------|----------|-----------|
| 1 | **Model choice**: PRD §9 says `distilbert-base-uncased-finetuned-sst-2-english`; architecture diagram §3 says `sshleifer/tiny-distilbert-base-uncased-finetuned-sst-2-english` | §9 vs Architecture §3 | **Use `distilbert-base-uncased-finetuned-sst-2-english`** | §13 Acceptance Criteria explicitly requires `POSITIVE`/`NEGATIVE` labels as proof "the real distilbert-sst-2 model is being used." The `sshleifer/tiny-*` variant is a distilled-for-testing model not guaranteed to ship the same label mapping or quality. Acceptance criteria outrank the diagram. |
| 2 | **Primary key type**: PRD §8 says `id: integer`; API example response shows `"id": 1`; architecture diagram §5 says `id: UUID` | §8 / Example Response vs Architecture §5 | **Use `id: SERIAL/BIGINT` (integer, auto-increment)** | The explicit example response (`"id": 1`) and the formal Data Model table both say integer; the diagram is the looser artifact. Integer PKs are also simpler for a hackathon SQLAlchemy demo. |
| 3 | **Frontend port**: PRD §6 and §12 imply port 3000 in some places vs Nginx defaulting to 80 | §6/§12 vs typical Nginx | **Container listens on 80 internally, host-mapped to 3000** | Keeps the Nginx image stock/standard while satisfying the "port 3000" requirement at the compose/host level. |
| 4 | **CORS vs reverse proxy** | §12 | **Default to Nginx reverse proxy (`/api` → backend); CORS middleware added as a documented fallback, disabled by default** | PRD explicitly prefers this path and it removes a whole class of cross-origin bugs for the live demo. |

If any of these decisions conflict with something the judges/organizers told you verbally, flag it before Milestone 1 and we'll amend this section.

---

## 2. System Architecture

```
                         ┌─────────────────────────────┐
                         │        Browser (User)        │
                         └───────────────┬──────────────┘
                                         │ HTTP :3000
                         ┌───────────────▼──────────────┐
                         │   frontend (Nginx + React)    │
                         │   - serves static SPA build   │
                         │   - reverse-proxies /api/* ───┼────┐
                         └───────────────────────────────┘    │
                                                               │ HTTP :8000 (internal docker net)
                         ┌─────────────────────────────────────▼───┐
                         │        backend (FastAPI + Uvicorn)       │
                         │  ┌─────────────────────────────────┐     │
                         │  │  Inference module                │     │
                         │  │  distilbert-sst-2 (baked at build)│    │
                         │  └─────────────────────────────────┘     │
                         │  ┌─────────────────────────────────┐     │
                         │  │  SQLAlchemy ORM layer             │    │
                         │  └────────────────┬────────────────┘     │
                         └───────────────────┼──────────────────────┘
                                             │ TCP :5432 (internal docker net)
                                  ┌──────────▼───────────┐
                                  │   db (PostgreSQL)      │
                                  │   named volume: pgdata │
                                  └────────────────────────┘
```

**Component responsibilities**

| Component | Responsibility | NOT responsible for |
|---|---|---|
| `frontend` | Render form + ticket list, call `/api/*`, no business logic | Auth, sentiment computation, persistence |
| `backend` | Validate input, run inference, persist row, serve REST API, own DB schema | Rendering, static assets, long-running training |
| `db` | Durable storage of tickets | Business logic, computing sentiment |

**Build-time vs Runtime flow (per the legend in the diagram):**
- **Development workflow** (dashed arrow): Puku Editor/CLI → source → `docker compose up --build` locally.
- **Deployment/image flow** (solid arrow): GitHub (source) + DockerHub (images) → Poridhi Lab VM / AWS instance → `docker compose up -d`.
- **Application/data flow** (runtime arrow): Browser → frontend:3000 → backend:8000 → model inference + Postgres:5432.

---

## 3. Repository Structure (authoritative)

```
ticket-analyzer/
├── PRD.md                          # copy of Appendix A, verbatim, as the contract
├── README.md                       # Task 3 deliverable (see Section 11)
├── IMPLEMENTATION_PLAN.md          # this document
├── .gitignore
├── .env.example                    # documents every var in Section 6, no real secrets
├── docker-compose.yml              # local dev (build: contexts)
├── docker-compose.prod.yml         # deploy overlay (image: <dockerhub>/...:v1, no build:)
├── backend/
│   ├── Dockerfile
│   ├── requirements.txt
│   ├── .dockerignore
│   └── app/
│       ├── main.py                 # FastAPI app, startup hooks, router include
│       ├── config.py               # Settings via pydantic-settings, reads env vars
│       ├── database.py             # engine, SessionLocal, Base
│       ├── models.py                # SQLAlchemy ORM: Ticket
│       ├── schemas.py               # Pydantic: TicketCreate, TicketOut, HealthOut
│       ├── crud.py                  # create_ticket, list_tickets
│       ├── sentiment.py             # model load-once-at-startup + predict()
│       └── routers/
│           ├── health.py            # GET /health
│           └── tickets.py           # POST /tickets, GET /tickets
└── frontend/
    ├── Dockerfile
    ├── .dockerignore
    ├── nginx.conf                   # reverse proxy config for /api
    ├── package.json
    ├── vite.config.ts
    └── src/
        ├── main.tsx
        ├── App.tsx
        ├── api/client.ts             # fetch wrapper using VITE_API_BASE_URL
        ├── components/
        │   ├── TicketForm.tsx
        │   └── TicketList.tsx
        └── types/ticket.ts
```

**Design rule:** anything that is "demo glue" (seed scripts, smoke-test curl scripts) goes in a top-level `scripts/` folder, not inside `backend/app` or `frontend/src`, so the application code stays a clean reflection of the PRD.

---

## 4. Data Model

**Table:** `tickets`

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `id` | `INTEGER` | PK, autoincrement | Decision #2 above |
| `title` | `VARCHAR(255)` | NOT NULL | |
| `message` | `TEXT` | NOT NULL | Body sent to the model |
| `category` | `VARCHAR(100)` | NULLABLE | Optional per PRD §4 |
| `sentiment` | `VARCHAR(20)` | NOT NULL | `POSITIVE` \| `NEGATIVE` |
| `confidence` | `FLOAT` | NOT NULL | 0.0–1.0, from model softmax |
| `created_at` | `TIMESTAMP` | NOT NULL, server default `now()` | UTC |

**Schema lifecycle:** `Base.metadata.create_all(engine)` runs once at backend startup (PRD §12). This is explicitly a hackathon shortcut, not a migrations story — documented as a known limitation in the README so nobody mistakes it for production practice. If this project ever grows past the demo, the upgrade path is Alembic.

**Indexing:** add an index on `created_at DESC` up front — `GET /tickets` will sort by recency and the table will keep growing across demo sessions.

---

## 5. API Contract

All endpoints are served under `/api` when reached through the frontend Nginx proxy, and directly on `:8000` when called backend-to-backend or during local dev/testing.

### `GET /health`
**200 OK**
```json
{ "status": "ok" }
```
No dependency check (DB ping, model-loaded check) is required by the PRD, but we add a `model_loaded: true/false` boolean as a non-breaking superset — it is the cheapest possible canary for "the demo is about to fail."

### `POST /tickets`
**Request**
```json
{
  "title": "Lab VM issue",
  "message": "My lab VM is not opening before the deadline.",
  "category": "lab"
}
```
**Validation rules**
- `title`: required, 1–255 chars
- `message`: required, 1–4000 chars (model truncates internally at 512 tokens regardless)
- `category`: optional, ≤100 chars

**201 Created**
```json
{
  "id": 1,
  "title": "Lab VM issue",
  "message": "My lab VM is not opening before the deadline.",
  "category": "lab",
  "sentiment": "NEGATIVE",
  "confidence": 0.999,
  "created_at": "2026-05-20T10:30:00"
}
```
**422** — validation error (FastAPI default shape, unchanged).
**503** — model not loaded yet (should not occur given startup-load design, but documented for honesty).

### `GET /tickets`
**Query params:** `limit` (default 50, max 200), `offset` (default 0) — not in the PRD, added as sane pagination defaults so the list endpoint doesn't fall over after dozens of demo submissions.

**200 OK**
```json
[
  {
    "id": 2,
    "title": "Great onboarding",
    "message": "The setup docs were super clear, thanks!",
    "category": "feedback",
    "sentiment": "POSITIVE",
    "confidence": 0.998,
    "created_at": "2026-05-20T10:31:00"
  },
  {
    "id": 1,
    "title": "Lab VM issue",
    "message": "My lab VM is not opening before the deadline.",
    "category": "lab",
    "sentiment": "NEGATIVE",
    "confidence": 0.999,
    "created_at": "2026-05-20T10:30:00"
  }
]
```
Sorted `created_at DESC` (newest first) — matches the "frontend refreshes the ticket list" user flow in PRD §4.

---

## 6. Environment Variable Matrix

| Service | Variable | Example / Default | Required | Notes |
|---|---|---|---|---|
| backend | `DATABASE_URL` | `postgresql://postgres:postgres@db:5432/ticket_db` | Yes | Points at the `db` service name on the compose network |
| backend | `MODEL_NAME` | `distilbert-base-uncased-finetuned-sst-2-english` | Yes | Must match what was baked in at build time |
| backend | `HF_HOME` | `/opt/hf-cache` | Yes | Must match the Dockerfile's bake-in path exactly |
| backend | `TRANSFORMERS_OFFLINE` | `1` | Yes | Forces a loud failure if weights are missing |
| backend | `CORS_ALLOWED_ORIGINS` | `` (empty = disabled) | No | Fallback path only, per Decision #4 |
| backend | `LOG_LEVEL` | `info` | No | |
| frontend | `VITE_API_BASE_URL` | `/api` | Yes | Baked into the static build at image build time (Vite env vars are compile-time, not runtime — see Risk Register) |
| postgres | `POSTGRES_USER` / `POSTGRES_PASSWORD` / `POSTGRES_DB` | `postgres` / `postgres` / `ticket_db` | Yes | Demo-grade credentials; real secrets handled per Section 8 |

`.env.example` in the repo root mirrors this table exactly so a new reader never has to guess a variable name.

---

## 7. AI Model Integration Strategy

This is the highest-risk subsystem for a live demo (network flakiness, slow downloads, cold starts), so it gets its own explicit strategy rather than being left as an implementation detail.

1. **Bake, don't fetch.** The backend Dockerfile runs a Python snippet calling `AutoTokenizer.from_pretrained(MODEL_NAME)` and `AutoModelForSequenceClassification.from_pretrained(MODEL_NAME)` **during the build**, with `HF_HOME` already set to the final runtime path. This guarantees the weights are layered into the image filesystem.
2. **Prove it's offline.** At runtime, `TRANSFORMERS_OFFLINE=1` is set. If the bake step was skipped or the cache path mismatches, the container must fail loudly on startup — never silently fall back to a network fetch. This is also literally one of the PRD's dry-run acceptance criteria (no network access to huggingface.co at runtime).
3. **Load once, at startup, into a module-level singleton.** Use FastAPI's lifespan/startup event to load the pipeline exactly once into a global held in `sentiment.py`. Every request reuses it. No per-request `from_pretrained()`, no lazy-load-on-first-call.
4. **CPU-only torch.** Install torch from `https://download.pytorch.org/whl/cpu` to keep the image in the 600–800MB band instead of 2GB+ (PRD §12). This is a `pip install` flag, not a code-level decision, but it belongs here because it directly affects build time and demo-day image pull speed.
5. **Pin the version.** Pin `transformers`, `torch`, and the model revision (commit hash if possible) in `requirements.txt` so a rebuild months from now can't silently pull a different model snapshot with different label ordering.
6. **Label sanity check.** Add a one-line startup assertion that the model's `id2label` mapping is exactly `{0: 'NEGATIVE', 1: 'POSITIVE'}` (or the inverse) — fail fast instead of shipping `LABEL_0`/`LABEL_1` to the judges, which the PRD explicitly calls out as a failure mode.

---

## 8. Docker, Compose & Secrets Strategy

### Two-compose-file pattern
- **`docker-compose.yml`** — local dev. Uses `build:` contexts so `docker compose up --build` always reflects current source.
- **`docker-compose.prod.yml`** — deployment overlay. Uses `image: <dockerhub-username>/ticket-analyzer-backend:v1` / `...frontend:v1`, no `build:` key. Run on the VM with `docker compose -f docker-compose.prod.yml up -d`.

This avoids the common hackathon mistake of accidentally rebuilding from source on the VM (slow, and defeats the "pre-built image" requirement in the PRD's tips section).

### Healthcheck-gated startup
`db` service gets a Postgres healthcheck (`pg_isready`); `backend` declares `depends_on: db: condition: service_healthy`. This directly satisfies the PRD's cold-boot requirement and avoids flaky "connection refused" failures during the live demo.

### Secrets handling
- **No secrets in Git, ever** — not even demo-grade ones, to model good practice.
- Local dev: `.env` file (gitignored), populated from `.env.example`.
- Deployment: AWS credentials are pulled from the Poridhi Lab session at deploy time only and passed to the Puku CLI / `aws configure` as environment variables or a short-lived credentials file — never written into the repo or into a Docker image layer.
- Database password for the demo can remain a static `postgres`/`postgres` pair scoped to an internal Docker network with no external port exposure on `db` — acceptable for a hackathon demo, explicitly flagged in the README as not production-grade.

### Image tagging discipline
- `:v1` for the first working deploy; bump to `:v1.1`, `:v2`, etc. for any post-demo fix so the VM can be redeployed deterministically by pulling a named tag instead of `:latest`.

---

## 9. Phased Implementation Roadmap

Each phase has a single exit gate: if the gate isn't met, we don't move to the next phase. This keeps "it sort of works" from leaking into the deploy step.

### Phase 0 — Scaffolding & Contracts (no business logic yet)
- Create repo structure from Section 3.
- Write `PRD.md` (verbatim copy of Appendix A) and `.env.example`.
- Stub FastAPI app with `/health` only; stub Vite app with a placeholder page.
- **Exit gate:** `docker compose up --build` brings up `frontend` + `backend` (no `db` logic yet), `GET /health` returns `{"status": "ok"}`.

### Phase 1 — Database & Backend Core
- Implement `models.py`, `schemas.py`, `database.py`, `crud.py`.
- Wire `Base.metadata.create_all(engine)` at startup.
- Implement `POST /tickets` and `GET /tickets` with a **hardcoded fake sentiment** (e.g. always `"POSITIVE", 0.5`) to decouple DB correctness from model correctness.
- **Exit gate:** Submitting a ticket via curl persists a row; restarting the backend (not the volume) still shows it via `GET /tickets`.

### Phase 2 — Model Integration
- Implement `sentiment.py` per Section 7.
- Bake the model into the backend Dockerfile; verify image works with no network access (`docker run --network none`).
- Replace the fake sentiment call in `tickets.py` with the real one.
- **Exit gate:** All four model-related dry-run criteria from PRD §13 pass locally (offline boot, label sanity, real confidence scores, single startup load — verified by timing the first vs. second request).

### Phase 3 — Frontend
- Build `TicketForm` and `TicketList`, wire to `/api` via `VITE_API_BASE_URL`.
- Write `nginx.conf` reverse proxy for `/api` → `backend:8000`.
- **Exit gate:** Full user flow from PRD §4 works end-to-end in a browser against the local compose stack; a page refresh still shows prior tickets (PostgreSQL persistence, not frontend state).

### Phase 4 — Local Hardening (this is "Task 1" in the workshop sheet)
- Add Postgres healthcheck + `depends_on: condition: service_healthy`.
- Fresh-volume test: `docker compose down -v && docker compose up --build` → table auto-creates, first `POST /tickets` succeeds with no manual steps.
- Troubleshooting pass: deliberately break each dependency (DB down, model path wrong, CORS misconfigured) once each, capture the failure mode and fix, log it for the README's troubleshooting section.
- **Exit gate:** every Task 1 "Definition of Done" item is independently re-verifiable from a clean checkout.

### Phase 5 — Registries (start of "Task 2")
- Push source to GitHub (clean history, `.gitignore` excludes `.env`, `node_modules`, `__pycache__`, model cache artifacts if ever materialized outside the image).
- Build and tag both images per Section 8 image-tagging discipline; push to DockerHub.
- **Exit gate:** a teammate with no local source can `docker pull` both images and run `docker-compose.prod.yml` standalone, pointed at a fresh Postgres, and reach the same end-to-end result as Phase 4.

### Phase 6 — Cloud Deployment (rest of "Task 2")
- Obtain AWS credentials from the Poridhi Lab session; configure them for the Puku CLI / `aws-cli` (env vars or short-lived credentials file — never committed).
- Provision/connect to the target VM via the Puku CLI.
- Place `docker-compose.prod.yml` (or an equivalent generated by Puku) on the VM; `docker compose up -d` using the DockerHub images only.
- Open the relevant ports (3000 for frontend at minimum; do **not** expose 5432 or 8000 publicly unless explicitly needed for debugging — see Risk Register).
- **Exit gate:** from a machine that is NOT the VM and NOT localhost, the frontend loads, `/health` is green, and submitting a ticket round-trips through inference and Postgres on the VM.

### Phase 7 — Documentation (Task 3)
- Write `README.md` per the outline in Section 11.
- Cross-check every command in the README by actually running it from a clean clone, not from memory.
- **Exit gate:** a person who was not in the room can clone the repo and reach a working local stack using only the README.

### Phase 8 — Final Acceptance Pass
- Walk every bullet in PRD §13 ("Acceptance Criteria") and the workshop sheet's "Overall Definition of Done" line by line against the live deployed URL, not localhost.
- **Exit gate:** all boxes in Section 12 of this document are checked.

---

## 10. Validation & Testing Strategy

| Layer | What we test | How |
|---|---|---|
| Unit | Pydantic schema validation (title/message length limits) | `pytest` against `schemas.py` |
| Unit | Sentiment label mapping sanity (`id2label` assertion from Section 7) | `pytest`, runs at CI/build time, also re-asserted at app startup |
| Integration | `POST /tickets` → row exists in DB with correct sentiment field types | `pytest` + a throwaway Postgres (docker, or `pytest-postgresql`) |
| Integration | `GET /tickets` pagination defaults and ordering | `pytest` |
| Container | Offline boot proof — `docker run --network none <backend-image>` starts cleanly and serves `/health` | Manual + scripted in `scripts/dry_run_offline.sh` |
| Container | Fresh-volume boot — table auto-creation, first ticket succeeds | `scripts/dry_run_fresh_db.sh` |
| End-to-end | Browser flow: submit → see sentiment → refresh → still there | Manual browser pass locally and against the deployed URL; optionally a thin Playwright script if time allows (explicitly optional — not a PRD requirement) |
| End-to-end | Non-localhost browser submits successfully (proves reverse proxy / base URL works) | Manual pass from a second machine/phone against the VM IP/domain |

All of the above dry-runs map 1:1 onto the four explicit "Dry-run" bullets in PRD §13 — we are not inventing new tests, just giving each PRD dry-run a named script/step so it's repeatable instead of ad hoc.

---

## 11. Documentation Plan (Task 3 / README.md outline)

1. **Overview** — one paragraph + the architecture diagram from Section 2.
2. **Prerequisites** — Docker, Docker Compose, Node (frontend dev only), Python (backend dev only), Puku CLI, AWS CLI.
3. **Local Setup** — copy `.env.example` → `.env`, `docker compose up --build`, expected URLs (`http://localhost:3000`, `http://localhost:8000/health`).
4. **Environment Variables** — render the table from Section 6.
5. **API Reference** — render Section 5 verbatim (request/response examples already match the PRD's own examples for consistency).
6. **Deployment Guide** — credential flow (Poridhi Lab → Puku CLI, never committed), image push commands, VM deploy command (`docker compose -f docker-compose.prod.yml up -d`), how to verify post-deploy.
7. **Links** — GitHub repo URL, DockerHub image URLs (both tags), live deployed URL. (Placeholders until Phase 5/6 produce real links.)
8. **Troubleshooting Notes** — populated live during Phase 4's deliberate-breakage exercise; written as "symptom → cause → fix" triples, not a generic FAQ.
9. **Known Limitations** — no migrations, no auth, demo-grade DB credentials, no CI/CD — stated explicitly so reviewers know these are scoped-out by the PRD, not oversights.

---

## 12. Final Definition-of-Done Checklist

Mirrors the workshop sheet's "Overall Definition of Done" and PRD §13, kept here as the single checklist to walk before calling the project complete.

- [ ] Frontend opens successfully, locally and at the deployed URL
- [ ] `GET /health` returns `{"status": "ok"}` in both environments
- [ ] A user can submit a ticket from the frontend (both environments)
- [ ] Backend returns real `POSITIVE`/`NEGATIVE` + confidence from distilbert-sst-2, not `LABEL_0`/`LABEL_1`
- [ ] Ticket persists in PostgreSQL and survives a page refresh
- [ ] Source code pushed to GitHub; both images pushed to DockerHub under versioned tags
- [ ] AWS/Poridhi credentials sourced from the Poridhi Lab, used only at deploy time, never committed
- [ ] App reachable and fully functional from a non-VM, non-localhost browser
- [ ] Dry-run: backend boots with `--network none` and serves `/health` (proves baked-in weights)
- [ ] Dry-run: fresh Postgres volume auto-creates schema; first `POST /tickets` succeeds
- [ ] Dry-run: ticket submitted from a remote browser via the reverse proxy succeeds
- [ ] README + PRD.md complete and independently reproducible by a fresh clone

---

## 13. Risk Register

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Model bake step silently falls back to network fetch, breaks offline dry-run | Medium | High | Explicit `TRANSFORMERS_OFFLINE=1` + startup assertion (Section 7); test with `--network none` before demo day |
| Vite env vars are compile-time, not runtime — `VITE_API_BASE_URL` baked at build, can't be changed by just editing `.env` on the VM | Medium | Medium | Document this explicitly in README; default `/api` works unchanged across localhost and VM precisely because it's a relative path, not an absolute host |
| Exposing Postgres (`5432`) or backend (`8000`) directly on the VM's public interface | Medium | High (security) | Compose network isolation; only the frontend's port is published; debugging access goes through SSH tunnel, not a public port |
| Image size creep from accidentally pulling GPU torch | Medium | Medium | Pin the CPU-only index URL in `requirements.txt`/Dockerfile; verify final image size in Phase 5 |
| Stale DockerHub `:v1` tag reused after a fix, causing the VM to redeploy old code | Low | High | Version bump discipline from Section 8; never push fixes under an already-deployed tag |
| Model cold-start latency during the very first live demo request | Medium | Medium | Mandatory startup-load (Section 7, point 3) plus a synthetic warm-up request immediately after backend boot in the deploy script |
| Demo-grade DB credentials reused beyond the hackathon | Low | Low (scoped) | Explicitly flagged as a known limitation in README so it's a documented tradeoff, not a silent gap |

---

## 14. Open Questions for You Before Coding Starts

These don't block starting Phase 0, but answering them now avoids rework later:

1. Do you want the optional pagination (`limit`/`offset`) on `GET /tickets`, or should it strictly return PRD-only fields/behavior with no additions?
2. Should we add the lightweight Playwright e2e script (Section 10) given hackathon time constraints, or keep validation fully manual?
3. Confirm Decision #1 and #2 in Section 1 (model name, integer PK) are acceptable, since they override literal text elsewhere in the source documents.

---

*End of plan. Next step, on your go-ahead: execute Phase 0.*