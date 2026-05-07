"""LangGraph pipeline with agentic supervisor loop."""
from langgraph.graph import StateGraph, END
from agents.state import AgentState
from agents.nodes import (
    node_run_dge,
    node_dge_retry,
    node_pathway_enrichment,
    node_supervisor,
    node_enrich_ppi,
    node_literature_rag,
    node_drug_annotation,
    node_depmap_query,
    node_opentargets_query,
    node_synthesize_hypotheses,
    node_generate_report,
)


# ── Routing functions ─────────────────────────────────────────────────────────

def _route_after_dge(state: AgentState) -> str:
    if state.get("status") == "dge_failed":
        return "end"
    # If fewer than 10 significant genes on first attempt, retry with lenient threshold
    if len(state.get("top_genes", [])) < 10 and state.get("dge_attempt", 1) < 2:
        return "dge_retry"
    return "pathway_enrichment"


def _route_after_dge_retry(state: AgentState) -> str:
    if state.get("status") == "dge_failed":
        return "end"
    return "pathway_enrichment"


def _route_supervisor(state: AgentState) -> str:
    """The supervisor's decision determines the next node."""
    next_step = state.get("next_step", "finalize")
    valid = {"enrich_ppi", "literature_rag", "drug_annotation",
             "depmap_query", "opentargets_query", "finalize"}
    return next_step if next_step in valid else "finalize"


# ── Graph construction ────────────────────────────────────────────────────────

def build_graph() -> StateGraph:
    g = StateGraph(AgentState)

    # Pipeline nodes
    g.add_node("run_dge",               node_run_dge)
    g.add_node("dge_retry",             node_dge_retry)
    g.add_node("pathway_enrichment",    node_pathway_enrichment)

    # Supervisor + its worker nodes
    g.add_node("supervisor",            node_supervisor)
    g.add_node("enrich_ppi",            node_enrich_ppi)
    g.add_node("literature_rag",        node_literature_rag)
    g.add_node("drug_annotation",       node_drug_annotation)
    g.add_node("depmap_query",          node_depmap_query)
    g.add_node("opentargets_query",     node_opentargets_query)

    # Synthesis + report
    g.add_node("synthesize_hypotheses", node_synthesize_hypotheses)
    g.add_node("generate_report",       node_generate_report)

    # ── Entry ──────────────────────────────────────────────────────────────
    g.set_entry_point("run_dge")

    # ── DGE → optional retry → pathway ────────────────────────────────────
    g.add_conditional_edges(
        "run_dge",
        _route_after_dge,
        {"dge_retry": "dge_retry", "pathway_enrichment": "pathway_enrichment", "end": END},
    )
    g.add_conditional_edges(
        "dge_retry",
        _route_after_dge_retry,
        {"pathway_enrichment": "pathway_enrichment", "end": END},
    )

    # ── Pathway → supervisor (first entry into the loop) ──────────────────
    g.add_edge("pathway_enrichment", "supervisor")

    # ── Every worker returns to supervisor ────────────────────────────────
    g.add_edge("enrich_ppi",        "supervisor")
    g.add_edge("literature_rag",    "supervisor")
    g.add_edge("drug_annotation",   "supervisor")
    g.add_edge("depmap_query",      "supervisor")
    g.add_edge("opentargets_query", "supervisor")

    # ── Supervisor decides next step ──────────────────────────────────────
    g.add_conditional_edges(
        "supervisor",
        _route_supervisor,
        {
            "enrich_ppi":        "enrich_ppi",
            "literature_rag":    "literature_rag",
            "drug_annotation":   "drug_annotation",
            "depmap_query":      "depmap_query",
            "opentargets_query": "opentargets_query",
            "finalize":          "synthesize_hypotheses",
        },
    )

    # ── Synthesis → report → done ─────────────────────────────────────────
    g.add_edge("synthesize_hypotheses", "generate_report")
    g.add_edge("generate_report", END)

    return g.compile()


_pipeline = None


def get_pipeline():
    global _pipeline
    if _pipeline is None:
        _pipeline = build_graph()
    return _pipeline
