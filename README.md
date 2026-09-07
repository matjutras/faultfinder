# FaultFinder

[![GitHub](https://img.shields.io/badge/GitHub-matjutras%2Ffaultfinder-181717?logo=github)](https://github.com/matjutras/faultfinder)

See `CLAUDE.md` for architecture and conventions.

## Backend

```
cd backend
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
.venv/bin/uvicorn app.main:app --reload
.venv/bin/pytest -v
```

Requires `ngspice` on PATH (`sudo apt-get install ngspice`) and `kicad` for
`kicad-cli` (`sudo apt-get install kicad`).

`map.json` and `faults.json` under each `devices/*/` are generated, not
committed (see CLAUDE.md) — after a fresh checkout, regenerate them once per
device:

```
curl -X POST http://localhost:8000/api/devices/voltage_divider_01/import
```

## Frontend

```
cd frontend
npm install
npm run dev
npm test
```
