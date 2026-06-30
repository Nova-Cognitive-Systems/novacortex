---
title: SDK — Perl
description: Complete Perl SDK reference for NovaCortex
---

# Perl SDK

The `NovaCortex::Client` module provides a complete Perl interface to the NovaCortex API, with idiomatic Perl error handling via `eval`/`$@` and structured exception objects.

---

## Installation

From CPAN:

```bash
cpan NovaCortex::Client
```

Using `cpanm` (recommended):

```bash
cpanm NovaCortex::Client
```

**Requirements**: Perl 5.20 or later. The module depends on:
- `LWP::UserAgent` — HTTP client
- `HTTP::Request` — request construction
- `JSON` — JSON serialization/deserialization
- `Carp` — error reporting

All dependencies are available on CPAN.

---

## Quick Start

```perl
use strict;
use warnings;
use NovaCortex::Client;

my $client = NovaCortex::Client->new(
    base_url => 'https://memory.example.com',
    api_key  => 'nc_pat_your_token_here',
);

my $memory = $client->memories->create({
    content   => 'NovaCortex uses HNSW indexing for sub-millisecond vector search',
    type      => 'semantic',
    namespace => 'default',
    tags      => ['architecture', 'performance'],
    confidence => 0.98,
});

print "Created memory: $memory->{id}\n";
```

---

## Client Initialization

```perl
use NovaCortex::Client;

my $client = NovaCortex::Client->new(
    base_url    => 'https://memory.example.com',  # Required
    api_key     => 'nc_pat_...',                   # Required
    timeout     => 30,                             # Optional: HTTP timeout in seconds (default: 30)
    max_retries => 3,                              # Optional: retry attempts on 429 (default: 3)
    user_agent  => 'my-app/1.0',                  # Optional: custom User-Agent string
);
```

The constructor returns a `NovaCortex::Client` object. Authentication is handled automatically — all requests include `Authorization: Bearer <api_key>` without any additional code.

---

## Memories

### Create

```perl
my $memory = $client->memories->create({
    content    => 'The deployment requires 2GB RAM minimum',  # Required
    type       => 'procedural',                               # Required
    namespace  => 'ops',                                      # Optional, default: "default"
    tags       => ['deployment', 'infrastructure'],           # Optional
    entities   => ['SurrealDB'],                              # Optional
    signals    => [0.9, 0.3],                                 # Optional
    salience   => 0.9,                                        # Optional: 0–1
    confidence => 0.98,                                       # Optional: 0–1
    decayRate  => 0.02,                                       # Optional: 0–1
});

print "Created: $memory->{id}\n";
print "Status:  $memory->{embeddingStatus}\n";
```

The return value is a hashref with all memory fields.

### Get

```perl
my $memory = $client->memories->get('ops', 'memory:abc123def456');
print "Content: $memory->{content}\n";

# Include relations
my $memory_with_rels = $client->memories->get(
    'ops',
    'memory:abc123def456',
    { includeRelations => 1 }
);
for my $rel (@{ $memory_with_rels->{relations} }) {
    printf "  -> %s (%s, strength: %.2f)\n",
        $rel->{toMemoryId}, $rel->{relationType}, $rel->{strength};
}
```

### Update

```perl
my $updated = $client->memories->update(
    'ops',
    'memory:abc123def456',
    {
        salience  => 0.5,
        tags      => ['deployment', 'infrastructure', 'reviewed'],
        decayRate => 0.01,
    }
);
print "Updated salience: $updated->{salience}\n";
```

### Delete

```perl
$client->memories->delete('ops', 'memory:abc123def456');
# Returns undef on success; raises NovaCortex::Error::NotFound if missing
```

### List

