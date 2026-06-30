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
