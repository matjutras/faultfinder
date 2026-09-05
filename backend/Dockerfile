FROM python:3.12-slim

# ngspice runs in batch mode (-b) for every /measure call -- no GUI/X11
# needed, so this stays a small dependency. kicad-cli is NOT installed here:
# it's only used by the /import endpoint to regenerate map.json/faults.json,
# and the deployed image ships those already-generated per-device files
# (see devices/ copied below) instead of regenerating them at runtime.
RUN apt-get update \
    && apt-get install -y --no-install-recommends ngspice \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY backend/requirements.txt backend/requirements.txt
RUN pip install --no-cache-dir -r backend/requirements.txt

COPY backend/app backend/app
COPY devices devices

ENV PYTHONUNBUFFERED=1
EXPOSE 8000

WORKDIR /app/backend
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
