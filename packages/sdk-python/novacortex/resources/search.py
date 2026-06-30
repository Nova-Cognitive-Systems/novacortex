from __future__ import annotations
from typing import Any, Optional
from .._client import SyncTransport, AsyncTransport
from ..models import SearchResponse


def _build_body(
    query: Optional[str],
    vector: Optional[list[float]],
    namespace: Optional[str],
    limit: int,
    memory_types: Optional[list[str]],
    tags: Optional[list[str]],
    min_salience: Optional[float],
    score_threshold: Optional[float],
) -> dict[str, Any]:
    if (query is None) == (vector is None):
        raise ValueError("Provide exactly one of `query` (text) or `vector` (embedding).")
    body: dict[str, Any] = {"limit": limit}
    if query is not None:
        body["query"] = query
    if vector is not None:
        body["vector"] = vector
    if namespace is not None:
        body["namespace"] = namespace
    if memory_types:
        body["memoryTypes"] = memory_types
    if tags:
        body["tags"] = tags
    if min_salience is not None:
        body["minSalience"] = min_salience
    if score_threshold is not None:
        body["scoreThreshold"] = score_threshold
    return body


class SearchResource:
    """Semantic / vector search. Pass `query` for natural-language search (embedded
    server-side, with text fallback) or `vector` for a pre-computed embedding."""

    def __init__(self, transport: SyncTransport):
        self._t = transport

    def __call__(
        self,
        query: Optional[str] = None,
        *,
        vector: Optional[list[float]] = None,
        namespace: Optional[str] = None,
        limit: int = 10,
        memory_types: Optional[list[str]] = None,
        tags: Optional[list[str]] = None,
        min_salience: Optional[float] = None,
        score_threshold: Optional[float] = None,
    ) -> SearchResponse:
        body = _build_body(query, vector, namespace, limit, memory_types, tags, min_salience, score_threshold)
        return SearchResponse.model_validate(self._t.request("POST", "/search", json=body))


class AsyncSearchResource:
    def __init__(self, transport: AsyncTransport):
        self._t = transport

    async def __call__(
        self,
        query: Optional[str] = None,
        *,
        vector: Optional[list[float]] = None,
        namespace: Optional[str] = None,
        limit: int = 10,
        memory_types: Optional[list[str]] = None,
        tags: Optional[list[str]] = None,
        min_salience: Optional[float] = None,
        score_threshold: Optional[float] = None,
    ) -> SearchResponse:
        body = _build_body(query, vector, namespace, limit, memory_types, tags, min_salience, score_threshold)
        return SearchResponse.model_validate(await self._t.request("POST", "/search", json=body))
