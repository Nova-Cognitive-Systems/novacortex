import pytest
import respx
import httpx
from novacortex import NovaCortexClient
from .conftest import MOCK_URL, MOCK_TOKEN, MEMORY_FIXTURE


@respx.mock
def test_create_memory():
    respx.post(f"{MOCK_URL}/memories").mock(return_value=httpx.Response(201, json=MEMORY_FIXTURE))
    with NovaCortexClient(MOCK_URL, MOCK_TOKEN) as client:
        memory = client.memories.create("Test memory content")
    assert memory.id.id == "mem_abc123"
    assert memory.content == "Test memory content"


@respx.mock
def test_get_memory():
    respx.get(f"{MOCK_URL}/memories/default/mem_abc123").mock(return_value=httpx.Response(200, json=MEMORY_FIXTURE))
    with NovaCortexClient(MOCK_URL, MOCK_TOKEN) as client:
        memory = client.memories.get("mem_abc123")
    assert memory.memoryType == "semantic"


@respx.mock
def test_list_memories():
    payload = {"data": [MEMORY_FIXTURE], "count": 1, "total": 1, "page": 1, "limit": 20}
    respx.get(f"{MOCK_URL}/memories").mock(return_value=httpx.Response(200, json=payload))
    with NovaCortexClient(MOCK_URL, MOCK_TOKEN) as client:
        result = client.memories.list()
    assert result.count == 1
    assert result.data[0].id.id == "mem_abc123"


@respx.mock
def test_similar_memories():
    payload = {"data": [MEMORY_FIXTURE], "count": 1, "total": 1, "page": 1, "limit": 10}
    respx.get(f"{MOCK_URL}/memories/search").mock(return_value=httpx.Response(200, json=payload))
    with NovaCortexClient(MOCK_URL, MOCK_TOKEN) as client:
        result = client.memories.similar("test query")
    assert result.count == 1


@respx.mock
def test_delete_memory():
    respx.delete(f"{MOCK_URL}/memories/default/mem_abc123").mock(return_value=httpx.Response(204))
    with NovaCortexClient(MOCK_URL, MOCK_TOKEN) as client:
        result = client.memories.delete("mem_abc123")
    assert result is None
