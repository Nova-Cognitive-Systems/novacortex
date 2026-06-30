from __future__ import annotations
from typing import Any
from .._client import SyncTransport, AsyncTransport
from ..models import ImportResult


class ExportImportResource:
    def __init__(self, transport: SyncTransport):
        self._t = transport

    def export_json(self, namespace: str, *, include_embeddings: bool = False) -> dict[str, Any]:
        params = {}
        if include_embeddings:
            params["includeEmbeddings"] = "true"
        return self._t.request("GET", f"/memories/export/{namespace}", params=params)

    def export_pmf(self, namespace: str, *, exported_by: str | None = None) -> dict[str, Any]:
        params = {}
        if exported_by:
            params["exportedBy"] = exported_by
        return self._t.request("GET", f"/memories/export/{namespace}/pmf", params=params)

    def import_json(self, data: dict[str, Any]) -> ImportResult:
        return ImportResult.model_validate(self._t.request("POST", "/memories/import", json=data))

    def import_pmf(self, data: dict[str, Any]) -> ImportResult:
        return ImportResult.model_validate(self._t.request("POST", "/memories/import/pmf", json=data))

    def import_auto(self, data: dict[str, Any]) -> ImportResult:
        if data.get("header", {}).get("magic") == "NCPMF":
            return self.import_pmf(data)
        return self.import_json(data)


class AsyncExportImportResource:
    def __init__(self, transport: AsyncTransport):
        self._t = transport

    async def export_json(self, namespace: str) -> dict[str, Any]:
        return await self._t.request("GET", f"/memories/export/{namespace}")

    async def export_pmf(self, namespace: str) -> dict[str, Any]:
        return await self._t.request("GET", f"/memories/export/{namespace}/pmf")

    async def import_json(self, data: dict[str, Any]) -> ImportResult:
        return ImportResult.model_validate(await self._t.request("POST", "/memories/import", json=data))

    async def import_pmf(self, data: dict[str, Any]) -> ImportResult:
        return ImportResult.model_validate(await self._t.request("POST", "/memories/import/pmf", json=data))

    async def import_auto(self, data: dict[str, Any]) -> ImportResult:
        if data.get("header", {}).get("magic") == "NCPMF":
            return await self.import_pmf(data)
        return await self.import_json(data)
