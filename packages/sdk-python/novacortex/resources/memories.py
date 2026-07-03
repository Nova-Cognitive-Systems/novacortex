from __future__ import annotations
from typing import Any, Optional
from .._client import SyncTransport, AsyncTransport
from ..models import Memory, MemoryListResponse, SearchResponse


class MemoriesResource:
    def __init__(self, transport: SyncTransport):
        self._t = transport

    def create(self, content: str, *, namespace: str = "default", memory_type: str = "semantic",
               tags: list[str] | None = None, salience: float = 5.0) -> Memory:
        data = self._t.request("POST", "/memories", json={
            "content": content, "namespace": namespace,
            "memoryType": memory_type, "tags": tags or [], "salience": salience,
        })
        return Memory.model_validate(data)

    def get(self, memory_id: str, namespace: str = "default", *, include_relations: bool = False) -> Memory:
        path = f"/memories/{namespace}/{memory_id}"
        if include_relations:
            path += "?includeRelations=true"
        return Memory.model_validate(self._t.request("GET", path))

    def list(self, namespace: str = "default", *, limit: int = 20, page: int = 1,
             memory_type: str | None = None, tags: list[str] | None = None) -> MemoryListResponse:
        params: dict[str, Any] = {"namespace": namespace, "limit": limit, "page": page}
        if memory_type:
            params["memoryTypes"] = memory_type
        if tags:
            params["tags"] = ",".join(tags)
        return MemoryListResponse.model_validate(self._t.request("GET", "/memories", params=params))

    def similar(self, query: str, namespace: str = "default", *, limit: int = 10) -> SearchResponse:
        """Semantic search by text. The query is embedded server-side (POST /search),
        falling back to substring search when embeddings are disabled."""
        body = {"query": query, "namespace": namespace, "limit": limit}
        return SearchResponse.model_validate(self._t.request("POST", "/search", json=body))

    def delete(self, memory_id: str, namespace: str = "default") -> None:
        self._t.request("DELETE", f"/memories/{namespace}/{memory_id}")

    def update(self, memory_id: str, namespace: str = "default", *, content: str | None = None,
               tags: list[str] | None = None, salience: float | None = None) -> Memory:
        """Update a memory in place (content/tags/salience)."""
        body: dict[str, Any] = {}
        if content is not None:
            body["content"] = content
        if tags is not None:
            body["tags"] = tags
        if salience is not None:
            body["salience"] = salience
        return Memory.model_validate(self._t.request("PATCH", f"/memories/{namespace}/{memory_id}", json=body))

    def relate(self, from_id: str, to_id: str, relation_type: str, *,
               namespace: str = "default", to_namespace: str | None = None,
               strength: float = 1.0, bidirectional: bool = False) -> dict[str, Any]:
        """Create a typed relation (causes/contradicts/supersedes/same_as/...) between two memories."""
        return self._t.request("POST", "/memories/relations", json={
            "fromMemoryId": from_id, "fromNamespace": namespace,
            "toMemoryId": to_id, "toNamespace": to_namespace or namespace,
            "relationType": relation_type, "strength": strength, "bidirectional": bidirectional,
        })

    def relations(self, memory_id: str, namespace: str = "default") -> dict[str, Any]:
        """List the typed relations of a memory."""
        return self._t.request("GET", f"/memories/{namespace}/{memory_id}/relations")

    def current(self, memory_id: str, namespace: str = "default") -> dict[str, Any]:
        """Resolve a (possibly superseded) memory to its CURRENT version via the supersedes chain."""
        return self._t.request("GET", f"/memories/{namespace}/{memory_id}/current")

    def ingest(self, messages: list[dict[str, str]], *, namespace: str = "default",
               session_id: str | None = None, agent_id: str | None = None,
               wait: bool = False, dry_run: bool = False) -> dict[str, Any]:
        """Distill conversation messages into memories (LLM fact extraction +
        append-only conflict resolution). Async by default (returns a job);
        wait=True runs synchronously; dry_run=True previews without storing.
        Requires the server's intelligence layer (LLM_MODEL) to be configured."""
        body: dict[str, Any] = {"messages": messages, "namespace": namespace}
        if session_id:
            body["sessionId"] = session_id
        if agent_id:
            body["agentId"] = agent_id
        if wait:
            body["wait"] = True
        if dry_run:
            body["dryRun"] = True
        return self._t.request("POST", "/memories/ingest", json=body)

    def ingest_status(self, job_id: str) -> dict[str, Any]:
        """Status/result of an async ingest job."""
        return self._t.request("GET", f"/memories/ingest/{job_id}")


