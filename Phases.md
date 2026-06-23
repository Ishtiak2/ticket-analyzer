# Phases.md — Step-by-Step Build Guide

**Project:** Ticket Analyzer
**Companion to:** `IMPLEMENTATION_PLAN.md` (read that first for *why*; this file is *how*, step by step)
**Scope of this file:** concrete, ordered actions — commands to run, files to create and what goes in each, and the exact check to run before moving to the next step. Full source code is written when we actually implement each phase in the editor; this file is the execution checklist.

**Convention used below:**
- `[ ]` = an action you/we perform
- `✅ Check:` = the command/observation that proves the step worked before moving on
- Every phase ends with the **Exit Gate** from the Implementation Plan, repeated here so it's impossible to miss

---

## Phase 0 — Scaffolding & Contracts

**Goal:** A repo skeleton and a stub backend/frontend that boot together, before any real logic exists.

1. [ ] Create the root folder and git-init it.
   ```bash
   mkdir ticket-analyzer && cd ticket-analyzer
   git init
   ```
2. [ ] Create the full directory skeleton from the Implementation Plan §3 (empty files are fine for now):
   ```bash
   mkdir -p backend/app/routers frontend/src/{api,components,types} scripts
   touch PRD.md README.md .env.example .gitignore docker-compose.yml docker-compose.prod.yml
   touch backend/Dockerfile backend/requirements.txt backend/.dockerignore
   touch backend/app/{main.py,config.py,database.py,models.py,schemas.py,crud.py,sentiment.py}
   touch backend/app/routers/{health.py,tickets.py}
   touch frontend/Dockerfile frontend/.dockerignore frontend/nginx.conf
   ```
3. [ ] Paste the Appendix A PRD content into `PRD.md` verbatim — this becomes the contract everything else is checked against.
4. [ ] Write `.gitignore` (Python + Node + Docker basics): `__pycache__/`, `*.pyc`, `.env`, `node_modules/`, `dist/`, `*.log`, `.DS_Store`.
5. [ ] Write `.env.example` using the variable table from the Implementation Plan §6 — names and example values only, no real secrets.
6. [ ] Backend stub:
   - `requirements.txt`: `fastapi`, `uvicorn[standard]` only for now (DB/model deps come in Phase 1–2).
   - `app/main.py`: create the FastAPI app, include a router that only exposes `GET /health` returning `{"status": "ok"}`.
   - `Dockerfile`: base `python:3.11-slim`, copy `requirements.txt`, `pip install`, copy `app/`, `CMD uvicorn app.main:app --host 0.0.0.0 --port 8000`.
7. [ ] Frontend stub:
   - Scaffold Vite + React: `npm create vite@latest . -- --template react-ts` inside `frontend/` (or hand-roll if you prefer minimal deps).
   - Replace the default page with a one-line "Ticket Analyzer" placeholder — no API calls yet.
   - `Dockerfile`: multi-stage — `node:20-alpine` build stage running `npm ci && npm run build`, then copy `dist/` into an `nginx:alpine` runtime stage.
   - `nginx.conf`: serve `dist/` on port 80, leave the `/api` proxy block commented out for now (added in Phase 3).
8. [ ] Write a minimal `docker-compose.yml` with just `frontend` and `backend` services (no `db` yet), each using `build: ./<service>`.
9. [ ] Bring it up:
   ```bash
   docker compose up --build
   ```

✅ **Check:**
```bash
curl http://localhost:8000/health   # → {"status":"ok"}
curl -I http://localhost:3000       # → 200 OK, serves the placeholder page
```

**Exit Gate:** Both containers start clean with one compose command; `/health` is green; frontend placeholder loads in a browser.

---

## Phase 1 — Database & Backend Core (fake sentiment)

**Goal:** Real persistence working end-to-end, sentiment hardcoded so DB correctness isn't entangled with model correctness yet.

