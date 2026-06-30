from ._client import SyncTransport, AsyncTransport
from .resources.memories import MemoriesResource, AsyncMemoriesResource
from .resources.export_import import ExportImportResource, AsyncExportImportResource
from .resources.buckets import KnowledgeResource, AsyncKnowledgeResource
from .resources.search import SearchResource, AsyncSearchResource
from .models import NamespacesResponse


class NovaCortexClient:
    def __init__(self, url: str, token: str, timeout: float = 30.0):
        self._transport = SyncTransport(url, token, timeout)
        self.memories = MemoriesResource(self._transport)
        self.export_import = ExportImportResource(self._transport)
        self.knowledge = KnowledgeResource(self._transport)
        # Semantic / vector search — call directly: client.search("query text").
        self.search = SearchResource(self._transport)

    def namespaces(self) -> NamespacesResponse:
        return NamespacesResponse.model_validate(self._transport.request("GET", "/namespaces"))

    def stats(self) -> dict:
        return self._transport.request("GET", "/stats")

    def whoami(self) -> dict:
        return self._transport.request("GET", "/auth/whoami")

    def close(self) -> None:
        self._transport.close()

    def __enter__(self) -> "NovaCortexClient":
        return self

    def __exit__(self, *args: object) -> None:
        self.close()


class AsyncNovaCortexClient:
    def __init__(self, url: str, token: str, timeout: float = 30.0):
        self._transport = AsyncTransport(url, token, timeout)
        self.memories = AsyncMemoriesResource(self._transport)
        self.export_import = AsyncExportImportResource(self._transport)
        self.knowledge = AsyncKnowledgeResource(self._transport)
        self.search = AsyncSearchResource(self._transport)

    async def namespaces(self) -> NamespacesResponse:
        return NamespacesResponse.model_validate(await self._transport.request("GET", "/namespaces"))

    async def stats(self) -> dict:
        return await self._transport.request("GET", "/stats")

    async def whoami(self) -> dict:
        return await self._transport.request("GET", "/auth/whoami")

    async def aclose(self) -> None:
        await self._transport.aclose()

    async def __aenter__(self) -> "AsyncNovaCortexClient":
        return self

    async def __aexit__(self, *args: object) -> None:
        await self.aclose()


__all__ = ["NovaCortexClient", "AsyncNovaCortexClient"]
