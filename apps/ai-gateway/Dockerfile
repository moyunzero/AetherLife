FROM python:3.12-slim

WORKDIR /app

COPY apps/ai-gateway/pyproject.toml .
COPY apps/ai-gateway/app ./app

RUN pip install --no-cache-dir fastapi "uvicorn[standard]"

EXPOSE 8000

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
