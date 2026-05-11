"""LangGraph construction for default and visual-builder RNAgent networks."""
from __future__ import annotations

from collections import defaultdict
from typing import Any, Callable

from langgraph.graph import END, StateGraph

from agents.state import AgentState
from agents.runtime import (
    HEAVY_NODE_TYPES,
    dispatch_external_task,
    provenance_event,
    scoped_patch,
)
from agents.nodes import (
    critic_microenvironment_validity,
    critic_red_team_fda,
    critic_structural_tractability,
    node_clinical_trials,
    node_critic,
    node_depmap_query,
    node_dge_retry,
    node_drug_annotation,
    node_evo2_fitness,
    node_esm3_design,
    node_enrich_ppi,
    node_generate_report,
    node_alphafold_complex,
    node_crispr_designer,
    node_lincs_reversion,
    node_literature_rag,
    node_gnina_docking,
    node_mageck_crispr,
    node_opentargets_query,
    node_pharmacogenomics_pgx,
    node_pathway_crosstalk,
    node_pathway_enrichment,
    node_rdkit_features,
    node_reinvent_generative,
    node_run_dge,
    node_scenic_regulon,
    node_spatial_tme,
    node_study_context,
    node_supervisor,
    node_synthesize_hypotheses,
    node_tcga_survival,
    node_viper_protein_activity,
)


def node_sync_gateway(state: AgentState) -> dict:
    """Explicit join node for branches that must both complete before advancing."""
    topology = state.get("network_topology", {}) or {}
    current = state.get("active_node_id", "") or state.get("current_node_id", "")
    incoming = [
        edge.get("source")
        for edge in topology.get("edges", [])
        if edge.get("target") == current
    ]
    node_status = state.get("node_status", {}) or {}
    def _done(status: str | None) -> bool:
        return bool(status) and status not in {"queued", "running", "pending_external_worker", "awaiting_approval", "sync_waiting"}

    waiting = [node_id for node_id in incoming if not _done(node_status.get(node_id))]
    return {
        "sync_ready": not waiting,
        "status": "sync_waiting" if waiting else "sync_complete",
        "progress": state.get("progress", 0),
        "supervisor_context": [{
            "step": "sync_gateway",
            "subquery": current,
            "summary": f"Gateway waiting on: {waiting}" if waiting else "All upstream branches completed.",
        }],
    }


def node_approval_gate(state: AgentState) -> dict:
    """Human approval breakpoint before expensive or irreversible work."""
    node_id = state.get("active_node_id") or state.get("current_node_id") or "approval_gate"
    existing = (state.get("approval_requests", {}) or {}).get(node_id, {})
    if existing.get("decision") in {"approved", "rejected"}:
        return {
            "approval_requests": {
                **(state.get("approval_requests", {}) or {}),
                node_id: {**existing, "status": "resolved"},
            },
            "status": "approval_resolved",
            "progress": state.get("progress", 0),
            "supervisor_context": [{
                "step": "approval_gate",
                "subquery": node_id,
                "summary": f"Human decision captured: {existing.get('decision')}.",
            }],
        }
    request = {
        "node_id": node_id,
        "status": "awaiting_user_approval",
        "summary": "Approval required before crossing into expensive chemistry or GPU work.",
        "options": ["approve", "reject_and_reroute"],
    }
    return {
        "approval_requests": {
            **(state.get("approval_requests", {}) or {}),
            node_id: request,
        },
        "status": "awaiting_approval",
        "progress": state.get("progress", 0),
        "supervisor_context": [{
            "step": "approval_gate",
            "subquery": node_id,
            "summary": request["summary"],
        }],
    }


NODE_IMPLS: dict[str, Callable[[AgentState], dict]] = {
    "count_matrix_input": node_study_context,
    "clinical_metadata": node_study_context,
    "sync_gateway": node_sync_gateway,
    "approval_gate": node_approval_gate,
    "translator": node_study_context,
    "study_context": node_study_context,
    "run_dge": node_run_dge,
    "dge_retry": node_dge_retry,
    "pathway_enrichment": node_pathway_enrichment,
    "pathway_crosstalk": node_pathway_crosstalk,
    "supervisor": node_supervisor,
    "critic": node_critic,
    "enrich_ppi": node_enrich_ppi,
    "literature_rag": node_literature_rag,
    "drug_annotation": node_drug_annotation,
    "depmap_query": node_depmap_query,
    "opentargets_query": node_opentargets_query,
    "clinical_trials": node_clinical_trials,
    "evo2_fitness": node_evo2_fitness,
    "esm3_design": node_esm3_design,
    "scenic_regulon": node_scenic_regulon,
    "spatial_tme": node_spatial_tme,
    "lincs_reversion": node_lincs_reversion,
    "tcga_survival": node_tcga_survival,
    "pharmacogenomics_pgx": node_pharmacogenomics_pgx,
    "crispr_designer": node_crispr_designer,
    "alphafold_complex": node_alphafold_complex,
    "viper_protein_activity": node_viper_protein_activity,
    "mageck_crispr": node_mageck_crispr,
    "reinvent_generative": node_reinvent_generative,
    "gnina_docking": node_gnina_docking,
    "rdkit_features": node_rdkit_features,
    "critic_structural_tractability": critic_structural_tractability,
    "critic_microenvironment_validity": critic_microenvironment_validity,
    "critic_red_team_fda": critic_red_team_fda,
    "synthesize_hypotheses": node_synthesize_hypotheses,
    "generate_report": node_generate_report,
}