```perl
my $result = $client->memories->list({
    namespace   => 'ops',
    memoryTypes => ['procedural', 'semantic'],  # Optional filter
    tags        => ['deployment'],              # Optional filter
    minSalience => 0.5,                         # Optional
    limit       => 20,                          # Optional, default: 20
    offset      => 0,                           # Optional
    search      => 'RAM',                       # Optional: text filter on content
});

printf "Total: %d\n", $result->{total};
for my $m (@{ $result->{memories} }) {
    printf "  [%s] %s\n", $m->{type}, substr($m->{content}, 0, 60);
}
```

### Find Similar

```perl
my $similar = $client->memories->similar(
    'ops',
    'memory:abc123def456',
    {
        limit          => 5,
        scoreThreshold => 0.75,
    }
);

for my $item (@{ $similar->{results} }) {
    printf "Score: %.3f — %s\n",
        $item->{score},
        substr($item->{memory}{content}, 0, 60);
}
```

---

## Search

```perl
# You must supply a precomputed embedding vector
# Vector length must match QDRANT_VECTOR_SIZE (default: 1536)
my @vector = (0.012, -0.034, 0.078, ...);  # 1536 elements

my $results = $client->search({
    vector         => \@vector,       # Required
    namespace      => 'ops',          # Optional
    memoryTypes    => ['semantic'],   # Optional
    tags           => ['deployment'], # Optional
    limit          => 5,              # Optional, default: 10
    scoreThreshold => 0.75,          # Optional, default: 0.7
});

printf "Found %d results in %dms\n", $results->{total}, $results->{took_ms};
for my $item (@{ $results->{results} }) {
    printf "  %.3f — %s\n",
        $item->{score},
        substr($item->{memory}{content}, 0, 80);
}
```

---

## Relations

### Create

```perl
my $relation = $client->relations->create({
    fromMemoryId  => 'memory:abc123',   # Required
    fromNamespace => 'ops',             # Required
    toMemoryId    => 'memory:def456',   # Required
    toNamespace   => 'ops',             # Required
    relationType  => 'causes',          # Required
    strength      => 0.85,              # Optional: 0–1, default: 0.7
    bidirectional => 0,                 # Optional, default: false
    metadata      => {                  # Optional
        source => 'manual',
        note   => 'Observed during incident review',
    },
});

print "Relation created: $relation->{id}\n";
```

### List for a Memory

```perl
my $rels = $client->relations->list_for_memory('ops', 'memory:abc123');

print "Outgoing relations:\n";
for my $r (@{ $rels->{outgoing} }) {
    printf "  -> %s (%s, %.2f)\n",
        $r->{toMemoryId}, $r->{relationType}, $r->{strength};
}

print "Incoming relations:\n";
for my $r (@{ $rels->{incoming} }) {
    printf "  <- %s (%s, %.2f)\n",
        $r->{fromMemoryId}, $r->{relationType}, $r->{strength};
}
```

### Delete

```perl
$client->relations->delete('relation:xyz789abc123');
```

---

## Namespaces

```perl
# List all namespaces
my $result = $client->namespaces->list();
printf "Tier: %s (%d/%s namespaces used)\n",
    $result->{tier},
    $result->{count},
    defined $result->{limit} ? $result->{limit} : 'unlimited';

for my $ns (@{ $result->{namespaces} }) {
    printf "  %s (%d memories)\n", $ns->{name}, $ns->{memoryCount};
}

# Create a namespace
my $ns = $client->namespaces->create('new-project');
print "Created: $ns->{name}\n";

# Delete a namespace (must be empty)
$client->namespaces->delete('old-project');
```

---

## Export and Import

