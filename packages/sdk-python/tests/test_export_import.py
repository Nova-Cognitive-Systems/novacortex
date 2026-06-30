import pytest
import respx
import httpx
from novacortex import NovaCortexClient
from .conftest import MOCK_URL, MOCK_TOKEN

JSON_EXPORT = {"formatVersion": "1.0", "memories": [], "exported": 0}
PMF_EXPORT = {"header": {"magic": "NCPMF", "version": "1.0"}, "memories": []}
IMPORT_RESULT = {"imported": 5, "skipped": 0, "errors": 0}


@respx.mock
def test_export_json():
    respx.get(f"{MOCK_URL}/memories/export/default").mock(return_value=httpx.Response(200, json=JSON_EXPORT))
    with NovaCortexClient(MOCK_URL, MOCK_TOKEN) as client:
        data = client.export_import.export_json("default")
    assert data["formatVersion"] == "1.0"


@respx.mock
def test_export_pmf():
    respx.get(f"{MOCK_URL}/memories/export/default/pmf").mock(return_value=httpx.Response(200, json=PMF_EXPORT))
    with NovaCortexClient(MOCK_URL, MOCK_TOKEN) as client:
        data = client.export_import.export_pmf("default")
    assert data["header"]["magic"] == "NCPMF"


@respx.mock
def test_import_json():
    respx.post(f"{MOCK_URL}/memories/import").mock(return_value=httpx.Response(200, json=IMPORT_RESULT))
    with NovaCortexClient(MOCK_URL, MOCK_TOKEN) as client:
        result = client.export_import.import_json(JSON_EXPORT)
    assert result.imported == 5


@respx.mock
def test_import_pmf():
    respx.post(f"{MOCK_URL}/memories/import/pmf").mock(return_value=httpx.Response(200, json=IMPORT_RESULT))
    with NovaCortexClient(MOCK_URL, MOCK_TOKEN) as client:
        result = client.export_import.import_pmf(PMF_EXPORT)
    assert result.imported == 5


@respx.mock
def test_import_auto_detects_pmf():
    respx.post(f"{MOCK_URL}/memories/import/pmf").mock(return_value=httpx.Response(200, json=IMPORT_RESULT))
    with NovaCortexClient(MOCK_URL, MOCK_TOKEN) as client:
        result = client.export_import.import_auto(PMF_EXPORT)
    assert result.imported == 5


@respx.mock
def test_import_auto_detects_json():
    respx.post(f"{MOCK_URL}/memories/import").mock(return_value=httpx.Response(200, json=IMPORT_RESULT))
    with NovaCortexClient(MOCK_URL, MOCK_TOKEN) as client:
        result = client.export_import.import_auto(JSON_EXPORT)
    assert result.imported == 5