ALIASES = {
    "report": "generate_report",
    "exit_report": "generate_report",
}


def _route_after_dge(state: AgentState) -> str:
    if state.get("status") == "dge_failed":
        return "end"
    if len(state.get("top_genes", [])) < 10 and state.get("dge_attempt", 1) < 2:
        return "dge_retry"
    return "pathway_enrichment"


def _route_after_dge_retry(state: AgentState) -> str:
    if state.get("status") == "dge_failed":
        return "end"
    return "pathway_enrichment"


def _route_supervisor(state: AgentState) -> str:
    next_step = state.get("next_step", "finalize")
    valid = {
        "enrich_ppi",
        "literature_rag",
        "drug_annotation",
        "depmap_query",
        "opentargets_query",
        "clinical_trials",
        "pathway_crosstalk",
        "evo2_fitness",
        "esm3_design",
        "scenic_regulon",
        "spatial_tme",
        "lincs_reversion",
        "tcga_survival",
        "pharmacogenomics_pgx",
        "crispr_designer",
        "alphafold_complex",
        "viper_protein_activity",
        "mageck_crispr",
        "reinvent_generative",
        "gnina_docking",
        "rdkit_features",
        "finalize",
    }
    return next_step if next_step in valid else "finalize"


def _event_for(node_id: str, node_type: str, state: AgentState, out: dict) -> dict:
    return {
        "node_id": node_id,
        "node_type": node_type,
        "previous_node_id": state.get("previous_node_id", ""),
        "status": out.get("status", state.get("status", "")),
        "progress": out.get("progress", state.get("progress", 0)),
        "summary": (out.get("supervisor_context") or [{}])[-1].get("summary", ""),
    }


def _payload_for(node_id: str, node_type: str, state: AgentState, out: dict) -> dict:
    prompt = ""
    if node_type == "supervisor":
        prompt = state.get("supervisor_reasoning") or "Supervisor reviewed investigation history and selected the next node."
    elif node_type == "critic":
        prompt = "Critic reviewed the latest specialist packet against study goals."
    elif node_type == "study_context":
        prompt = str((out.get("study_context") or state.get("study_context") or {}).get("study_notes", ""))
    else:
        prompt = state.get("supervisor_subquery") or f"Run {node_type} on current top genes."

    data_keys = [
        key for key in (
            "top_genes",
            "pathway_results",
            "ppi_results",
            "literature_results",
            "drug_interactions",
            "depmap_results",
            "opentargets_results",
            "clinical_trials_results",
            "pathway_crosstalk_results",
            "evo2_fitness_results",
            "esm3_design_results",
            "scenic_regulon_results",
            "spatial_tme_results",
            "lincs_reversion_results",
            "tcga_survival_results",
            "pharmacogenomics_pgx_results",
            "crispr_design_results",
            "alphafold_complex_results",
            "viper_protein_activity_results",
            "mageck_crispr_results",
            "reinvent_generative_results",
            "gnina_docking_results",
            "rdkit_feature_results",
            "viper_protein_activity_results",
            "mageck_crispr_results",
            "reinvent_generative_results",
            "gnina_docking_results",
            "hypotheses",
        )
        if key in out
    ]
    return {
        "node_id": node_id,
        "node_type": node_type,
        "prompt": str(prompt)[:900],
        "returned_keys": data_keys,
        "payload_preview": {key: out.get(key) for key in data_keys[:3]},
    }


