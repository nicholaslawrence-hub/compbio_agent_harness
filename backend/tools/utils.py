"""Shared helpers for tool adapter modules."""
from __future__ import annotations

from typing import Any


def adapter_missing(gene: str, node_type: str, message: str) -> dict[str, Any]:
    return {"gene": gene, "node_type": node_type, "source": "adapter_not_configured", "status": "not_configured", "summary": message}