```perl
use JSON;

# Export as JSON (no embeddings)
my $json_data = $client->export->as_json('ops', { embeddings => 0 });
open my $fh, '>', 'ops-export.json' or die $!;
print $fh encode_json($json_data);
close $fh;

# Export as PMF (with embeddings)
my $pmf_data = $client->export->as_pmf('ops', {
    embeddings  => 1,
    nodeId      => 'prod-node-1',
    exportedBy  => 'admin',
});
open my $fh2, '>', 'ops-export.pmf.json' or die $!;
print $fh2 encode_json($pmf_data);
close $fh2;

# Import from JSON
open my $in, '<', 'ops-export.json' or die $!;
my $raw = do { local $/; <$in> };
close $in;
my $data = decode_json($raw);

my $result = $client->import_data->from_json($data);
printf "Imported: %d, Skipped: %d, Failed: %d\n",
    $result->{imported}, $result->{skipped}, $result->{failed};
if (@{ $result->{errors} }) {
    warn "Import errors:\n";
    warn "  $_\n" for @{ $result->{errors} };
}

# Import from PMF
my $pmf_result = $client->import_data->from_pmf($pmf_data);
printf "PMF import: %d imported (Merkle: %s, CRC32: %s)\n",
    $pmf_result->{imported},
    $pmf_result->{merkleVerified} ? 'OK' : 'FAILED',
    $pmf_result->{checksumVerified} ? 'OK' : 'FAILED';
```

---

## Knowledge Buckets

```perl
# Create a bucket
my $bucket = $client->buckets->create({
    name                   => 'runbooks',
    description            => 'Operations runbooks',
    namespace              => 'ops',
    agents                 => ['agent-007'],
    createMemoriesByDefault => 1,
});
print "Bucket: $bucket->{id}\n";

# Upload a document
my $doc = $client->buckets->upload(
    $bucket->{id},
    './deployment-guide.pdf',
    { createMemories => 1 }
);
printf "Uploaded: %s (status: %s)\n", $doc->{name}, $doc->{status};

# List documents
my $docs = $client->buckets->list_documents($bucket->{id}, { status => 'ready' });
for my $d (@{ $docs->{documents} }) {
    printf "  %s: %d chunks, %d memories\n",
        $d->{name}, $d->{chunkCount}, $d->{linkedMemoryCount};
}

# Get document detail
my $detail = $client->buckets->get_document($doc->{id});
print "First chunk: $detail->{chunks}[0]\n";
print "Linked memory IDs: " . join(', ', @{ $detail->{linkedMemoryIds} }) . "\n";

# Delete document (keep memories)
$client->buckets->delete_document($doc->{id});

# Delete document and linked memories
$client->buckets->delete_document($doc->{id}, { deleteMemories => 1 });
```

---

## Processor

```perl
# Get status
my $status = $client->processor->get_status();
printf "Last run: %s\n", $status->{stats}{lastRun} // 'never';
printf "Queue depth: %d\n", $status->{stats}{embeddingQueueDepth};
printf "Mode: %s\n", $status->{config}{mode};

# Trigger a run
$client->processor->run({ task => 'all' });

# Update schedule
$client->processor->update_schedule({
    mode             => 'interval',
    intervalMinutes  => 15,
    similarityThreshold => 0.75,
});
```

---

## Error Handling

```perl
use NovaCortex::Client;
use NovaCortex::Error;

my $client = NovaCortex::Client->new(
    base_url => 'https://memory.example.com',
    api_key  => 'nc_pat_...',
);

eval {
    my $memory = $client->memories->get('ops', 'memory:nonexistent');
};
if (my $err = $@) {
    if (ref $err && $err->isa('NovaCortex::Error::NotFound')) {
        warn "Memory does not exist\n";

    } elsif (ref $err && $err->isa('NovaCortex::Error::Auth')) {
        warn "Authentication failed: " . $err->message . "\n";

    } elsif (ref $err && $err->isa('NovaCortex::Error::Forbidden')) {
        if ($err->code eq 'NAMESPACE_LIMIT_REACHED') {
            warn "Namespace limit reached — upgrade your license\n";
        } else {
            warn "Access denied: " . $err->message . "\n";
        }

    } elsif (ref $err && $err->isa('NovaCortex::Error::RateLimit')) {
        warn "Rate limited. Retry after " . $err->retry_after . " seconds\n";
        # SDK retries automatically up to max_retries before raising this

    } elsif (ref $err && $err->isa('NovaCortex::Error::Validation')) {
        warn "Invalid request: " . $err->message . " (" . $err->code . ")\n";

    } elsif (ref $err && $err->isa('NovaCortex::Error')) {
        warn "NovaCortex API error " . $err->status_code . ": " . $err->message . "\n";

    } else {
        die $err;  # Re-throw non-NovaCortex errors
    }
}
```