1. [ ] Add `db` service to `docker-compose.yml`: official `postgres:16-alpine` image, env vars `POSTGRES_USER/PASSWORD/DB` from `.env`, named volume `pgdata:/var/lib/postgresql/data`.
2. [ ] Add to `backend/requirements.txt`: `sqlalchemy`, `psycopg2-binary`, `pydantic-settings`.
3. [ ] `app/config.py`: a `Settings` class (pydantic-settings) reading `DATABASE_URL`, `MODEL_NAME`, `HF_HOME`, `TRANSFORMERS_OFFLINE` from env.
4. [ ] `app/database.py`: create the SQLAlchemy `engine` from `settings.DATABASE_URL`, `SessionLocal`, declarative `Base`.
5. [ ] `app/models.py`: define the `Ticket` ORM model exactly per Implementation Plan §4 (columns, types, `created_at` server default `now()`, index on `created_at`).
6. [ ] `app/schemas.py`: `TicketCreate` (title, message, category) and `TicketOut` (all columns) Pydantic models, matching the API contract in Implementation Plan §5 field-for-field.
7. [ ] `app/crud.py`: `create_ticket(db, ticket_in, sentiment, confidence)` and `list_tickets(db, limit, offset)`.
8. [ ] `app/routers/tickets.py`:
   - `POST /tickets` → validates input, calls a **stubbed** `fake_sentiment()` returning `("POSITIVE", 0.5)`, persists via `crud.create_ticket`, returns `TicketOut`.
   - `GET /tickets` → returns list ordered `created_at DESC`, supports `limit`/`offset` query params.
9. [ ] `app/main.py`: add a startup event calling `Base.metadata.create_all(engine)`; include the `tickets` router.
10. [ ] Rebuild and bring the full stack up:
    ```bash
    docker compose up --build
    ```

✅ **Check:**
```bash
curl -X POST http://localhost:8000/tickets \
  -H "Content-Type: application/json" \
  -d '{"title":"Test","message":"Hello world","category":"demo"}'
# → 201, sentiment is the hardcoded fake value, id present

curl http://localhost:8000/tickets   # → array containing the ticket just created
```
Then restart only the backend (`docker compose restart backend`) and re-run `GET /tickets` — the row must still be there (proves it lives in Postgres, not in-process memory).

**Exit Gate:** Ticket persists across a backend restart; both endpoints match the contract shape exactly (field names/types), even though sentiment is fake.

---

## Phase 2 — Real Model Integration

**Goal:** Swap the fake sentiment stub for the real, build-time-baked distilbert model, with offline-boot proof.

1. [ ] Add to `backend/requirements.txt`:
   ```
   torch --index-url https://download.pytorch.org/whl/cpu
   transformers
   ```
2. [ ] Update `backend/Dockerfile`:
   - Set `ENV HF_HOME=/opt/hf-cache` and `ENV TRANSFORMERS_OFFLINE=0` **only during the build stage** (must be `0`/unset at build time so the bake step is actually allowed to hit the network once).
   - Add a `RUN python -c "from transformers import AutoTokenizer, AutoModelForSequenceClassification; AutoTokenizer.from_pretrained('distilbert-base-uncased-finetuned-sst-2-english'); AutoModelForSequenceClassification.from_pretrained('distilbert-base-uncased-finetuned-sst-2-english')"` step — this is the bake-in.
   - After that `RUN` line, set `ENV TRANSFORMERS_OFFLINE=1` for the final runtime image so the container can never silently re-fetch.
3. [ ] `app/sentiment.py`:
   - Module-level `_pipeline = None`.
   - `load_model()` — loads tokenizer + model + builds a `transformers.pipeline("sentiment-analysis", ...)`, assigns to `_pipeline`. Includes the label-sanity assertion: confirm `id2label` resolves to exactly `POSITIVE`/`NEGATIVE` (case-sensitive, no `LABEL_0`).
   - `predict(text: str) -> tuple[str, float]` — runs `_pipeline(text[:512])`, returns `(label, round(score, 3))`.