class AsyncMemoriesResource:
    def __init__(self, transport: AsyncTransport):
        self._t = transport

    async def create(self, content: str, *, namespace: str = "default", memory_type: str = "semantic",
                     tags: list[str] | None = None, salience: float = 5.0) -> Memory:
        data = await self._t.request("POST", "/memories", json={
            "content": content, "namespace": namespace,
            "memoryType": memory_type, "tags": tags or [], "salience": salience,
        })
        return Memory.model_validate(data)

    async def get(self, memory_id: str, namespace: str = "default", *, include_relations: bool = False) -> Memory:
        path = f"/memories/{namespace}/{memory_id}"
        if include_relations:
            path += "?includeRelations=true"
        return Memory.model_validate(await self._t.request("GET", path))

    async def list(self, namespace: str = "default", *, limit: int = 20) -> MemoryListResponse:
        return MemoryListResponse.model_validate(
            await self._t.request("GET", "/memories", params={"namespace": namespace, "limit": limit})
        )

    async def similar(self, query: str, namespace: str = "default", *, limit: int = 10) -> SearchResponse:
        body = {"query": query, "namespace": namespace, "limit": limit}
        return SearchResponse.model_validate(await self._t.request("POST", "/search", json=body))

    async def delete(self, memory_id: str, namespace: str = "default") -> None:
        await self._t.request("DELETE", f"/memories/{namespace}/{memory_id}")

    async def update(self, memory_id: str, namespace: str = "default", *, content: str | None = None,
                     tags: list[str] | None = None, salience: float | None = None) -> Memory:
        body: dict[str, Any] = {}
        if content is not None:
            body["content"] = content
        if tags is not None:
            body["tags"] = tags
        if salience is not None:
            body["salience"] = salience
        return Memory.model_validate(await self._t.request("PATCH", f"/memories/{namespace}/{memory_id}", json=body))

    async def relate(self, from_id: str, to_id: str, relation_type: str, *,
                     namespace: str = "default", to_namespace: str | None = None,
                     strength: float = 1.0, bidirectional: bool = False) -> dict[str, Any]:
        return await self._t.request("POST", "/memories/relations", json={
            "fromMemoryId": from_id, "fromNamespace": namespace,
            "toMemoryId": to_id, "toNamespace": to_namespace or namespace,
            "relationType": relation_type, "strength": strength, "bidirectional": bidirectional,
        })

    async def relations(self, memory_id: str, namespace: str = "default") -> dict[str, Any]:
        return await self._t.request("GET", f"/memories/{namespace}/{memory_id}/relations")

    async def current(self, memory_id: str, namespace: str = "default") -> dict[str, Any]:
        return await self._t.request("GET", f"/memories/{namespace}/{memory_id}/current")

    async def ingest(self, messages: list[dict[str, str]], *, namespace: str = "default",
                     session_id: str | None = None, agent_id: str | None = None,
                     wait: bool = False, dry_run: bool = False) -> dict[str, Any]:
        body: dict[str, Any] = {"messages": messages, "namespace": namespace}
        if session_id:
            body["sessionId"] = session_id
        if agent_id:
            body["agentId"] = agent_id
        if wait:
            body["wait"] = True
        if dry_run:
            body["dryRun"] = True
        return await self._t.request("POST", "/memories/ingest", json=body)

    async def ingest_status(self, job_id: str) -> dict[str, Any]:
        return await self._t.request("GET", f"/memories/ingest/{job_id}")
