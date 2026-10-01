# Canvas++

[![Version](https://img.shields.io/badge/version-v0.1.0--beta-blue.svg?style=flat-square)](https://github.com/VishalRashmika/canvas-plus-plus/releases)
[![Status](https://img.shields.io/badge/status-beta-orange.svg?style=flat-square)](https://github.com/VishalRashmika/canvas-plus-plus)
[![Obsidian](https://img.shields.io/badge/Obsidian-v1.5.0+-7C3AED.svg?style=flat-square&logo=obsidian&logoColor=white)](https://obsidian.md)
[![License: GPLv3](https://img.shields.io/badge/License-GPLv3-blue.svg?style=flat-square)](LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.4+-3178C6.svg?style=flat-square&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![JSON Canvas](https://img.shields.io/badge/JSON%20Canvas-1.0-5856D6.svg?style=flat-square)](https://jsoncanvas.org/)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg?style=flat-square)](https://github.com/VishalRashmika/canvas-plus-plus/pulls)

`obsidian` · `obsidian-plugin` · `uml` · `schematics` · `diagrams` · `whiteboard` · `json-canvas` · `ai-agent`

> [!NOTE]
> **Version: `v0.1.0-beta`**  
> Canvas++ is currently in public beta. All 15 UML 2.x diagram types, digital hardware schematics, freehand recognition, and AI agent patch bridges are available for testing. If you encounter bugs, rough edges, or have feature suggestions, please open an issue on the [GitHub Issues](https://github.com/VishalRashmika/canvas-plus-plus/issues) page.

A high-performance, local-first visual modeling, UML, and hardware schematic canvas engine for [Obsidian](https://obsidian.md).

Build professional UML 2.x software engineering diagrams, Logisim-style digital hardware schematics with hierarchy, and hand-drawn whiteboard sketches on an infinite canvas—complete with an autonomous AI coding agent CLI bridge and RAG markdown export.

---

## Highlights

- **All 15 UML 2.x Diagram Types Supported**:
  - *Structure Diagrams*: Class, Object, Package, Component, Composite Structure, Deployment, Profile.
  - *Behavior Diagrams*: Use Case, Activity, State Machine, Sequence, Communication, Interaction Overview, Timing.
  - *Schematics*: Logisim-style black-box chips with directional I/O pins, multi-bit buses, and hierarchical child diagram navigation.
- **Hybrid Freehand & Shape Recognizer**:
  - Sketch freely with pen or mouse.
  - Automatic geometric recognition turns hand-drawn strokes into formal UML shapes (rectangles, diamonds, ellipses, actors, circles, cylinders) with an instant undo escape-hatch toast.
- **Fast Interactive Canvas**:
  - Smooth pan and zoom (10% – 400%) with invariant cursor focus.
  - Multi-selection, marquee drag, smart alignment guides, and grid snapping.
  - Interactive minimap with real-time viewport tracker and click-to-pan.
  - Layer manager (visibility & lock toggles) and collapsible node grouping.
  - Dynamic routing engine: straight, orthogonal with automatic obstacle avoidance, and customizable corner radii.
  - Viewport virtualization: high-performance culling for large diagrams (>200 to >1000 nodes).
- **JSON Canvas 1.0 Native & Extensible**:
  - Saved as `.canvuspp` files (with backwards-compatible `.umlcanvas` support), compatible with Obsidian Canvas 1.0 viewers while storing rich semantic UML extensions.
  - One-click standalone SVG export with embedded fonts and styling.
- **Antigravity CLI Agent Bridge**:
  - File-based patch exchange (`.umlcanvas-patches/`) allows external AI coding agents (such as Google Antigravity) to safely inspect and patch diagrams without race conditions.
  - Granular permission model (`user`, `antigravity`, `both`, `none`) with hash-checked conflict detection.
- **RAG Embedding Pipeline**:
  - Export any diagram to a chunked, structured markdown bundle (`.umlcanvas-rag/<diagramId>.rag.md`) optimized for vector embedding and LLM reasoning.
- **100% Local-First & Private**:
  - Zero telemetry, zero external tracking, zero network requests. Everything runs locally in your vault.

---

## Supported Diagram Types

| Category | Diagram Type | Key Shapes & Features |
| :--- | :--- | :--- |
| **Structure** | Class Diagram | Classes with attribute/method compartments, visibility indicators (`+`, `-`, `#`, `~`), stereotypes, abstract/interface markers, associations, generalizations, aggregations, compositions, dependencies. |
| | Object Diagram | Instance specifications, slotted values (`slot: value`), link edges. |
| | Package Diagram | Packages with tabbed folders, nesting, `«import»` and `«access»` dependencies. |
| | Component Diagram | Component boxes with UML component icons, required (`socket`) and provided (`lollipop`) interface ports, assembly connectors. |
| | Composite Structure | Internal collaboration structure, encapsulated parts, ports, and internal wiring. |
| | Deployment Diagram | 3D deployment nodes, physical devices, execution environments, deployed artifacts, communication paths. |
| | Profile Diagram | Metaclasses, stereotypes, profile definitions, extension arrows with filled triangles. |
| **Behavior** | Use Case Diagram | Actors, use case ellipses, system boundaries, associations, `«include»` and `«extend»` dependencies. |
| | Activity Diagram | Initial nodes, activity actions, decisions/merges, forks/joins, activity finals, swimlanes/partitions. |
| | State Machine Diagram | Initial states, simple states, composite nested states, choice pseudostates, fork/join bars, transitions with events/guards/actions, final states. |
| | Sequence Diagram | Lifelines, activation boxes, synchronous/asynchronous calls, return messages, self-calls, alt/loop/opt interaction fragments. |
| | Communication Diagram | Collaborating lifelines with sequenced message numbers (`1: msg()`, `1.1: sub()`). |
| | Interaction Overview | High-level control flow linking nested interaction diagrams. |
| | Timing Diagram | Value-lifetime lanes, discrete state segments, timing rulers, duration/time constraints. |
| **Schematics** | Schematic / Chip | Black-box IC chips, directional pins (in, out, inout), multi-bit buses (`/N`), clock signals, and hierarchical sub-circuit drilldown. |

---

## Installation

### From Obsidian Community Plugins
1. Open Obsidian **Settings** > **Community plugins**.
2. Make sure **Restricted mode** is turned off.
3. Click **Browse** and search for `Canvas++`.
4. Click **Install**, then **Enable**.

> *Note: While in initial beta (`v0.1.0-beta`), if Canvas++ is pending review on the official community registry, install via BRAT or manual download below.*

### Beta Installation via BRAT (Recommended for Beta)
1. Install [Obsidian42 - BRAT](https://github.com/TfTHacker/obsidian42-brat) from Community Plugins.
2. Go to **Settings** > **BRAT** > **Add Beta plugin**.
3. Enter `VishalRashmika/canvas-plus-plus`.
4. Click **Add Plugin** and enable **Canvas++** under **Community plugins**.

### Manual Installation
1. Download the latest release assets (`main.js`, `manifest.json`, `styles.css`) from the [v0.1.0-beta Release](https://github.com/VishalRashmika/canvas-plus-plus/releases) page.
2. Inside your Obsidian vault, navigate to `.obsidian/plugins/` (create the directory if it does not exist).
3. Create a folder named `canvas-plus-plus` and place the three files inside.
4. Reload Obsidian, go to **Settings** > **Community plugins**, and toggle on **Canvas++**.

---

## Usage

### Creating a Diagram
- **Command Palette**: Press `Ctrl+P` (or `Cmd+P`), type `Canvas++`, and select **Create UML diagram** or **Create schematic**.
- **Ribbon Icon**: Click the **Git Fork** icon in Obsidian's left ribbon to create a new diagram file.
- **File Explorer**: Right-click any folder and select **New UML canvas** or **New schematic canvas**.

### Keyboard & Mouse Shortcuts

| Action | Shortcut |
| :--- | :--- |
| **Pan Canvas** | `Space + Left Click Drag` or `Middle Mouse Button Drag` |
| **Zoom In / Out** | `Mouse Wheel` (focuses at cursor point) |
| **Marquee Select** | `Click & Drag` on empty canvas background |
| **Additive Select** | `Shift + Click` or `Ctrl / Cmd + Click` on nodes/edges |
| **Move Selection** | `Click & Drag` selected nodes (with alignment guides & snap) |
| **Resize Node** | `Drag` any of the 8 bounding resize handles |
| **Connect Nodes** | `Click & Drag` from any port handle on a node |
| **Inline Text Edit** | `Double Click` any node title or edge label (or press `Enter` / `F2` when selected) |
| **Undo / Redo** | `Ctrl+Z` / `Ctrl+Shift+Z` (or `Cmd+Z` / `Cmd+Shift+Z`) |
| **Delete Selected** | `Delete` or `Backspace` |
| **Copy / Cut / Paste** | `Ctrl+C` / `Ctrl+X` / `Ctrl+V` |
| **Group / Ungroup** | `Ctrl+G` / `Ctrl+Shift+G` |
| **Toggle Freehand** | Click the **Pen** icon in the toolbar |

---

## Settings Reference

Go to **Settings** > **Canvas++**:

- **Default diagram type**: Set the default diagram created via the ribbon icon (e.g., `uml.class`, `uml.sequence`, `schematic`).
- **Default node width**: Default width in pixels for newly created nodes.
- **Default node height**: Default height in pixels for newly created nodes.
- **Show grid by default**: Toggle background dot grid on or off.
- **Grid size**: Adjust grid spacing in pixels (default: `20px`).
- **Autosave debounce delay (ms)**: Configure debounce delay in milliseconds for autosaving diagrams (default: `500ms`).
- **Enable Antigravity CLI bridge**: Watch `.umlcanvas-patches/` for external automated diagram updates.
- **Enable freehand drawing**: Allow freehand sketching and shape recognition on the canvas.

---

## AI Agent Integration (Antigravity CLI Bridge)

The plugin includes a bidirectional file watcher bridge designed for external AI coding agents.

1. **Hot-Reload Watcher**: The plugin watches `.umlcanvas-patches/` within your vault.
2. **Patch Delivery**: An external CLI agent drops a JSON patch file (`<patchId>.patch.json`) specifying operations (`addNode`, `moveNode`, `addEdge`, `deleteNode`, etc.).
3. **Permission Scoping**: Nodes and edges can be restricted to edit permissions:
   - `user`: Agent edits are rejected; only the human user can modify.
   - `antigravity`: Agent edits allowed.
   - `both`: Either agent or user can modify (default).
   - `none`: Locked to all edits.
4. **Conflict Prevention**: Patches verify `expectedFileHash` before mutating state.
5. **RAG Export**: Export your diagram at any time via the command palette or application use-case to generate chunked LLM markdown context in `.umlcanvas-rag/<diagramId>.rag.md`.

For complete details on patch structures and error codes, refer to [`docs/cli/PATCH-FORMAT.md`](docs/cli/PATCH-FORMAT.md).

---

## Development & Testing

```bash
# Clone the repository
git clone https://github.com/VishalRashmika/canvas-plus-plus.git
cd canvas-plus-plus

# Install dependencies
npm install

# Run unit and integration tests (Jest)
npm test

# Run linter
npm run lint

# Compile production bundle (main.js)
npm run build
```

---

## License

This project is licensed under the [GNU General Public License v3.0 (GPLv3)](LICENSE).
