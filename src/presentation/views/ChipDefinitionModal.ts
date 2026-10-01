import { App, Modal } from "obsidian";
import { ChipInterfaceDefinition } from "../../domain/entities/ChipInterfaceDefinition";
import { defaultChipService, PortSpec } from "../../domain/services/ChipService";
import { DiagramNode } from "../../domain/entities/DiagramNode";
import { PortDirection, Side } from "../../domain/types";

export interface ChipPinRow {
  id: string;
  name: string;
  direction: PortDirection;
  side: "auto" | Side;
  dataType?: string;
}

export interface ChipDefinitionModalOptions {
  initialDefinition?: ChipInterfaceDefinition;
  existingNode?: DiagramNode;
  multipleInstancesCount?: number;
  onSave: (
    definition: ChipInterfaceDefinition,
    options: { saveToLibrary: boolean; propagateToInstances: boolean }
  ) => void;
  onCancel?: () => void;
}

export class ChipDefinitionModal extends Modal {
  private chipName = "";
  private pinRows: ChipPinRow[] = [];
  private saveToLibrary = true;
  private propagateToInstances = true;
  private errorMsgEl: HTMLElement | null = null;
  private pinsContainerEl: HTMLElement | null = null;
  private pinCountBadgeEl: HTMLElement | null = null;

  constructor(app: App, private readonly options: ChipDefinitionModalOptions) {
    super(app);

    if (options.initialDefinition) {
      this.chipName = options.initialDefinition.name;
      this.pinRows = options.initialDefinition.ports.map((p) => ({
        id: p.id,
        name: p.name,
        direction: p.direction ?? "in",
        side: p.side ?? "auto",
        dataType: p.dataType,
      }));
    } else if (options.existingNode) {
      this.chipName = options.existingNode.labels[0]?.text ?? "CustomChip";
      this.pinRows = options.existingNode.ports.map((p) => ({
        id: p.id,
        name: p.name,
        direction: p.direction ?? "in",
        side: p.side ?? "auto",
        dataType: p.dataType,
      }));
    } else {
      this.chipName = "CustomChip";
      this.pinRows = [
        { id: "p-in0", name: "IN0", direction: "in", side: "auto" },
        { id: "p-in1", name: "IN1", direction: "in", side: "auto" },
        { id: "p-clk", name: "CLK", direction: "in", side: "top", dataType: "clk" },
        { id: "p-out0", name: "OUT0", direction: "out", side: "auto" },
      ];
    }
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("umlcanvas-chip-modal");

    const isEditMode = Boolean(this.options.existingNode || this.options.initialDefinition);

    // 1. Header
    const headerEl = contentEl.createDiv({ cls: "umlcanvas-chip-modal-header" });
    const titleEl = headerEl.createEl("h2", {
      text: isEditMode ? `Edit Chip Interface: ${this.chipName}` : "Define Custom Chip Interface",
    });
    titleEl.addClass("umlcanvas-chip-modal-title");
    headerEl.createEl("p", {
      cls: "umlcanvas-chip-modal-desc",
      text: "Define chip name, custom input/output pins, sides, and optional bus width labels.",
    });

    // 2. Chip Name Input
    const nameSection = contentEl.createDiv({ cls: "umlcanvas-chip-form-row" });
    nameSection.createEl("label", { text: "Chip Name / IC Label", cls: "umlcanvas-chip-form-label" });
    const nameInput = nameSection.createEl("input", {
      type: "text",
      value: this.chipName,
      placeholder: "e.g., ALU_8BIT, COUNTER, 74LS00",
      cls: "umlcanvas-chip-input umlcanvas-chip-name-input",
    });
    nameInput.addEventListener("input", () => {
      this.chipName = nameInput.value.trim();
      if (isEditMode) {
        titleEl.textContent = `Edit Chip Interface: ${this.chipName || "Unnamed"}`;
      }
      this.clearError();
    });

    // 3. Quick Bus / Multi-Pin Generator
    this.renderBusGenerator(contentEl);

    // 4. Pin Editor Table Header & Stats
    const pinsHeaderRow = contentEl.createDiv({ cls: "umlcanvas-chip-pins-header" });
    const pinsLeft = pinsHeaderRow.createDiv({ cls: "umlcanvas-chip-pins-title-wrapper" });
    pinsLeft.createEl("h3", { text: "Configured Pins", cls: "umlcanvas-chip-pins-title" });
    this.pinCountBadgeEl = pinsLeft.createSpan({ cls: "umlcanvas-chip-badge" });
    this.updateStats();

    const pinsActions = pinsHeaderRow.createDiv({ cls: "umlcanvas-chip-pins-actions" });
    const addPinBtn = pinsActions.createEl("button", {
      text: "+ Add Pin",
      cls: "mod-cta umlcanvas-chip-btn-sm",
    });
    addPinBtn.addEventListener("click", () => {
      this.addNewPin();
    });

    const clearPinsBtn = pinsActions.createEl("button", {
      text: "Clear All",
      cls: "umlcanvas-chip-btn-sm",
    });
    clearPinsBtn.addEventListener("click", () => {
      this.pinRows = [];
      this.renderPinRows();
    });

    // 5. Pin Rows Table / Container
    this.pinsContainerEl = contentEl.createDiv({ cls: "umlcanvas-chip-pins-table" });
    this.renderPinRows();

    // 6. Error Message Container
    this.errorMsgEl = contentEl.createDiv({ cls: "umlcanvas-chip-error-msg" });
    this.errorMsgEl.style.display = "none";

    // 7. Checkboxes / Options
    const optionsEl = contentEl.createDiv({ cls: "umlcanvas-chip-options-box" });

    const saveLibraryLabel = optionsEl.createEl("label", { cls: "umlcanvas-chip-checkbox-label" });
    const saveLibraryCheck = saveLibraryLabel.createEl("input", { type: "checkbox" });
    saveLibraryCheck.checked = this.saveToLibrary;
    saveLibraryCheck.addEventListener("change", () => {
      this.saveToLibrary = saveLibraryCheck.checked;
    });
    saveLibraryLabel.createSpan({ text: "Save definition to Shape Library (Palette) for reuse" });

    if (this.options.existingNode && (this.options.multipleInstancesCount ?? 1) > 1) {
      const propLabel = optionsEl.createEl("label", { cls: "umlcanvas-chip-checkbox-label" });
      const propCheck = propLabel.createEl("input", { type: "checkbox" });
      propCheck.checked = this.propagateToInstances;
      propCheck.addEventListener("change", () => {
        this.propagateToInstances = propCheck.checked;
      });
      propLabel.createSpan({
        text: `Propagate changes to all ${this.options.multipleInstancesCount} instances in this diagram`,
      });
    }

    // 8. Footer Buttons
    const footerEl = contentEl.createDiv({ cls: "umlcanvas-chip-modal-footer" });

    const cancelBtn = footerEl.createEl("button", { text: "Cancel", cls: "umlcanvas-chip-btn" });
    cancelBtn.addEventListener("click", () => {
      this.close();
      this.options.onCancel?.();
    });

    const saveBtn = footerEl.createEl("button", {
      text: isEditMode ? "Save Changes" : "Save & Place on Canvas",
      cls: "mod-cta umlcanvas-chip-btn umlcanvas-chip-save-btn",
    });
    saveBtn.addEventListener("click", () => {
      this.handleSubmit();
    });

    // Focus input
    setTimeout(() => nameInput.focus(), 50);
  }

