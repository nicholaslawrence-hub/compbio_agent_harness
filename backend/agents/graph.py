"""LangGraph pipeline: Plan → Execute → Analyze → Revise (cyclical)."""
from langgraph.graph import StateGraph, END
from agents.state import AgentState
from agents.nodes import (
    node_run_dge,
    node_enrich_ppi,
    node_literature_rag,
    node_drug_annotation,
    node_synthesize_hypotheses,
    node_generate_report,
)


def _route_after_dge(state: AgentState) -> str:
    if state.get("status") == "dge_failed":
        return "end"
    return "enrich_ppi"


def build_graph() -> StateGraph:
    g = StateGraph(AgentState)

    g.add_node("run_dge", node_run_dge)
    g.add_node("enrich_ppi", node_enrich_ppi)
    g.add_node("literature_rag", node_literature_rag)
    g.add_node("drug_annotation", node_drug_annotation)
    g.add_node("synthesize_hypotheses", node_synthesize_hypotheses)
    g.add_node("generate_report", node_generate_report)

    g.set_entry_point("run_dge")
    g.add_conditional_edges("run_dge", _route_after_dge, {"enrich_ppi": "enrich_ppi", "end": END})
    g.add_edge("enrich_ppi", "literature_rag")
    g.add_edge("literature_rag", "drug_annotation")
    g.add_edge("drug_annotation", "synthesize_hypotheses")
    g.add_edge("synthesize_hypotheses", "generate_report")
    g.add_edge("generate_report", END)

    return g.compile()


# Singleton compiled graph
pipeline = build_graph()
