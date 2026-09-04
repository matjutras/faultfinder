# FaultFinder

See `CLAUDE.md` for architecture and conventions.

## Backend

```
cd backend
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
.venv/bin/uvicorn app.main:app --reload
.venv/bin/pytest -v
```

Requires `ngspice` on PATH (`sudo apt-get install ngspice`).

## Frontend

```
cd frontend
npm install
npm run dev
npm test
```
