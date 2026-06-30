from __future__ import annotations
from typing import Any, TypeVar
import httpx
from .exceptions import AuthError, NotFoundError, ValidationError, ServerError, NovaCortexError

T = TypeVar("T")

DEFAULT_TIMEOUT = 30.0
DEFAULT_RETRIES = 3


def _raise_for_status(response: httpx.Response) -> None:
    if response.status_code == 401:
        raise AuthError("Invalid or expired token", status_code=401)
    if response.status_code == 403:
        raise AuthError("Insufficient scope", status_code=403)
    if response.status_code == 404:
        raise NotFoundError("Resource not found", status_code=404)
    if response.status_code == 422:
        raise ValidationError(response.text, status_code=422)
    if response.status_code >= 500:
        raise ServerError(f"Server error: {response.text}", status_code=response.status_code)
    if not response.is_success:
        raise NovaCortexError(f"HTTP {response.status_code}: {response.text}", status_code=response.status_code)


class SyncTransport:
    def __init__(self, base_url: str, token: str, timeout: float = DEFAULT_TIMEOUT):
        self._client = httpx.Client(
            base_url=base_url.rstrip("/"),
            headers={"Authorization": f"Bearer {token}", "User-Agent": "novacortex-python/1.0.0"},
            timeout=timeout,
        )

    def request(self, method: str, path: str, **kwargs: Any) -> Any:
        response = self._client.request(method, path, **kwargs)
        _raise_for_status(response)
        if response.status_code == 204:
            return None
        return response.json()

    def close(self) -> None:
        self._client.close()

    def __enter__(self) -> "SyncTransport":
        return self

    def __exit__(self, *args: Any) -> None:
        self.close()


class AsyncTransport:
    def __init__(self, base_url: str, token: str, timeout: float = DEFAULT_TIMEOUT):
        self._client = httpx.AsyncClient(
            base_url=base_url.rstrip("/"),
            headers={"Authorization": f"Bearer {token}", "User-Agent": "novacortex-python/1.0.0"},
            timeout=timeout,
        )

    async def request(self, method: str, path: str, **kwargs: Any) -> Any:
        response = await self._client.request(method, path, **kwargs)
        _raise_for_status(response)
        if response.status_code == 204:
            return None
        return response.json()

    async def aclose(self) -> None:
        await self._client.aclose()

    async def __aenter__(self) -> "AsyncTransport":
        return self

    async def __aexit__(self, *args: Any) -> None:
        await self.aclose()