4. [ ] `app/main.py`: call `sentiment.load_model()` in the startup event, **after** `create_all(engine)` and **before** the app starts accepting traffic. Log a clear line like `"Model loaded: distilbert-sst-2"` so it's visible in `docker compose logs backend`.
5. [ ] `app/routers/tickets.py`: replace `fake_sentiment()` with `sentiment.predict(ticket_in.message)`.
6. [ ] Rebuild the backend image specifically:
   ```bash
   docker compose build backend
   docker compose up -d
   ```
7. [ ] **Offline-boot proof** — run the built image with no network at all, isolated from compose:
   ```bash
   docker run --rm --network none -e DATABASE_URL=postgresql://x:x@localhost/x \
     -e TRANSFORMERS_OFFLINE=1 -e HF_HOME=/opt/hf-cache \
     <backend-image-name> python -c "from app.sentiment import load_model; load_model(); print('OK')"
   ```
   This must print `OK` with zero network errors. (The `DATABASE_URL` here can point anywhere unreachable — we're only proving the model loads offline, not testing DB connectivity in this command.)
8. [ ] Time the first request vs. the second to confirm load-once-at-startup, not lazy-load-on-first-call:
   ```bash
   time curl -s -X POST http://localhost:8000/tickets -H "Content-Type: application/json" \
     -d '{"title":"t1","message":"This is wonderful, thank you!"}'
   time curl -s -X POST http://localhost:8000/tickets -H "Content-Type: application/json" \
     -d '{"title":"t2","message":"This is wonderful, thank you!"}'
   ```
   Both should be fast and similar — if the first is dramatically slower than the second, the model is lazy-loading; fix the startup hook.

✅ **Check:** response `sentiment` is `POSITIVE` for an obviously positive message and `NEGATIVE` for an obviously negative one, with `confidence` close to 1.0 for clear-cut cases; never `LABEL_0`/`LABEL_1`.

**Exit Gate:** All four model-related dry-run criteria from PRD §13 pass locally — offline boot, correct labels, real confidence scores, single startup load.

---

## Phase 3 — Frontend Wiring

**Goal:** A real browser flow: submit ticket → see sentiment → refresh → still there.

1. [ ] `frontend/src/types/ticket.ts`: TypeScript interface mirroring `TicketOut` exactly.
2. [ ] `frontend/src/api/client.ts`: thin `fetch` wrapper —
   - `createTicket(payload)` → `POST {VITE_API_BASE_URL}/tickets`
   - `getTickets()` → `GET {VITE_API_BASE_URL}/tickets`
   - Centralize error handling (non-2xx → throw with parsed message) so components stay simple.
3. [ ] `frontend/src/components/TicketForm.tsx`: controlled inputs for title/message/category, calls `createTicket`, on success triggers a list refresh (lift state up or use a simple refetch callback — no global state library needed for this scope).
4. [ ] `frontend/src/components/TicketList.tsx`: fetches via `getTickets` on mount, renders title/sentiment/confidence/category/created_at, newest first (already sorted by the backend).
5. [ ] `frontend/src/App.tsx`: compose the two components on one page, per PRD §3 ("one page form and ticket list").
6. [ ] Set `VITE_API_BASE_URL=/api` in `frontend/.env` (or pass as a build arg in the Dockerfile — remember: Vite env vars are baked at build time, not read at container runtime).
7. [ ] `frontend/nginx.conf`: uncomment / add the reverse proxy block:
   ```nginx
   location /api/ {
       proxy_pass http://backend:8000/;
       proxy_set_header Host $host;
   }
   ```
8. [ ] Full rebuild:
   ```bash
   docker compose up --build
   ```

✅ **Check:** open `http://localhost:3000` in a real browser (not curl). Submit a ticket through the form, see the sentiment/confidence appear in the list without a manual page reload. Then **hard-refresh the page** (Cmd/Ctrl+Shift+R) — the ticket must still be there, proving it came from Postgres and not React state.

**Exit Gate:** Full PRD §4 user flow works end-to-end in a browser against the local stack; persistence survives a page refresh.

---

## Phase 4 — Local Hardening (Task 1 completion)

**Goal:** Make the local stack resilient to cold boots and document every failure mode found along the way.

1. [ ] Add a Postgres healthcheck to `docker-compose.yml`:
   ```yaml
   db:
     healthcheck:
       test: ["CMD-SHELL", "pg_isready -U ${POSTGRES_USER}"]
       interval: 5s
       timeout: 5s
       retries: 5
   backend:
     depends_on:
       db:
         condition: service_healthy
   ```
2. [ ] **Fresh-volume test** — simulate a brand-new deployment:
   ```bash
   docker compose down -v
   docker compose up --build
   ```
   Confirm the `tickets` table is created automatically (no manual `psql` steps) and the very first `POST /tickets` after boot succeeds.
3. [ ] **Deliberate-breakage pass** — do each of these on purpose, once, and write down symptom → cause → fix as you go (this becomes the README troubleshooting section verbatim):
   - [ ] Stop the `db` container while `backend` is running — observe the error, confirm backend doesn't crash-loop forever, restart `db` and confirm recovery.
   - [ ] Temporarily set `HF_HOME` to a path that doesn't match the bake-in path — confirm the container fails loudly at startup (not silently falling back to a network fetch).
   - [ ] Temporarily remove the Nginx `/api` proxy block — confirm the frontend's network calls fail with a clear, diagnosable error (CORS or 404), then restore it.
   - [ ] Send a malformed `POST /tickets` body (missing `title`) — confirm FastAPI returns a clean `422`, not a 500.
4. [ ] Re-run every check from Phases 1–3 once more, back to back, without manual intervention, to prove the whole local stack is genuinely "single compose command."

✅ **Check:** `docker compose down -v && docker compose up --build` and the full browser flow from Phase 3 works with zero manual steps in between.

**Exit Gate:** Every Task 1 "Definition of Done" item is independently reproducible from a clean checkout. Troubleshooting notes are written down, not just remembered.

---

## Phase 5 — Registries (start of Task 2)

**Goal:** Code on GitHub, both images on DockerHub, provably standalone from any local source.

1. [ ] Final review of `.gitignore` — confirm `.env`, `node_modules/`, `__pycache__/`, build artifacts are excluded; confirm no secrets are staged:
   ```bash
   git status
   git diff --staged
   ```
2. [ ] Commit and push:
   ```bash
   git add .
   git commit -m "Ticket Analyzer: working local stack (Tasks 0-4 complete)"
   git remote add origin <your-github-url>
   git push -u origin main
   ```
3. [ ] Log in to DockerHub and build tagged images:
   ```bash
   docker login
   docker build -t <dockerhub-username>/ticket-analyzer-backend:v1 ./backend
   docker build -t <dockerhub-username>/ticket-analyzer-frontend:v1 ./frontend
   ```
4. [ ] Push both:
   ```bash
   docker push <dockerhub-username>/ticket-analyzer-backend:v1
   docker push <dockerhub-username>/ticket-analyzer-frontend:v1
   ```
5. [ ] Write `docker-compose.prod.yml` referencing `image:` (the tags just pushed) instead of `build:`, otherwise identical to `docker-compose.yml` (same env vars, healthcheck, depends_on, volume).
6. [ ] **Standalone proof** — on the same machine, simulate "no local source": move/rename the `backend/` and `frontend/` source folders temporarily (or just test in a scratch directory containing only `docker-compose.prod.yml` and `.env`), then:
   ```bash
   docker compose -f docker-compose.prod.yml up -d
   ```

✅ **Check:** the standalone run (pulling only from DockerHub, no local build context) reaches the same green `/health`, ticket-submit, and refresh-persists result as Phase 4.

**Exit Gate:** A teammate with zero local source can pull both images and reproduce the full local result using only `docker-compose.prod.yml`.

---

## Phase 6 — Cloud Deployment (rest of Task 2)

**Goal:** The same stack, reachable from outside the VM, via Puku CLI + DockerHub images only.

1. [ ] Open the Poridhi Lab environment and copy the issued AWS credentials (access key, secret, region, any session token).
2. [ ] Configure them locally for the Puku CLI / AWS CLI **without writing them into any repo file**:
   ```bash
   aws configure
   # or, for a session-token-based credential:
   export AWS_ACCESS_KEY_ID=...
   export AWS_SECRET_ACCESS_KEY=...
   export AWS_SESSION_TOKEN=...
   export AWS_DEFAULT_REGION=...
   ```
3. [ ] Use the Puku CLI to provision or connect to the target (AWS instance or Poridhi Cloud VM) per its own documentation/workflow — this step is tool-driven, so follow Puku's prompts rather than a fixed command here.
4. [ ] Copy `docker-compose.prod.yml` and a deploy-time `.env` (populated with the real `POSTGRES_*` values — still never committed to Git) onto the VM, via the Puku CLI's deploy mechanism or `scp`.
5. [ ] On the VM:
   ```bash
   docker login
   docker compose -f docker-compose.prod.yml up -d
   ```
6. [ ] Confirm only the frontend's port is exposed publicly (e.g. `3000`); confirm `5432` and `8000` are **not** bound to a public interface — check the VM's security group / firewall rules, not just the compose file.
7. [ ] Run a warm-up request immediately after boot to absorb any first-request cold-start latency before judges see it:
   ```bash
   curl -X POST http://<vm-host>:3000/api/tickets -H "Content-Type: application/json" \
     -d '{"title":"warmup","message":"warming up the model"}'
   ```

✅ **Check:** from a device that is **not** the VM and **not** localhost (your laptop on a different network, or your phone on mobile data), open `http://<vm-host>:3000`, submit a real ticket, confirm sentiment returns and a refresh still shows it.

**Exit Gate:** The deployed app is reachable from a genuinely remote client and passes the same end-to-end test as the local run.

---

## Phase 7 — Documentation (Task 3)

**Goal:** A README good enough that a stranger can clone, run, and redeploy using only the doc.

1. [ ] Write `README.md` following the outline in Implementation Plan §11 (Overview → Prerequisites → Local Setup → Env Vars → API Reference → Deployment Guide → Links → Troubleshooting → Known Limitations).
2. [ ] Fill in real links now that they exist: GitHub repo URL, both DockerHub image URLs, the live VM/AWS URL.
3. [ ] Paste in the troubleshooting notes captured during Phase 4's deliberate-breakage pass, in symptom → cause → fix form.
4. [ ] **Cold read-through** — literally open a fresh terminal, `cd` to a brand-new empty directory, and follow your own README's Local Setup section character-by-character. Fix anything that doesn't work exactly as written.

✅ **Check:** the cold read-through in step 4 reaches a working local stack with no improvisation.

**Exit Gate:** A person who wasn't in the room can clone the repo and reach a working local stack using only the README.

---

## Phase 8 — Final Acceptance Pass

**Goal:** Walk every PRD/workshop-sheet requirement against the *live deployed URL*, one by one, and check it off.

1. [ ] Open the live URL fresh (not a cached tab) — confirm the frontend renders.
2. [ ] `curl http://<vm-host>:3000/api/health` — confirm `{"status":"ok"}`.
3. [ ] Submit a clearly positive ticket and a clearly negative ticket from the live frontend — confirm correct `POSITIVE`/`NEGATIVE` labels and sane confidence values.
4. [ ] Refresh the live page — confirm both tickets are still listed.
5. [ ] Confirm the GitHub repo is public/accessible and contains the final code, `PRD.md`, and `README.md`.
6. [ ] Confirm both DockerHub image pages are public and show the `:v1` tags actually deployed.
7. [ ] Re-run the offline-boot dry-run (Phase 2, step 7) against the **exact image tag** that's live on the VM, not just whatever's in local cache.
8. [ ] Walk the full checklist in Implementation Plan §12 top to bottom and check every box.

**Exit Gate:** Every box in Implementation Plan §12 is checked against the live deployment, not localhost.

---

*This file is a checklist, not a script to blindly paste — read each step, confirm it matches what we actually build, and tell me before any step if you want to deviate from the Implementation Plan's Section 1 decisions.*