def _wrap_node(node_id: str, node_type: str, fn: Callable[[AgentState], dict]) -> Callable[[AgentState], dict]:
    def _wrapped(state: AgentState) -> dict:
        state = {**state, "current_node_id": node_id}
        existing_status = (state.get("node_status", {}) or {}).get(node_id)
        complete_statuses = {
            "complete",
            "completed",
            "context_loaded",
            "dge_complete",
            "pathway_complete",
            "ppi_complete",
            "literature_complete",
            "drug_annotation_complete",
            "depmap_complete",
            "opentargets_complete",
            "clinical_trials_complete",
            "pathway_crosstalk_complete",
            "tcga_survival_complete",
            "crispr_design_complete",
            "hypotheses_complete",
            "report_complete",
            "sync_complete",
            "external_complete",
        }
        if existing_status in complete_statuses and node_type not in {"sync_gateway", "approval_gate"}:
            output = {
                "status": "skipped_completed",
                "progress": state.get("progress", 0),
                "supervisor_context": [{
                    "step": node_type,
                    "subquery": node_id,
                    "summary": f"Skipped {node_id}; completed output was restored from checkpoint.",
                }],
            }
            event = _event_for(node_id, node_type, state, output)
            payload = _payload_for(node_id, node_type, state, output)
            scoped = scoped_patch(state, node_id, node_type, output)
            return {
                **output,
                **scoped,
                "previous_node_id": node_id,
                "execution_events": [event],
                "prompt_payloads": [payload],
                "routing_history": [{
                    "node_id": node_id,
                    "node_type": node_type,
                    "previous_node_id": state.get("previous_node_id", ""),
                    "status": "skipped_completed",
                }],
            }
        if node_type in HEAVY_NODE_TYPES and existing_status != "external_complete":
            output = {
                "status": "pending_external_worker",
                "progress": state.get("progress", 0),
                "supervisor_context": [{
                    "step": node_type,
                    "subquery": node_id,
                    "summary": f"{node_type} was dispatched to an external worker queue.",
                }],
            }
            pending = dispatch_external_task(state, node_id, node_type)
            event = _event_for(node_id, node_type, state, output)
            event["task"] = pending["pending_tasks"][node_id]
            payload = _payload_for(node_id, node_type, state, output)
            scoped = scoped_patch(state, node_id, node_type, {**output, **pending})
            provenance = provenance_event(node_id, node_type, state, output)
            return {
                **output,
                **pending,
                **scoped,
                "previous_node_id": node_id,
                "execution_events": [event],
                "prompt_payloads": [payload],
                "provenance_ledger": [provenance],
                "routing_history": [{
                    "node_id": node_id,
                    "node_type": node_type,
                    "previous_node_id": state.get("previous_node_id", ""),
                    "status": "pending_external_worker",
                }],
            }
        out = fn(state)
        event = _event_for(node_id, node_type, state, out)
        payload = _payload_for(node_id, node_type, state, out)
        scoped = scoped_patch(state, node_id, node_type, out)
        provenance = provenance_event(node_id, node_type, state, out)
        return {
            **out,
            **scoped,
            "previous_node_id": node_id,
            "execution_events": [event],
            "prompt_payloads": [payload],
            "provenance_ledger": [provenance],
            "routing_history": [{
                "node_id": node_id,
                "node_type": node_type,
                "previous_node_id": state.get("previous_node_id", ""),
                "status": event["status"],
            }],
        }

    return _wrapped


def _report_node(state: AgentState) -> dict:
    synthesis = node_synthesize_hypotheses(state)
    merged = {**state, **synthesis}
    report = node_generate_report(merged)
    return {**synthesis, **report}


