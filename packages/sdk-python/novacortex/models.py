from __future__ import annotations
from typing import Any, Optional
from pydantic import BaseModel


class MemoryId(BaseModel):
    id: str
    namespace: str


class Entity(BaseModel):
    name: str
    type: str
    confidence: float


class MemoryMetadata(BaseModel):
    salience: float
    effectiveSalience: float
    tags: list[str]
    entities: list[Entity]
    confidence: float


class Relation(BaseModel):
    id: str
    relationType: str
    toMemory: MemoryId
    strength: float


class Memory(BaseModel):
    id: MemoryId
    content: str
    memoryType: str
    metadata: MemoryMetadata
    relations: list[Relation] = []
    version: int
    createdAt: str
    # Optional / not always present in API responses.
    updatedAt: Optional[str] = None
    accessedAt: Optional[str] = None
    contentHash: Optional[str] = None


class MemoryListResponse(BaseModel):
    data: list[Memory]
    count: int
    total: int
    page: int
    limit: int


class SearchResult(BaseModel):
    memory: Memory
    score: Optional[float] = None


class SearchResponse(BaseModel):
    data: list[SearchResult]
    count: int
    # Which path served the request: 'semantic' (query embedded), 'text', 'vector'.
    mode: Optional[str] = None


class NamespacesResponse(BaseModel):
    data: list[str]
    count: int
    limit: Optional[int] = None
    remaining: Optional[int] = None
    tier: Optional[str] = None


class ImportResult(BaseModel):
    imported: int
    skipped: int
    errors: int


class Document(BaseModel):
    id: str
    filename: str
    mimetype: str
    size: int
    namespace: str
    uploadedAt: str
    uploadedBy: Optional[str] = None


class UploadResult(BaseModel):
    document: Document
    memoriesCreated: Optional[int] = None
