"""
Verbose sanity test — exercises every node and every DB call individually
before running the full pipeline, so breakages are easy to pinpoint.

Run from backend/:  python sanity_test.py
"""
import sys, os, json, time, traceback
sys.path.insert(0, os.path.dirname(__file__))

from pathlib import Path
from dotenv import load_dotenv
load_dotenv(Path(__file__).resolve().parents[1] / ".env")

from config import settings

SEP  = "=" * 60
SEP2 = "-" * 50
OK   = "[OK]"
FAIL = "[FAIL]"

def section(title: str):
    print(f"\n{SEP}\n  {title}\n{SEP}")

def sub(title: str):
    print(f"\n{SEP2}\n  {title}\n{SEP2}")

# ── Sample data ────────────────────────────────────────────────────────────────
DATA_DIR   = Path(__file__).resolve().parents[1] / "data"
MATRIX     = str(DATA_DIR / "drug_target_counts.tsv")
DISEASE    = "Glioblastoma"
CONDITIONS = {
    "D1": "disease", "D2": "disease", "D3": "disease", "D4": "disease",
    "C1": "control",  "C2": "control",  "C3": "control",  "C4": "control",
}
CONDITION_A = "disease"
CONDITION_B = "control"

# Well-known targets that should definitely have ChEMBL hits
PROBE_GENES = ["EGFR", "MMP9", "VEGFA", "BRAF", "KRAS"]

# ── 1. DGE ─────────────────────────────────────────────────────────────────────
section("1. Differential Gene Expression")
try:
    from tools.dge import parse_count_matrix_from_upload, run_dge, top_upregulated
    content = Path(MATRIX).read_bytes()
    matrix  = parse_count_matrix_from_upload(content, Path(MATRIX).name)
    dge_df  = run_dge(matrix, CONDITIONS, CONDITION_A, CONDITION_B)
    top_df  = top_upregulated(dge_df, n=10)
    top_genes = top_df["gene"].tolist()
    print(f"{OK} DGE completed — {len(top_genes)} top genes: {top_genes}")
    print(top_df[["gene","log2FoldChange","padj"]].to_string(index=False))
except Exception as e:
    print(f"{FAIL} DGE FAILED: {e}")
    traceback.print_exc()
    sys.exit(1)

# ── 2. PPI ─────────────────────────────────────────────────────────────────────
section("2. PPI Network (STRING)")
for gene in PROBE_GENES[:3]:
    try:
        from tools.ppi import get_ppi_network, enrich_ppi_with_oncogenes, KNOWN_ONCOGENES
        result = get_ppi_network(gene)
        enriched = enrich_ppi_with_oncogenes(result, KNOWN_ONCOGENES)
        partners = enriched.get("partners", [])
        names    = [p["partner"] for p in partners[:5]]
        onco     = [p["partner"] for p in partners if p.get("is_oncogene")]
        print(f"{OK} {gene}: {len(partners)} partners, top5={names}, oncogene_partners={onco[:5]}")
    except Exception as e:
        print(f"{FAIL} {gene} PPI FAILED: {e}")

# ── 3. ChEMBL ──────────────────────────────────────────────────────────────────
section("3. ChEMBL Drug Interactions")
for gene in PROBE_GENES:
    try:
        from db.chembl import get_drug_interactions
        result = get_drug_interactions(gene)
        drugs  = result.get("drugs", [])
        note   = result.get("query_note", "")
        found  = result.get("query_found_target", False)
        if drugs:
            top = drugs[0]
            print(f"{OK} {gene}: {len(drugs)} drugs — top: {top['molecule_name']} "
                  f"(phase={top['max_phase']}, pChEMBL={top['pchembl_value']})")
        elif found:
            print(f"~ {gene}: target found but no compounds passed filter. {note}")
        else:
            print(f"{FAIL} {gene}: {note}")
    except Exception as e:
        print(f"{FAIL} {gene} ChEMBL FAILED: {e}")
        traceback.print_exc()

# ── 4. DepMap ─────────────────────────────────────────────────────────────────
section("4. DepMap CRISPR Essentiality")
for gene in PROBE_GENES[:4]:
    try:
        from db.depmap import get_gene_essentiality
        result = get_gene_essentiality(gene)
        if result.get("error"):
            print(f"~ {gene}: {result['error']}")
        else:
            print(f"{OK} {gene}: pct_dependent={result.get('percent_dependent')}%, "
                  f"common_essential={result.get('is_common_essential')}, "
                  f"selective={result.get('is_strongly_selective')}")
    except Exception as e:
        print(f"{FAIL} {gene} DepMap FAILED: {e}")
        traceback.print_exc()

# ── 5. OpenTargets ────────────────────────────────────────────────────────────
section("5. OpenTargets Disease Association")
for gene in PROBE_GENES[:4]:
    try:
        from db.opentargets import get_ot_association
        result = get_ot_association(gene, DISEASE)
        if result.get("error"):
            print(f"~ {gene}: {result['error']}")
        else:
            print(f"{OK} {gene}: overall={result['overall_score']:.4f} | "
                  f"genetic={result['genetic_association']:.3f} "
                  f"somatic={result['somatic_mutation']:.3f} "
                  f"drug={result['known_drug']:.3f} "
                  f"lit={result['literature']:.3f}")
    except Exception as e:
        print(f"{FAIL} {gene} OpenTargets FAILED: {e}")
        traceback.print_exc()