def build_default_graph():
    g = StateGraph(AgentState)

    g.add_node("run_dge", _wrap_node("run_dge", "run_dge", node_run_dge))
    g.add_node("dge_retry", _wrap_node("dge_retry", "dge_retry", node_dge_retry))
    g.add_node("pathway_enrichment", _wrap_node("pathway_enrichment", "pathway_enrichment", node_pathway_enrichment))
    g.add_node("supervisor", _wrap_node("supervisor", "supervisor", node_supervisor))
    g.add_node("enrich_ppi", _wrap_node("enrich_ppi", "enrich_ppi", node_enrich_ppi))
    g.add_node("literature_rag", _wrap_node("literature_rag", "literature_rag", node_literature_rag))
    g.add_node("drug_annotation", _wrap_node("drug_annotation", "drug_annotation", node_drug_annotation))
    g.add_node("depmap_query", _wrap_node("depmap_query", "depmap_query", node_depmap_query))
    g.add_node("opentargets_query", _wrap_node("opentargets_query", "opentargets_query", node_opentargets_query))
    g.add_node("clinical_trials", _wrap_node("clinical_trials", "clinical_trials", node_clinical_trials))
    g.add_node("pathway_crosstalk", _wrap_node("pathway_crosstalk", "pathway_crosstalk", node_pathway_crosstalk))
    g.add_node("tcga_survival", _wrap_node("tcga_survival", "tcga_survival", node_tcga_survival))
    g.add_node("crispr_designer", _wrap_node("crispr_designer", "crispr_designer", node_crispr_designer))
    g.add_node("synthesize_hypotheses", _wrap_node("synthesize_hypotheses", "synthesize_hypotheses", node_synthesize_hypotheses))
    g.add_node("generate_report", _wrap_node("generate_report", "generate_report", node_generate_report))

    g.set_entry_point("run_dge")
    g.add_conditional_edges("run_dge", _route_after_dge, {
        "dge_retry": "dge_retry",
        "pathway_enrichment": "pathway_enrichment",
        "end": END,
    })
    g.add_conditional_edges("dge_retry", _route_after_dge_retry, {
        "pathway_enrichment": "pathway_enrichment",
        "end": END,
    })
    g.add_edge("pathway_enrichment", "supervisor")
    g.add_edge("enrich_ppi", "supervisor")
    g.add_edge("literature_rag", "supervisor")
    g.add_edge("drug_annotation", "supervisor")
    g.add_edge("depmap_query", "supervisor")
    g.add_edge("opentargets_query", "supervisor")
    g.add_edge("clinical_trials", "supervisor")
    g.add_edge("pathway_crosstalk", "supervisor")
    g.add_edge("tcga_survival", "supervisor")
    g.add_conditional_edges("supervisor", _route_supervisor, {
        "enrich_ppi": "enrich_ppi",
        "literature_rag": "literature_rag",
        "drug_annotation": "drug_annotation",
        "depmap_query": "depmap_query",
        "opentargets_query": "opentargets_query",
        "clinical_trials": "clinical_trials",
        "pathway_crosstalk": "pathway_crosstalk",
        "tcga_survival": "tcga_survival",
        "crispr_designer": "crispr_designer",
        "finalize": "synthesize_hypotheses",
    })
    g.add_edge("crispr_designer", "synthesize_hypotheses")
    g.add_edge("synthesize_hypotheses", "generate_report")
    g.add_edge("generate_report", END)
    return g.compile()


def _clean_topology(topology: dict[str, Any]) -> tuple[list[dict], list[dict]]:
    nodes = [node for node in topology.get("nodes", []) if node.get("id") and node.get("type")]
    node_ids = {node["id"] for node in nodes}
    edges = [
        edge for edge in topology.get("edges", [])
        if edge.get("source") in node_ids and edge.get("target") in node_ids
    ]
    return nodes, edges


def _entry_node(nodes: list[dict], incoming: dict[str, list[str]]) -> str:
    for preferred in ("study_context", "run_dge"):
        for node in nodes:
            if node["type"] == preferred and not incoming.get(node["id"]):
                return node["id"]
    for node in nodes:
        if not incoming.get(node["id"]):
            return node["id"]
    return nodes[0]["id"]


