import os
import time
from typing import Any, Dict, Optional, Union

import chromadb
from fastapi import FastAPI
from pydantic import BaseModel, Field
from sentence_transformers import SentenceTransformer
from transformers import pipeline

"""
FastAPI microservice for:
1) Sentiment analysis (assignment 4 continuity)
2) Product KB retrieval (RAG retrieval stage)

Run:
    uvicorn server:app --host 0.0.0.0 --port 8000
"""

MODEL_NAME = os.getenv("HF_MODEL", "distilbert-base-uncased-finetuned-sst-2-english")
EMBEDDING_MODEL = os.getenv("EMBEDDING_MODEL", "sentence-transformers/all-MiniLM-L6-v2")
CHROMA_DIR = os.getenv("CHROMA_DIR", "./chroma_db")
CHROMA_COLLECTION = os.getenv("CHROMA_COLLECTION", "products_kb")

app = FastAPI(title="Hybrid Python Service", version="2.0.0")

# Load ML models once
classifier = pipeline("sentiment-analysis", model=MODEL_NAME)
embedder = SentenceTransformer(EMBEDDING_MODEL)

# Chroma setup
chroma_client = chromadb.PersistentClient(path=CHROMA_DIR)
collection = chroma_client.get_or_create_collection(name=CHROMA_COLLECTION)


class ReviewRequest(BaseModel):
    text: str


class SearchKbRequest(BaseModel):
    query: str
    product_name: Optional[str] = None
    top_k: int = Field(default=4, ge=1, le=10)


@app.get("/health")
def health() -> dict[str, Any]:
    return {
        "ok": True,
        "collection": CHROMA_COLLECTION,
        "collection_size": collection.count(),
    }


@app.post("/analyze")
def analyze_sentiment(request: ReviewRequest) -> Dict[str, Union[float, str, int]]:
    t0 = time.perf_counter()
    result = classifier(request.text)[0]
    elapsed_ms = int((time.perf_counter() - t0) * 1000)
    return {
        "sentiment": result["label"],
        "confidence": float(result["score"]),
        "latency_ms": elapsed_ms,
    }


@app.post("/search_kb")
def search_kb(request: SearchKbRequest) -> dict[str, Any]:
    if collection.count() == 0:
        return {
            "chunks": [],
            "warning": "Knowledge base index is empty. Run index_kb.py first.",
        }

    t0 = time.perf_counter()
    query_embedding = embedder.encode(request.query).tolist()

    where = None
    if request.product_name:
        where = {"product_name": request.product_name.lower().strip()}

    result = collection.query(
        query_embeddings=[query_embedding],
        n_results=request.top_k,
        where=where,
        include=["documents", "metadatas", "distances"],
    )

    docs = result.get("documents", [[]])[0]
    metas = result.get("metadatas", [[]])[0]
    distances = result.get("distances", [[]])[0]

    # If strict product filter returned nothing, retry globally.
    if where and not docs:
        result = collection.query(
            query_embeddings=[query_embedding],
            n_results=request.top_k,
            include=["documents", "metadatas", "distances"],
        )

        docs = result.get("documents", [[]])[0]
        metas = result.get("metadatas", [[]])[0]
        distances = result.get("distances", [[]])[0]

    chunks: list[dict[str, Any]] = []
    for i, text in enumerate(docs):
        chunks.append(
            {
                "text": text,
                "metadata": metas[i] if i < len(metas) else {},
                "distance": distances[i] if i < len(distances) else None,
            }
        )

    elapsed_ms = int((time.perf_counter() - t0) * 1000)
    return {"chunks": chunks, "latency_ms": elapsed_ms}