# ── 6. Pinecone RAG ───────────────────────────────────────────────────────────
section("6. Pinecone Literature RAG")
for gene in PROBE_GENES[:3]:
    try:
        from db.pinecone_rag import query_literature
        result = query_literature(gene, context=f"Disease: {DISEASE}.")
        err = result.get("error")
        if err:
            print(f"{FAIL} {gene}: {err}")
        else:
            print(f"{OK} {gene}: pubmed_hits={result['pubmed_hits']}, "
                  f"is_dark={result['is_dark']}, "
                  f"key_pmids={result['key_pmids'][:3]}")
    except Exception as e:
        print(f"{FAIL} {gene} Pinecone RAG FAILED: {e}")
        traceback.print_exc()

# ── 7. UniProt ────────────────────────────────────────────────────────────────
section("7. UniProt Protein Annotation")
for gene in PROBE_GENES[:3]:
    try:
        from db.uniprot import search_protein
        result = search_protein(gene)
        if result:
            print(f"{OK} {gene}: {result.get('name','?')} | function: {str(result.get('function',''))[:80]}...")
        else:
            print(f"~ {gene}: not found")
    except Exception as e:
        print(f"{FAIL} {gene} UniProt FAILED: {e}")

# ── 8. Full pipeline run ───────────────────────────────────────────────────────
section("8. Full Pipeline (LangGraph)")
from agents.graph import get_pipeline
from agents.state import AgentState

initial_state: AgentState = {
    "count_matrix_path":     MATRIX,
    "disease_term":          DISEASE,
    "sample_conditions":     CONDITIONS,
    "condition_a":           CONDITION_A,
    "condition_b":           CONDITION_B,
    "supervisor_context":    [],
    "supervisor_iterations": 0,
    "top_genes":             [],
    "pruned_genes":          [],
    "errors":                [],
    "progress":              0,
    "status":                "queued",
}

pipeline = get_pipeline()
t0 = time.time()
accumulated: dict = dict(initial_state)

for step in pipeline.stream(initial_state):
    node = list(step.keys())[0]
    data = step[node]
    accumulated.update(data)

    status   = data.get("status", "")
    progress = data.get("progress", "")
    errors   = data.get("errors", [])
    top_g    = data.get("top_genes", accumulated.get("top_genes", []))

    print(f"\n[{node}] status={status} progress={progress}%  top_genes={top_g}")

    # Supervisor context entries (decision + tool summaries)
    for entry in data.get("supervisor_context", []):
        print(f"  SUPERVISOR [{entry.get('step','?')}]: {entry.get('summary','')[:140]}")

    # Per-step detailed output
    if node == "run_dge":
        print(f"  DGE genes: {data.get('top_genes', [])}")

    elif node == "enrich_ppi":
        for r in data.get("ppi_results", []):
            partners = [p['partner'] for p in r.get('partners', [])]
            onco     = [p['partner'] for p in r.get('partners', []) if p.get('is_oncogene')]
            print(f"  PPI {r['gene']}: {len(partners)} partners, oncogene_partners={onco}")

    elif node == "depmap_query":
        for r in data.get("depmap_results", []):
            print(f"  DEPMAP {r['gene']}: pct_dep={r.get('percent_dependent')}% "
                  f"common_essential={r.get('is_common_essential')} "
                  f"selective={r.get('is_strongly_selective')} "
                  f"err={r.get('error')}")

    elif node == "opentargets_query":
        for r in data.get("opentargets_results", []):
            print(f"  OT {r['gene']}: score={r.get('overall_score',0):.4f} "
                  f"drug={r.get('known_drug',0):.3f} "
                  f"somatic={r.get('somatic_mutation',0):.3f} "
                  f"err={r.get('error')}")

    elif node == "literature_rag":
        for r in data.get("literature_results", []):
            if r:
                print(f"  LIT {r.get('gene','?')}: hits={r.get('pubmed_hits',0)} "
                      f"dark={r.get('is_dark')} pmids={r.get('key_pmids',[][:3])}")

    elif node == "drug_annotation":
        for r in data.get("drug_results", []):
            drugs = r.get("drugs", [])
            print(f"  DRUG {r.get('gene','?')}: found_target={r.get('query_found_target')} "
                  f"n_drugs={len(drugs)} "
                  f"top={drugs[0]['molecule_name'] if drugs else 'none'}")

    elif node == "synthesize_hypotheses":
        for h in data.get("hypotheses", []):
            print(f"  HYP {h['gene']}: novelty={h.get('novelty_score','?')} "
                  f"pub_count={h.get('pub_count','?')}")
            print(f"       {str(h.get('hypothesis',''))[:120]}...")

    elif node == "generate_report":
        report = data.get("final_report", "")
        print(f"  REPORT ({len(report)} chars) preview: {report[:200]}...")

    if errors:
        print(f"  !! ERRORS: {errors}")

elapsed = time.time() - t0
print(f"\n{SEP}")
print(f"Completed in {elapsed:.1f}s")
print(f"Final top_genes: {accumulated.get('top_genes', [])}")
print(f"Pruned genes:    {accumulated.get('pruned_genes', [])}")
hyps = accumulated.get("hypotheses", [])
print(f"Hypotheses:      {len(hyps)}")
for h in hyps:
    print(f"  {h['gene']}: novelty={h.get('novelty_score','?')} pub_count={h.get('pub_count','?')}")
    print(f"    {str(h.get('hypothesis',''))[:140]}...")
