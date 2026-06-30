---
title: Graph View
description: Exploring the memory relation graph in NovaCortex
---

# Graph View

The Graph View provides an interactive, force-directed visualization of memories and their typed relations. It is the primary interface for exploring how memories connect to each other, discovering clusters of related knowledge, and manually authoring new relations.

Navigate to **Graph** in the main sidebar to open the Graph View.

---

## Visual Layout

The graph renders as an SVG canvas using a D3 force-directed simulation. Each element in the graph is:

- **Node** — a memory record, displayed as a circle with a color corresponding to its type:
  - `episodic` — blue
  - `semantic` — purple
  - `procedural` — orange
  - `working` — gray

- **Edge** — a typed relation between two memories, displayed as a directed line with an arrowhead indicating direction. Edge thickness reflects the relation's `strength` score (thicker = stronger).

On initial load, the graph displays the 100 most recent memories (across all accessible namespaces) and all relations between them. Filters allow you to focus on specific subsets.

---

## Relation Types

NovaCortex supports nine typed relation edge types, each with a distinct semantic meaning:

| Type | Direction | Description |
|---|---|---|
| `causes` | Directed | The source memory directly leads to or produces the condition described in the target. Use when A and B are in a causal chain. |
| `supports` | Directed | The source provides evidence, justification, or additional context that supports the claim or event in the target. |
| `contradicts` | Bidirectional | The source and target are in conflict or mutual negation. Creating a `contradicts` relation is a signal for the processor to flag both memories for review. |
| `supersedes` | Directed | The source is a newer or corrected version that replaces the target. The target is effectively deprecated. The processor may eventually archive superseded memories. |
| `part_of` | Directed | The source is a sub-component, detail, or element of the larger concept described in the target. |
| `references` | Directed | The source cites, quotes, or links to the target. Weaker than `supports` — citing does not imply agreement. |
| `temporal_before` | Directed | The event described in the source occurred before the event in the target. Primarily useful for episodic memories. |
| `temporal_after` | Directed | The event described in the source occurred after the event in the target. Primarily useful for episodic memories. |
| `related_to` | Bidirectional | General semantic similarity. Used by the Memory Processor when cosine similarity is high but no more specific relation type can be inferred. |

---

## Navigation

### Panning and Zooming

- **Pan** — click and drag on empty canvas space
- **Zoom in** — scroll up or pinch out on trackpad
- **Zoom out** — scroll down or pinch in on trackpad
- **Reset view** — double-click on empty canvas space, or click the **Reset View** button in the toolbar

### Node Interaction

- **Click a node** — opens the memory detail panel on the right side of the screen, showing content, metadata, and the full relation list for that memory
- **Drag a node** — repositions the node. Once dragged, the node is "pinned" and the physics simulation does not move it further. Click the pin icon to unpin.
- **Double-click a node** — expands the graph to include all memories related to this node, even if they were previously outside the loaded set
- **Right-click a node** — context menu with options: View Detail, Add Relation, Find Similar, Delete

### Edge Interaction

- **Hover an edge** — tooltip shows the relation type and strength score
- **Click an edge** — opens the relation detail panel: from/to memory IDs, type, strength, bidirectional flag, metadata, created date
- **Right-click an edge** — context menu with options: View Detail, Delete Relation

---

## Filtering

The filter panel (click the **Filters** button in the toolbar) allows you to narrow the visible graph:

| Filter | Description |
|---|---|
| **Namespace** | Show only memories from the selected namespace (multi-select) |
| **Memory Type** | Show only memories of the selected types (multi-select) |
| **Relation Type** | Show only edges of the selected types (multi-select) |
| **Min Strength** | Hide edges below a strength threshold (slider, 0–1) |
| **Min Salience** | Hide nodes below a salience threshold (slider, 0–1) |
| **Tags** | Show only memories with the specified tag |
| **Search** | Highlight nodes whose content contains the search term |

Applying filters does not remove data from the database — it only affects the graph's visual display. Clear all filters to return to the full graph.

---

## Creating Relations

You can author a new relation between any two memories directly in the Graph View:

1. **Select the source node** — click the memory that will be the source (the `from` end of the relation)
2. **Click "Add Relation"** — the button appears in the memory detail panel on the right, or in the node's right-click context menu
3. **Select the target node** — the cursor changes to a crosshair; click the target memory in the graph. You can also type a memory ID into the search field in the relation creation dialog if the target is not visible on the canvas.
4. **Configure the relation**:
   - **Relation Type** — select from the nine types described above
   - **Strength** — slider from 0 to 1; default 0.7
   - **Bidirectional** — when enabled, the relation is traversed in both directions in queries
   - **Metadata** — optional JSON object for custom properties
5. Click **Create Relation**

The new edge appears on the canvas immediately. The relation is stored in SurrealDB and is available via the API.

---

## Automatic Relation Discovery

The Memory Processor discovers relations automatically by comparing memory embeddings. When two memories have a cosine similarity above the configured threshold (default: 0.7), the processor creates a `related_to` relation between them. Higher-similarity pairs may be assigned more specific types if the processor's language model is configured to infer relation types.

Processor-created relations have `metadata: { "source": "processor", "similarity": 0.87 }` so you can distinguish them from manually authored relations.

---

## Graph Export

Click the **Export** button in the toolbar to export the current graph view:

- **PNG** — rasterized screenshot of the visible canvas at 2x resolution
- **SVG** — full vector export of the rendered graph
- **JSON** — a structured export of the visible nodes and edges (not a full PMF export — use Settings → Export for that)

---

## Performance Considerations

The force-directed simulation is computationally intensive. On installations with tens of thousands of memories:
- The graph loads with pagination: the initial view shows the 100 highest-salience memories
- Double-clicking a node expands by up to 50 additional memories at a time
- Use filters aggressively to keep the visible node count below 500 for smooth interaction
- On lower-powered hardware, use the **Reduce Motion** toggle in the Graph toolbar to disable physics animation and render in static layout mode
