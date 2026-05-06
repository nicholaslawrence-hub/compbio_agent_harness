"""
Create the Pinecone dense index with integrated inference.
Run once before first use: python scripts/setup_pinecone.py

Pinecone embeds text fields automatically — no embedding model to manage locally.
"""
import sys
from pathlib import Path
from pinecone import Pinecone

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from backend.config import settings

if not settings.pinecone_api_key:
    print("ERROR: PINECONE_API_KEY is not set in backend/.env")
    sys.exit(1)

pc = Pinecone(api_key=settings.pinecone_api_key)

existing = [idx["name"] for idx in pc.list_indexes()]
print(f"Existing indexes: {existing}")

if settings.pinecone_index_name in existing:
    print(f"Index '{settings.pinecone_index_name}' already exists — skipping creation.")
else:
    print(f"Creating dense index '{settings.pinecone_index_name}' with integrated inference...")
    pc.create_index_for_model(
        name=settings.pinecone_index_name,
        cloud="aws",
        region="us-east-1",
        embed={
            "model": "llama-text-embed-v2",
            "field_map": {"text": "text"},
        },
    )
    print("Index created.")

index = pc.Index(settings.pinecone_index_name)
print(f"\nIndex stats: {index.describe_index_stats()}")
print(f"\nReady. Namespace: '{settings.pinecone_namespace}'")
print("The pipeline will upsert abstracts automatically on first run.")
