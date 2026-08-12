FROM python:3.11-slim

WORKDIR /app

COPY . /app

RUN pip install --no-cache-dir -r backend/requirements.txt

ENV PYTHONUNBUFFERED=1
ENV DATABASE_PATH=/app/data/holysmokes.db

EXPOSE 8000

CMD uvicorn main:app --host 0.0.0.0 --port ${PORT:-8000}