### Error Class Reference

| Class | HTTP Status | Accessor Methods |
|---|---|---|
| `NovaCortex::Error` | Any | `message`, `code`, `status_code` |
| `NovaCortex::Error::Auth` | 401 | `message`, `code`, `status_code` |
| `NovaCortex::Error::Forbidden` | 403 | `message`, `code`, `status_code` |
| `NovaCortex::Error::NotFound` | 404 | `message`, `code`, `status_code` |
| `NovaCortex::Error::Conflict` | 409 | `message`, `code`, `status_code` |
| `NovaCortex::Error::RateLimit` | 429 | `message`, `code`, `status_code`, `retry_after` |
| `NovaCortex::Error::Validation` | 400 | `message`, `code`, `status_code` |
| `NovaCortex::Error::Server` | 500 | `message`, `code`, `status_code` |

---

## Complete Method Reference

### `$client->memories`

| Method | Arguments | Returns |
|---|---|---|
| `create(\%args)` | content, type, namespace, tags, entities, signals, confidence, salience, decayRate | hashref |
| `get($ns, $id, [\%opts])` | includeRelations | hashref |
| `update($ns, $id, \%args)` | type, namespace, tags, entities, signals, confidence, salience, decayRate | hashref |
| `delete($ns, $id)` | — | undef |
| `list(\%args)` | namespace, memoryTypes, tags, minSalience, limit, offset, search | hashref |
| `similar($ns, $id, [\%opts])` | limit, targetNamespace, scoreThreshold | hashref |

### `$client->relations`

| Method | Arguments | Returns |
|---|---|---|
| `create(\%args)` | fromMemoryId, fromNamespace, toMemoryId, toNamespace, relationType, strength, bidirectional, metadata | hashref |
| `list_for_memory($ns, $id)` | — | hashref |
| `delete($id)` | — | undef |

### `$client->namespaces`

| Method | Arguments | Returns |
|---|---|---|
| `list()` | — | hashref |
| `create($name)` | — | hashref |
| `delete($name)` | — | undef |

### `$client->buckets`

| Method | Arguments | Returns |
|---|---|---|
| `create(\%args)` | name, namespace, description, agents, createMemoriesByDefault | hashref |
| `list()` | — | hashref |
| `delete($id)` | — | undef |
| `upload($bucket_id, $file_path, [\%opts])` | createMemories | hashref |
| `list_documents($bucket_id, [\%opts])` | status, limit, offset | hashref |
| `get_document($doc_id)` | — | hashref |
| `delete_document($doc_id, [\%opts])` | deleteMemories | undef |

### `$client->export`

| Method | Arguments | Returns |
|---|---|---|
| `as_json($namespace, [\%opts])` | embeddings | hashref |
| `as_pmf($namespace, [\%opts])` | embeddings, nodeId, exportedBy | hashref |

### `$client->import_data`

| Method | Arguments | Returns |
|---|---|---|
| `from_json($data)` | hashref | hashref |
| `from_pmf($data)` | hashref | hashref |

### `$client->search`

| Method | Arguments | Returns |
|---|---|---|
| `search(\%args)` | vector, namespace, memoryTypes, tags, limit, scoreThreshold | hashref |

### `$client->processor`

| Method | Arguments | Returns |
|---|---|---|
| `get_status()` | — | hashref |
| `run(\%args)` | task | undef |
| `get_schedule()` | — | hashref |
| `update_schedule(\%args)` | mode, intervalMinutes, scheduledTime, similarityThreshold, ... | hashref |