  onClose(): void {
    const { contentEl } = this;
    contentEl.empty();
  }

  private renderBusGenerator(parent: HTMLElement): void {
    const container = parent.createDiv({ cls: "umlcanvas-chip-bus-generator" });
    const header = container.createDiv({ cls: "umlcanvas-chip-bus-header" });
    header.createSpan({ text: "⚡ Quick Bus / Multi-Pin Generator", cls: "umlcanvas-chip-bus-title" });

    const row = container.createDiv({ cls: "umlcanvas-chip-bus-inputs" });

    // Prefix
    const prefixWrap = row.createDiv({ cls: "umlcanvas-chip-input-group" });
    prefixWrap.createSpan({ text: "Prefix:", cls: "umlcanvas-chip-input-group-label" });
    const prefixInput = prefixWrap.createEl("input", {
      type: "text",
      value: "D",
      cls: "umlcanvas-chip-input umlcanvas-chip-bus-prefix",
      placeholder: "e.g., D, A, IN",
    });

    // Count
    const countWrap = row.createDiv({ cls: "umlcanvas-chip-input-group" });
    countWrap.createSpan({ text: "Count:", cls: "umlcanvas-chip-input-group-label" });
    const countInput = countWrap.createEl("input", {
      type: "number",
      value: "8",
      cls: "umlcanvas-chip-input umlcanvas-chip-bus-count",
    });
    countInput.setAttribute("min", "1");
    countInput.setAttribute("max", "64");

    // Direction
    const dirWrap = row.createDiv({ cls: "umlcanvas-chip-input-group" });
    dirWrap.createSpan({ text: "Direction:", cls: "umlcanvas-chip-input-group-label" });
    const dirSelect = dirWrap.createEl("select", { cls: "umlcanvas-chip-select" });
    dirSelect.createEl("option", { value: "in", text: "in (Input)" });
    dirSelect.createEl("option", { value: "out", text: "out (Output)" });
    dirSelect.createEl("option", { value: "inout", text: "inout (Bidir)" });

    // Side
    const sideWrap = row.createDiv({ cls: "umlcanvas-chip-input-group" });
    sideWrap.createSpan({ text: "Side:", cls: "umlcanvas-chip-input-group-label" });
    const sideSelect = sideWrap.createEl("select", { cls: "umlcanvas-chip-select" });
    sideSelect.createEl("option", { value: "auto", text: "Auto" });
    sideSelect.createEl("option", { value: "left", text: "Left" });
    sideSelect.createEl("option", { value: "right", text: "Right" });
    sideSelect.createEl("option", { value: "top", text: "Top" });
    sideSelect.createEl("option", { value: "bottom", text: "Bottom" });

    // Generate Button
    const genBtn = row.createEl("button", {
      text: "Generate Bus Pins",
      cls: "umlcanvas-chip-btn-accent",
    });
    genBtn.addEventListener("click", (e) => {
      e.preventDefault();
      const prefix = prefixInput.value.trim() || "P";
      const count = Math.max(1, Math.min(64, parseInt(countInput.value, 10) || 8));
      const direction = dirSelect.value as PortDirection;
      const side = sideSelect.value as "auto" | Side;

      for (let i = 0; i < count; i++) {
        this.pinRows.push({
          id: `p-${prefix.toLowerCase()}${i}-${Date.now()}`,
          name: `${prefix}${i}`,
          direction,
          side,
        });
      }

      this.renderPinRows();
    });
  }

