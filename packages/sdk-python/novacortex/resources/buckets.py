from __future__ import annotations
from pathlib import Path
from typing import Any
from .._client import SyncTransport, AsyncTransport
from ..models import UploadResult


class KnowledgeResource:
    def __init__(self, transport: SyncTransport):
        self._t = transport

    def upload(self, file_path: str | Path, *, namespace: str = "default",
               create_memories: bool = False) -> UploadResult:
        path = Path(file_path)
        with open(path, "rb") as fh:
            content = fh.read()
        files = {"file": (path.name, content, "application/octet-stream")}
        data: dict[str, Any] = {"namespace": namespace}
        if create_memories:
            data["createMemories"] = "true"
        return UploadResult.model_validate(
            self._t.request("POST", "/knowledge/upload", files=files, data=data)
        )

    def list(self, namespace: str = "default") -> list[dict[str, Any]]:
        return self._t.request("GET", "/knowledge", params={"namespace": namespace})

    def get(self, document_id: str) -> dict[str, Any]:
        return self._t.request("GET", f"/knowledge/{document_id}")


class AsyncKnowledgeResource:
    def __init__(self, transport: AsyncTransport):
        self._t = transport

    async def upload(self, file_path: str | Path, *, namespace: str = "default",
                     create_memories: bool = False) -> UploadResult:
        path = Path(file_path)
        with open(path, "rb") as fh:
            content = fh.read()
        files = {"file": (path.name, content, "application/octet-stream")}
        data: dict[str, Any] = {"namespace": namespace}
        if create_memories:
            data["createMemories"] = "true"
        return UploadResult.model_validate(
            await self._t.request("POST", "/knowledge/upload", files=files, data=data)
        )
