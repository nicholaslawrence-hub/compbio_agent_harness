"""OpenTargets Platform API — disease-gene association scores via GraphQL."""
import requests
from functools import lru_cache

_GQL_URL = "https://api.platform.opentargets.org/api/v4/graphql"
_TIMEOUT  = 20

# ── GraphQL queries ────────────────────────────────────────────────────────────

_SEARCH_Q = """
query Search($q: String!, $entities: [String!]!) {
  search(queryString: $q, entityNames: $entities, page: {index: 0, size: 3}) {
    hits {
      id
      name
      entity
    }
  }
}
"""

# Get up to 200 associated diseases for a target, we filter client-side for the
# disease we care about.  200 covers even the most disease-promiscuous genes.
_ASSOC_Q = """
query TargetAssociations($ensemblId: String!) {
  target(ensemblId: $ensemblId) {
    approvedSymbol
    approvedName
    associatedDiseases(enableIndirect: true, size: 200) {
      rows {
        disease {
          id
          name
        }
        score
        datatypeScores {
          id
          score
        }
      }
    }
  }
}
"""


# ── Helpers ────────────────────────────────────────────────────────────────────

def _gql(query: str, variables: dict) -> dict:
    r = requests.post(
        _GQL_URL,
        json={"query": query, "variables": variables},
        headers={"Content-Type": "application/json"},
        timeout=_TIMEOUT,
    )
    r.raise_for_status()
    return r.json().get("data", {})


@lru_cache(maxsize=512)
def _resolve_target(gene_symbol: str) -> str | None:
    """Resolve a gene symbol to its Ensembl ID via the OpenTargets search API."""
    try:
        data = _gql(_SEARCH_Q, {"q": gene_symbol, "entities": ["target"]})
        for hit in data.get("search", {}).get("hits", []):
            if hit.get("entity") == "target":
                return hit["id"]
    except Exception:
        pass
    return None


@lru_cache(maxsize=128)
def _resolve_disease(disease_name: str) -> tuple[str | None, str | None]:
    """
    Resolve a disease name to its EFO ID and canonical name.
    Returns (efo_id, canonical_name) or (None, None).
    """
    try:
        data = _gql(_SEARCH_Q, {"q": disease_name, "entities": ["disease"]})
        hits = data.get("search", {}).get("hits", [])
        if hits:
            return hits[0]["id"], hits[0]["name"]
    except Exception:
        pass
    return None, None


# ── Public API ─────────────────────────────────────────────────────────────────

def get_ot_association(gene_symbol: str, disease_name: str) -> dict:
    """
    Return the OpenTargets association score between a gene and a disease.

    Score interpretation:
      0.00–0.10  No meaningful evidence — genuine white space
      0.10–0.35  Low evidence (animal models or limited genetics only)
      0.35–0.65  Moderate evidence (some genetic + pathway data)
      0.65–1.00  Strong evidence (drugs, GWAS, somatic mutations)

    Datatype score breakdown:
      genetic_association  — GWAS hits, rare variant burden tests
      somatic_mutation     — COSMIC hotspots, cancer driver annotations
      known_drug           — approved or clinical-stage drugs for this target
      affected_pathway     — target falls in a disease-relevant pathway (MSigDB/Reactome)
      literature           — co-mention frequency in PubMed
      rna_expression       — differential expression evidence (GTEx, TCGA, etc.)
      animal_model         — mouse/zebrafish knockout phenotypes
    """
    symbol = gene_symbol.strip().upper()

    ensembl_id          = _resolve_target(symbol)
    efo_id, disease_can = _resolve_disease(disease_name)

    if not ensembl_id:
        return _blank(symbol, disease_name, f"'{symbol}' not found in OpenTargets")
    if not efo_id:
        return _blank(symbol, disease_name, f"Disease '{disease_name}' not found in OpenTargets")

    try:
        data = _gql(_ASSOC_Q, {"ensemblId": ensembl_id})
        rows = (
            data.get("target", {})
            .get("associatedDiseases", {})
            .get("rows", [])
        )

        # Find our disease in the returned associations
        for row in rows:
            if row.get("disease", {}).get("id") == efo_id:
                dt = {ds["id"]: round(ds["score"], 4) for ds in row.get("datatypeScores", [])}
                return {
                    "gene":                symbol,
                    "disease":             disease_can or disease_name,
                    "overall_score":       round(row["score"], 4),
                    "genetic_association": dt.get("genetic_association", 0.0),
                    "somatic_mutation":    dt.get("somatic_mutation",    0.0),
                    "known_drug":          dt.get("known_drug",          0.0),
                    "affected_pathway":    dt.get("affected_pathway",    0.0),
                    "literature":          dt.get("literature",          0.0),
                    "rna_expression":      dt.get("rna_expression",      0.0),
                    "animal_model":        dt.get("animal_model",        0.0),
                    "ensembl_id":          ensembl_id,
                    "efo_id":              efo_id,
                    "source":              "opentargets",
                    "error":               None,
                }

        # Gene resolves fine but has no association with this disease → score 0
        return {
            **_blank(symbol, disease_can or disease_name, None),
            "ensembl_id": ensembl_id,
            "efo_id":     efo_id,
        }

    except Exception as e:
        return _blank(symbol, disease_name, str(e))


def _blank(gene: str, disease: str, error: str | None) -> dict:
    return {
        "gene":                gene,
        "disease":             disease,
        "overall_score":       0.0,
        "genetic_association": 0.0,
        "somatic_mutation":    0.0,
        "known_drug":          0.0,
        "affected_pathway":    0.0,
        "literature":          0.0,
        "rna_expression":      0.0,
        "animal_model":        0.0,
        "ensembl_id":          None,
        "efo_id":              None,
        "source":              "opentargets",
        "error":               error,
    }