  private addNewPin(): void {
    const nextIdx = this.pinRows.length;
    this.pinRows.push({
      id: `p-pin${nextIdx}-${Date.now()}`,
      name: `P${nextIdx}`,
      direction: "in",
      side: "auto",
    });
    this.renderPinRows();
  }

  private renderPinRows(): void {
    if (!this.pinsContainerEl) return;
    this.pinsContainerEl.empty();
    this.updateStats();

    if (this.pinRows.length === 0) {
      const emptyNotice = this.pinsContainerEl.createDiv({ cls: "umlcanvas-chip-pins-empty" });
      emptyNotice.createSpan({ text: "No pins defined yet. Click '+ Add Pin' or use the Bus Generator above." });
      return;
    }

    // Table Header
    const tableHeader = this.pinsContainerEl.createDiv({ cls: "umlcanvas-chip-table-row is-header" });
    tableHeader.createDiv({ cls: "col-num", text: "#" });
    tableHeader.createDiv({ cls: "col-name", text: "Pin Name" });
    tableHeader.createDiv({ cls: "col-dir", text: "Direction" });
    tableHeader.createDiv({ cls: "col-side", text: "Side" });
    tableHeader.createDiv({ cls: "col-datatype", text: "Bus / Label" });
    tableHeader.createDiv({ cls: "col-actions", text: "Actions" });

    // Table Body Rows
    this.pinRows.forEach((row, idx) => {
      const rowEl = this.pinsContainerEl!.createDiv({ cls: "umlcanvas-chip-table-row" });

      // Col: Index
      rowEl.createDiv({ cls: "col-num", text: String(idx + 1) });

      // Col: Name Input
      const nameCol = rowEl.createDiv({ cls: "col-name" });
      const nameInput = nameCol.createEl("input", {
        type: "text",
        value: row.name,
        cls: "umlcanvas-chip-input-cell",
        placeholder: "Pin name",
      });
      nameInput.addEventListener("input", () => {
        row.name = nameInput.value;
        this.clearError();
      });

      // Col: Direction Select
      const dirCol = rowEl.createDiv({ cls: "col-dir" });
      const dirSelect = dirCol.createEl("select", { cls: "umlcanvas-chip-select-cell" });
      dirSelect.createEl("option", { value: "in", text: "in ▶" });
      dirSelect.createEl("option", { value: "out", text: "▶ out" });
      dirSelect.createEl("option", { value: "inout", text: "◀▶ inout" });
      dirSelect.value = row.direction;
      dirSelect.addEventListener("change", () => {
        row.direction = dirSelect.value as PortDirection;
        this.updateStats();
      });

      // Col: Side Select
      const sideCol = rowEl.createDiv({ cls: "col-side" });
      const sideSelect = sideCol.createEl("select", { cls: "umlcanvas-chip-select-cell" });
      sideSelect.createEl("option", { value: "auto", text: "Auto" });
      sideSelect.createEl("option", { value: "left", text: "Left" });
      sideSelect.createEl("option", { value: "right", text: "Right" });
      sideSelect.createEl("option", { value: "top", text: "Top" });
      sideSelect.createEl("option", { value: "bottom", text: "Bottom" });
      sideSelect.value = row.side;
      sideSelect.addEventListener("change", () => {
        row.side = sideSelect.value as "auto" | Side;
        this.updateStats();
      });

      // Col: Data Type / Bus Label
      const dtCol = rowEl.createDiv({ cls: "col-datatype" });
      const dtInput = dtCol.createEl("input", {
        type: "text",
        value: row.dataType ?? "",
        cls: "umlcanvas-chip-dt-cell",
        placeholder: "e.g. [7:0], clk",
      });
      dtInput.addEventListener("input", () => {
        row.dataType = dtInput.value.trim() || undefined;
      });

      // Col: Actions (Move Up, Move Down, Delete)
      const actionsCol = rowEl.createDiv({ cls: "col-actions" });

      const upBtn = actionsCol.createEl("button", {
        text: "▲",
        title: "Move pin up",
        cls: "umlcanvas-chip-icon-btn",
      });
      upBtn.disabled = idx === 0;
      upBtn.addEventListener("click", () => {
        if (idx > 0) {
          const temp = this.pinRows[idx - 1];
          this.pinRows[idx - 1] = this.pinRows[idx];
          this.pinRows[idx] = temp;
          this.renderPinRows();
        }
      });

      const downBtn = actionsCol.createEl("button", {
        text: "▼",
        title: "Move pin down",
        cls: "umlcanvas-chip-icon-btn",
      });
      downBtn.disabled = idx === this.pinRows.length - 1;
      downBtn.addEventListener("click", () => {
        if (idx < this.pinRows.length - 1) {
          const temp = this.pinRows[idx + 1];
          this.pinRows[idx + 1] = this.pinRows[idx];
          this.pinRows[idx] = temp;
          this.renderPinRows();
        }
      });

      const deleteBtn = actionsCol.createEl("button", {
        text: "✕",
        title: "Delete pin",
        cls: "umlcanvas-chip-icon-btn is-danger",
      });
      deleteBtn.addEventListener("click", () => {
        this.pinRows.splice(idx, 1);
        this.renderPinRows();
      });
    });
  }

