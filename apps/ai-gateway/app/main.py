from fastapi import FastAPI

app = FastAPI(title="aetherlife-ai-gateway")


@app.get("/health")
def health():
    return {"status": "ok", "service": "ai-gateway"}
