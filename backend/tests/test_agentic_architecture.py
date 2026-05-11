import unittest
from unittest.mock import patch

from agents.graph import build_graph, node_approval_gate, node_sync_gateway
from agents.runtime import (
    checkpoint_path,
    load_checkpoint,
    provenance_event,
    save_checkpoint,
    scoped_patch,
)


def base_state(**overrides):
    state = {
        "disease_term": "lung cancer",
        "condition_a": "disease",
        "condition_b": "control",
        "count_matrix_path": None,
        "sample_conditions": {},
        "study_context": {"study_notes": "Find druggable targets."},
        "sandbox_config": {},
        "network_topology": {},
        "artifact_registry": {},
        "node_outputs": {},
        "node_status": {},
        "pending_tasks": {},
        "approval_requests": {},
        "provenance_ledger": [],
        "edge_decisions": {},
        "external_results": {},
        "active_node_id": "",
        "top_genes": ["EGFR"],
        "detected_genes": ["EGFR", "ERBB2"],
        "all_dge_results": [],
        "status": "pending",
        "progress": 0,
        "previous_node_id": "",
        "supervisor_context": [],
    }
    state.update(overrides)
    return state


class AgenticArchitectureTests(unittest.TestCase):
    def test_scoped_outputs_strip_raw_dge_payloads(self):
        output = {
            "status": "dge_complete",
            "all_dge_results": [{"gene": f"G{i}", "padj": 0.01} for i in range(100)],
            "dge_results": [{"gene": "EGFR"}],
        }
        patch = scoped_patch(base_state(), "dge-1", "run_dge", output)

        self.assertIn("dge-1", patch["node_outputs"])
        self.assertNotIn("all_dge_results", patch["node_outputs"]["dge-1"]["data"])
        self.assertEqual(patch["node_status"]["dge-1"], "dge_complete")

    def test_sync_gateway_waits_until_every_incoming_node_is_done(self):
        topology = {
            "edges": [
                {"source": "af3-1", "target": "sync-1"},
                {"source": "rdkit-1", "target": "sync-1"},
            ]
        }
        waiting = node_sync_gateway(base_state(
            current_node_id="sync-1",
            network_topology=topology,
            node_status={"af3-1": "pending_external_worker", "rdkit-1": "rdkit_complete"},
        ))
        ready = node_sync_gateway(base_state(
            current_node_id="sync-1",
            network_topology=topology,
            node_status={"af3-1": "external_complete", "rdkit-1": "rdkit_complete"},
        ))

        self.assertFalse(waiting["sync_ready"])
        self.assertTrue(ready["sync_ready"])

    def test_approval_gate_pauses_then_preserves_human_decision(self):
        paused = node_approval_gate(base_state(current_node_id="approve-1"))
        resolved = node_approval_gate(base_state(
            current_node_id="approve-1",
            approval_requests={"approve-1": {"decision": "approved", "summary": "ok"}},
        ))

        self.assertEqual(paused["status"], "awaiting_approval")
        self.assertEqual(resolved["status"], "approval_resolved")
        self.assertEqual(resolved["approval_requests"]["approve-1"]["decision"], "approved")

    def test_alphafold_node_runs_as_api_lookup_not_background_compute(self):
        topology = {
            "nodes": [
                {"id": "ctx", "type": "study_context"},
                {"id": "af3", "type": "alphafold_complex"},
                {"id": "report", "type": "report"},
            ],
            "edges": [
                {"source": "ctx", "target": "af3"},
                {"source": "af3", "target": "report"},
            ],
        }
        with patch("agents.nodes.fetch_alphafold_structure", return_value={"gene": "EGFR", "status": "resolved", "source": "alphafold_db_api"}):
            result = build_graph(topology).invoke(base_state(network_topology=topology))

        self.assertEqual(result["node_status"]["af3"], "alphafold_lookup_complete")
        self.assertEqual(result["pending_tasks"], {})
        self.assertIn("report", result.get("node_outputs", {}))

    def test_dynamic_conditional_edge_uses_node_instance_decision(self):
        topology = {
            "nodes": [
                {"id": "ctx", "type": "study_context"},
                {"id": "a", "type": "study_context"},
                {"id": "b", "type": "clinical_metadata"},
            ],
            "edges": [
                {"source": "ctx", "target": "a", "data": {"edgeType": "conditional"}},
                {"source": "ctx", "target": "b", "data": {"edgeType": "conditional"}},
            ],
        }
        result = build_graph(topology).invoke(base_state(
            network_topology=topology,
            edge_decisions={"ctx": "b"},
        ))

        self.assertIn("b", result["node_outputs"])
        self.assertNotIn("a", result["node_outputs"])

    def test_checkpoint_is_durable_and_contains_compact_resume_state(self):
        state = base_state(status="awaiting_approval", progress=42, all_dge_results=[{"gene": "RAW"}])
        job_id = "unit_checkpoint_architecture"
        try:
            saved = save_checkpoint(job_id, state)
            loaded = load_checkpoint(job_id)
        finally:
            checkpoint_path(job_id).unlink(missing_ok=True)

        self.assertEqual(saved["status"], "awaiting_approval")
        self.assertEqual(loaded["progress"], 42)
        self.assertEqual(loaded["resume_state"]["all_dge_results"], [])

    def test_provenance_event_hashes_prompt_context_and_output(self):
        event = provenance_event(
            "critic-1",
            "critic_red_team_fda",
            base_state(supervisor_reasoning="why this route"),
            {"status": "critic_review", "supervisor_reasoning": "reject because weak"},
        )

        self.assertEqual(len(event["hash"]), 64)
        self.assertIn("prompt", event)
        self.assertIn("raw_output", event)


if __name__ == "__main__":
    unittest.main()
