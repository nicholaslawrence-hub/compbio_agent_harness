from dotenv import load_dotenv
from pydantic_settings import BaseSettings
from pathlib import Path

load_dotenv(Path(__file__).resolve().parent / ".env")


class Settings(BaseSettings):
    openai_api_key: str = ""
    ncbi_api_key: str = ""
    ncbi_email: str = "user@example.com"
    pinecone_api_key: str = ""
    pinecone_index_name: str = "pharmagpt-literature"
    pinecone_namespace: str = "abstracts"

    data_dir: Path = Path("/tmp/pharmagt")
    raw_dir: Path = Path("/tmp/pharmagt/raw")
    processed_dir: Path = Path("/tmp/pharmagt/processed")
    results_dir: Path = Path("/tmp/pharmagt/results")

    max_genes_for_rag: int = 20
    pubmed_max_results: int = 5
    llm_model: str = "gpt-4o"
    llm_temperature: float = 0.2

    class Config:
        env_file = ".env"
        env_file_encoding = "utf-8"


settings = Settings()

for d in [settings.raw_dir, settings.processed_dir, settings.results_dir]:
    d.mkdir(parents=True, exist_ok=True)