  private updateStats(): void {
    if (!this.pinCountBadgeEl) return;
    const count = this.pinRows.length;
    const inCount = this.pinRows.filter((p) => p.direction === "in").length;
    const outCount = this.pinRows.filter((p) => p.direction === "out").length;
    const inoutCount = this.pinRows.filter((p) => p.direction === "inout").length;

    this.pinCountBadgeEl.textContent = `${count} pins (${inCount} in, ${outCount} out, ${inoutCount} bidir)`;
  }

  private showError(msg: string): void {
    if (this.errorMsgEl) {
      this.errorMsgEl.textContent = msg;
      this.errorMsgEl.style.display = "block";
    }
  }

  private clearError(): void {
    if (this.errorMsgEl) {
      this.errorMsgEl.style.display = "none";
      this.errorMsgEl.textContent = "";
    }
  }

  private handleSubmit(): void {
    const name = this.chipName.trim();
    if (!name) {
      this.showError("Please enter a Chip Name.");
      return;
    }

    if (this.pinRows.length === 0) {
      this.showError("Please configure at least one pin for the chip.");
      return;
    }

    // Validate and build PortSpecs
    const portSpecs: PortSpec[] = [];
    for (let i = 0; i < this.pinRows.length; i++) {
      const row = this.pinRows[i];
      const pinName = row.name.trim();
      if (!pinName) {
        this.showError(`Pin #${i + 1} has an empty name.`);
        return;
      }
      portSpecs.push({
        id: row.id,
        name: pinName,
        direction: row.direction,
        side: row.side === "auto" ? undefined : row.side,
        dataType: row.dataType,
      });
    }

    const id =
      this.options.initialDefinition?.id ??
      (this.options.existingNode?.metadata?.chipInterfaceId as string) ??
      `chip-${name.toLowerCase().replace(/[^a-z0-9_-]/g, "-")}-${Date.now()}`;

    const definition = defaultChipService.createChipInterface(id, name, portSpecs);
    if (this.options.initialDefinition) {
      definition.version = this.options.initialDefinition.version;
    }

    this.close();

    this.options.onSave(definition, {
      saveToLibrary: this.saveToLibrary,
      propagateToInstances: this.propagateToInstances,
    });
  }
}
