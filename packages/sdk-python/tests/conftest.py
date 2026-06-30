import pytest
import respx
import httpx


MOCK_URL = "http://test.novacortex.local"
MOCK_TOKEN = "test-token-abc"

MEMORY_FIXTURE = {
    "id": {"id": "mem_abc123", "namespace": "default"},
    "content": "Test memory content",
    "memoryType": "semantic",
    "metadata": {
        "salience": 5.0,
        "effectiveSalience": 5.0,
        "tags": [],
        "entities": [],
        "confidence": 0.9,
    },
    "relations": [],
    "version": 1,
    "createdAt": "2026-04-19T00:00:00Z",
    "updatedAt": "2026-04-19T00:00:00Z",
}