def build_graph(topology: dict[str, Any] | None = None):
    if not topology or not topology.get("nodes"):
        return build_default_graph()

    nodes, edges = _clean_topology(topology)
    if not nodes:
        return build_default_graph()

    by_id = {node["id"]: node for node in nodes}
    incoming: dict[str, list[str]] = defaultdict(list)
    outgoing: dict[str, list[str]] = defaultdict(list)
    for edge in edges:
        outgoing[edge["source"]].append(edge["target"])
        incoming[edge["target"]].append(edge["source"])

    g = StateGraph(AgentState)
    known_node_ids: set[str] = set()
    for node in nodes:
        node_type = ALIASES.get(node["type"], node["type"])
        if node["type"] in {"report", "exit_report"}:
            fn = _report_node
        else:
            fn = NODE_IMPLS.get(node_type)
        if fn is None:
            continue
        g.add_node(node["id"], _wrap_node(node["id"], node["type"], fn))
        known_node_ids.add(node["id"])

    graph_nodes = [node for node in nodes if node["id"] in known_node_ids]
    g.set_entry_point(_entry_node(graph_nodes, incoming))

    for edge in edges:
        if edge["source"] not in known_node_ids or edge["target"] not in known_node_ids:
            continue
        source = by_id[edge["source"]]
        source_type = source["type"]
        if source_type in {"supervisor", "critic"} or source_type.startswith("critic_"):
            continue
        if source_type in {"sync_gateway", "approval_gate"} or source_type in HEAVY_NODE_TYPES:
            continue
        if (edge.get("data") or {}).get("edgeType") in {"conditional", "reject", "agentic"}:
            continue
        if edge["target"] in by_id:
            g.add_edge(edge["source"], edge["target"])

    for node in nodes:
        node_id = node["id"]
        if node_id not in known_node_ids:
            continue
        node_type = node["type"]
        targets = [target for target in outgoing.get(node_id, []) if target in by_id and target in known_node_ids]

        if node_type == "supervisor" and targets:
            type_to_target = {by_id[target]["type"]: target for target in targets}
            fallback = targets[0]

            def _route_dynamic_supervisor(state: AgentState, mapping=type_to_target, fallback_target=fallback) -> str:
                if state.get("next_step") == "finalize":
                    return mapping.get("report") or mapping.get("exit_report") or fallback_target
                return mapping.get(state.get("next_step", ""), fallback_target)

            g.add_conditional_edges(node_id, _route_dynamic_supervisor, {
                target: target for target in targets
            })

        elif (node_type == "critic" or node_type.startswith("critic_")) and targets:
            retry_candidates = [source for source in incoming.get(node_id, []) if source in by_id and by_id[source]["type"] != "supervisor"]
            retry_target = retry_candidates[-1] if retry_candidates else targets[0]
            forward_target = targets[0]
            kill_target = next((target for target in targets if by_id[target]["type"] in {"report", "exit_report"}), forward_target)

            def _route_critic(state: AgentState, retry=retry_target, forward=forward_target, kill=kill_target) -> str:
                if state.get("critic_route") == "kill":
                    return kill
                return retry if state.get("critic_route") == "retry" else forward

            route_map = {retry_target: retry_target, forward_target: forward_target, kill_target: kill_target}
            g.add_conditional_edges(node_id, _route_critic, route_map)

        elif node_type == "sync_gateway" and targets:
            forward_target = targets[0]

            def _route_sync(state: AgentState, forward=forward_target) -> str:
                return forward if state.get("sync_ready") else "__end__"

            g.add_conditional_edges(node_id, _route_sync, {
                forward_target: forward_target,
                "__end__": END,
            })

        elif node_type == "approval_gate" and targets:
            forward_target = targets[0]
            reject_targets = [
                target for target in targets
                if (next((edge for edge in edges if edge["source"] == node_id and edge["target"] == target), {}).get("data") or {}).get("edgeType") == "reject"
            ]
            reject_target = reject_targets[0] if reject_targets else "__end__"

            def _route_approval(state: AgentState, current=node_id, forward=forward_target, reject=reject_target) -> str:
                requests = state.get("approval_requests", {}) or {}
                decision = requests.get(current, {}).get("decision")
                if decision == "approved":
                    return forward
                if decision == "rejected":
                    return reject
                return "__end__"

            route_map = {forward_target: forward_target, "__end__": END}
            if reject_target != "__end__":
                route_map[reject_target] = reject_target
            g.add_conditional_edges(node_id, _route_approval, route_map)

        elif node_type in HEAVY_NODE_TYPES and targets:
            forward_target = targets[0]

            def _route_heavy(state: AgentState, current=node_id, forward=forward_target) -> str:
                status = (state.get("node_status", {}) or {}).get(current)
                return "__end__" if status == "pending_external_worker" else forward

            g.add_conditional_edges(node_id, _route_heavy, {
                forward_target: forward_target,
                "__end__": END,
            })

        elif targets and any((edge.get("data") or {}).get("edgeType") in {"conditional", "reject", "agentic"} for edge in edges if edge["source"] == node_id):
            conditional_edges = [edge for edge in edges if edge["source"] == node_id and edge["target"] in targets]
            default_target = next(
                (edge["target"] for edge in conditional_edges if (edge.get("data") or {}).get("edgeType") != "reject"),
                targets[0],
            )
            route_map = {edge["target"]: edge["target"] for edge in conditional_edges}

            def _route_custom_conditional(state: AgentState, current=node_id, fallback=default_target, allowed=route_map) -> str:
                decision = (state.get("edge_decisions", {}) or {}).get(current)
                return decision if decision in allowed else fallback

            g.add_conditional_edges(node_id, _route_custom_conditional, route_map)

        elif not targets:
            g.add_edge(node_id, END)

    return g.compile()


_pipeline = None


def get_pipeline(topology: dict[str, Any] | None = None):
    global _pipeline
    if topology and topology.get("nodes"):
        return build_graph(topology)
    if _pipeline is None:
        _pipeline = build_default_graph()
    return _pipeline
