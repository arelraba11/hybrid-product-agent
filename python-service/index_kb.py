import os
from pathlib import Path
from typing import Dict, Union
from uuid import uuid4

import chromadb
from sentence_transformers import SentenceTransformer

EMBEDDING_MODEL = os.getenv("EMBEDDING_MODEL", "sentence-transformers/all-MiniLM-L6-v2")
CHROMA_DIR = os.getenv("CHROMA_DIR", "./chroma_db")
CHROMA_COLLECTION = os.getenv("CHROMA_COLLECTION", "products_kb")
DATA_DIR = Path(os.getenv("PRODUCT_DATA_DIR", "../data/products")).resolve()


def chunk_text(text: str, chunk_size_words: int = 220, overlap_words: int = 40) -> list[str]:
    words = text.split()
    if not words:
        return []

    chunks: list[str] = []
    step = max(chunk_size_words - overlap_words, 1)

    for start in range(0, len(words), step):
        chunk_words = words[start : start + chunk_size_words]
        if not chunk_words:
            continue
        chunks.append(" ".join(chunk_words))
        if start + chunk_size_words >= len(words):
            break

    return chunks


def stem_to_product_name(stem: str) -> str:
    return stem.replace("_", " ").replace("-", " ").strip().lower()


def main() -> None:
    print(f"[index_kb] Loading embedding model: {EMBEDDING_MODEL}")
    embedder = SentenceTransformer(EMBEDDING_MODEL)

    print(f"[index_kb] Connecting Chroma: {CHROMA_DIR} / {CHROMA_COLLECTION}")
    client = chromadb.PersistentClient(path=CHROMA_DIR)

    # Reset collection for clean reproducible indexing
    try:
        client.delete_collection(CHROMA_COLLECTION)
    except Exception:
        pass

    collection = client.get_or_create_collection(CHROMA_COLLECTION)

    if not DATA_DIR.exists():
        raise FileNotFoundError(f"Product data directory not found: {DATA_DIR}")

    files = sorted(DATA_DIR.glob("*.txt"))
    if not files:
        raise RuntimeError(f"No .txt files found in {DATA_DIR}")

    all_docs: list[str] = []
    all_ids: list[str] = []
    all_meta: list[Dict[str, Union[str, int]]] = []

    for file_path in files:
        text = file_path.read_text(encoding="utf-8")
        chunks = chunk_text(text)
        product_name = stem_to_product_name(file_path.stem)

        print(f"[index_kb] {file_path.name}: {len(chunks)} chunks")

        for idx, chunk in enumerate(chunks, start=1):
            all_docs.append(chunk)
            all_ids.append(str(uuid4()))
            all_meta.append(
                {
                    "source_file": file_path.name,
                    "product_name": product_name,
                    "chunk_index": idx,
                }
            )

    print(f"[index_kb] Encoding {len(all_docs)} chunks...")
    embeddings = embedder.encode(all_docs).tolist()

    collection.add(
        ids=all_ids,
        documents=all_docs,
        metadatas=all_meta,
        embeddings=embeddings,
    )

    print("[index_kb] Done.")
    print(f"[index_kb] Indexed chunks: {len(all_docs)}")


if __name__ == "__main__":
    main()
