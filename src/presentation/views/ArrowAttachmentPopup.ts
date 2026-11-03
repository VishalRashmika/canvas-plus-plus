import { Point } from "../../domain/value-objects/Point";
import { Size } from "../../domain/value-objects/Rect";
import { Side } from "../../domain/types";
import { setIcon } from "obsidian";

export interface ArrowAttachmentItem {
  id: string;
  kind: string;
  label: string;
  title: string;
  description: string;
  shortcut?: string;
  iconId?: string;
  category?: string;
  color?: string;
  customData?: unknown;
  defaultSize: Size;
}

export interface ArrowAttachmentPopupOptions {
  container: HTMLElement;
  position: Point; // Screen coordinates
  canvasPoint: Point; // Canvas coordinates
  fromNodeId: string;
  fromPortId?: string;
  fromSide?: Side;
  startPoint: Point; // Starting point of arrow on canvas
  onSelect: (item: ArrowAttachmentItem) => void;
  onDismissToEmpty: () => void;
  onOpenVaultNote?: () => void;
  onOpenVaultImage?: () => void;
  items?: ArrowAttachmentItem[];
}

export const DEFAULT_ATTACHMENT_ITEMS: ArrowAttachmentItem[] = [
  {
    id: "node",
    kind: "generic.rectangle",
    label: "Node",
    title: "Node",
    description: "Standard card for notes and ideas",
    shortcut: "1",
    defaultSize: { width: 140, height: 80 },
    category: "Cards & Shapes",
    iconSvg: `<svg viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="14" rx="2" fill="none" stroke="currentColor" stroke-width="2"/></svg>`,
  },
  {
    id: "triangle",
    kind: "generic.triangle",
    label: "Triangle",
    title: "",
    description: "Geometric triangle shape",
    shortcut: "2",
    defaultSize: { width: 120, height: 100 },
    category: "Cards & Shapes",
    iconSvg: `<svg viewBox="0 0 24 24"><polygon points="12,3 22,21 2,21" fill="none" stroke="currentColor" stroke-width="2"/></svg>`,
  },
  {
    id: "table",
    kind: "generic.table",
    label: "Table",
    title: "",
    description: "3×3 structured data grid",
    shortcut: "3",
    defaultSize: { width: 300, height: 180 },
    customData: {
      rows: 3,
      cols: 3,
      cells: [
        ["", "", ""],
        ["", "", ""],
        ["", "", ""],
      ],
    },
    category: "Structured",
    iconSvg: `<svg viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="2" fill="none" stroke="currentColor" stroke-width="2"/><line x1="3" y1="9" x2="21" y2="9" stroke="currentColor" stroke-width="2"/><line x1="3" y1="15" x2="21" y2="15" stroke="currentColor" stroke-width="2"/><line x1="9" y1="3" x2="9" y2="21" stroke="currentColor" stroke-width="2"/><line x1="15" y1="3" x2="15" y2="21" stroke="currentColor" stroke-width="2"/></svg>`,
  },
  {
    id: "sticky-note",
    kind: "generic.stickyNote",
    label: "Sticky Note",
    title: "Sticky Note",
    description: "Yellow colored sticky note",
    shortcut: "4",
    color: "3",
    defaultSize: { width: 180, height: 140 },
    category: "Cards & Shapes",
    iconSvg: `<svg viewBox="0 0 24 24"><path d="M4 3h16a1 1 0 0 1 1 1v11l-5 5H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z" fill="none" stroke="currentColor" stroke-width="2"/><path d="M16 15v5l5-5h-5z" fill="currentColor"/></svg>`,
  },
  {
    id: "circle",
    kind: "generic.circle",
    label: "Circle",
    title: "",
    description: "Circular shape or milestone",
    shortcut: "5",
    defaultSize: { width: 90, height: 90 },
    category: "Cards & Shapes",
    iconSvg: `<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="2"/></svg>`,
  },
  {
    id: "diamond",
    kind: "generic.diamond",
    label: "Diamond",
    title: "",
    description: "Decision or branch point",
    shortcut: "6",
    defaultSize: { width: 100, height: 80 },
    category: "Cards & Shapes",
    iconSvg: `<svg viewBox="0 0 24 24"><polygon points="12,2 22,12 12,22 2,12" fill="none" stroke="currentColor" stroke-width="2"/></svg>`,
  },
  {
    id: "text",
    kind: "generic.text",
    label: "Text",
    title: "Text",
    description: "Plain text label",
    shortcut: "7",
    defaultSize: { width: 140, height: 40 },
    category: "Text & Media",
    iconSvg: `<svg viewBox="0 0 24 24"><polyline points="4 7 4 4 20 4 20 7" fill="none" stroke="currentColor" stroke-width="2"/><line x1="12" y1="4" x2="12" y2="20" stroke="currentColor" stroke-width="2"/><line x1="9" y1="20" x2="15" y2="20" stroke="currentColor" stroke-width="2"/></svg>`,
  },
  {
    id: "vault-note",
    kind: "obsidian.note",
    label: "Vault Note",
    title: "Note",
    description: "Markdown note from your vault",
    shortcut: "8",
    defaultSize: { width: 340, height: 240 },
    category: "Text & Media",
    iconSvg: `<svg viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" fill="none" stroke="currentColor" stroke-width="2"/><polyline points="14 2 14 8 20 8" fill="none" stroke="currentColor" stroke-width="2"/><line x1="16" y1="13" x2="8" y2="13" stroke="currentColor" stroke-width="2"/><line x1="16" y1="17" x2="8" y2="17" stroke="currentColor" stroke-width="2"/></svg>`,
  },
  {
    id: "image",
    kind: "generic.image",
    label: "Image",
    title: "Image",
    description: "Image card or attachment",
    shortcut: "9",
    defaultSize: { width: 220, height: 260 },
    category: "Text & Media",
    iconSvg: `<svg viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="2" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="8.5" cy="8.5" r="1.5" fill="currentColor"/><polyline points="21 15 16 10 5 21" fill="none" stroke="currentColor" stroke-width="2"/></svg>`,
  },
  {
    id: "uml-class",
    kind: "uml.class",
    label: "UML Class",
    title: "Class",
    description: "UML class with members",
    shortcut: "0",
    defaultSize: { width: 160, height: 100 },
    category: "UML",
    iconSvg: `<svg viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="2" fill="none" stroke="currentColor" stroke-width="2"/><line x1="3" y1="9" x2="21" y2="9" stroke="currentColor" stroke-width="2"/></svg>`,
  },
];

function createElHelper<T extends HTMLElement>(
  parent: HTMLElement,
  tag: string,
  options?: { cls?: string; attr?: Record<string, string>; text?: string }
): T {
  if (typeof (parent as any).createEl === "function") {
    return (parent as any).createEl(tag, options);
  }
  const el = document.createElement(tag) as T;
  if (options?.cls) {
    el.className = options.cls;
  }
  if (options?.text) {
    el.textContent = options.text;
  }
  if (options?.attr) {
    for (const [k, v] of Object.entries(options.attr)) {
      el.setAttribute(k, v);
    }
  }
  parent.appendChild(el);
  return el;
}

export class ArrowAttachmentPopup {
  private container: HTMLElement;
  private popupEl: HTMLElement | null = null;
  private searchInput: HTMLInputElement | null = null;
  private listEl: HTMLElement | null = null;
  private options: ArrowAttachmentPopupOptions;
  private allItems: ArrowAttachmentItem[];
  private filteredItems: ArrowAttachmentItem[];
  private activeIndex: number = 0;
  private isDestroyed: boolean = false;
  private onDocMouseDownBound: (e: MouseEvent) => void;
  private onDocKeyDownBound: (e: KeyboardEvent) => void;

  constructor(options: ArrowAttachmentPopupOptions) {
    this.options = options;
    this.container = options.container;
    this.allItems = options.items ? [...options.items] : [...DEFAULT_ATTACHMENT_ITEMS];
    this.filteredItems = [...this.allItems];

    this.onDocMouseDownBound = this.handleDocumentMouseDown.bind(this);
    this.onDocKeyDownBound = this.handleDocumentKeyDown.bind(this);
  }

  public open(): void {
    if (this.popupEl || this.isDestroyed) return;

    const popup = createElHelper<HTMLElement>(this.container, "div", {
      cls: "umlcanvas-arrow-attachment-popup",
    });
    this.popupEl = popup;

    // Header with title & close button
    const header = createElHelper<HTMLElement>(popup, "div", {
      cls: "umlcanvas-attachment-header",
    });
    createElHelper<HTMLElement>(header, "span", {
      cls: "umlcanvas-attachment-title",
      text: "Attach to Arrow",
    });
    const closeBtn = createElHelper<HTMLButtonElement>(header, "button", {
      cls: "umlcanvas-attachment-close-btn",
      text: "×",
      attr: { title: "Dismiss and point to empty canvas (Esc)" },
    });
    closeBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      e.preventDefault();
      this.dismissToEmpty();
    });

    // Search input
    const searchWrap = createElHelper<HTMLElement>(popup, "div", {
      cls: "umlcanvas-attachment-search-wrap",
    });
    const input = createElHelper<HTMLInputElement>(searchWrap, "input", {
      cls: "umlcanvas-attachment-search",
      attr: {
        type: "text",
        placeholder: "Attach node, triangle, table, note...",
        spellcheck: "false",
      },
    });
    this.searchInput = input;

    // Tip line
    const tip = createElHelper<HTMLElement>(popup, "div", {
      cls: "umlcanvas-attachment-tip",
    });
    createElHelper<HTMLElement>(tip, "span", {
      text: "Esc: point to empty space",
    });
    createElHelper<HTMLElement>(tip, "span", {
      text: "↵: attach shape",
    });

    // List container
    const list = createElHelper<HTMLElement>(popup, "div", {
      cls: "umlcanvas-attachment-list",
    });
    this.listEl = list;

    this.renderItems();

    // Event listeners on search input
    input.addEventListener("input", () => {
      this.filter(input.value);
    });

    input.addEventListener("keydown", (e: KeyboardEvent) => {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        this.moveActive(1);
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        this.moveActive(-1);
      } else if (e.key === "Enter") {
        e.preventDefault();
        this.selectActive();
      } else if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        this.dismissToEmpty();
      } else if (!input.value && ["1", "2", "3", "4", "5", "6", "7", "8", "9", "0"].includes(e.key)) {
        const item = this.filteredItems.find((it) => it.shortcut === e.key);
        if (item) {
          e.preventDefault();
          this.selectItem(item);
        }
      }
    });

    // Position popup next to the drop point, clamped inside container
    this.updatePosition();

    // Attach global listeners for dismiss
    if (typeof document !== "undefined") {
      document.addEventListener("mousedown", this.onDocMouseDownBound, true);
      document.addEventListener("keydown", this.onDocKeyDownBound, true);
    }

    // Auto-focus input
    if (typeof window !== "undefined" && typeof window.requestAnimationFrame === "function") {
      window.requestAnimationFrame(() => {
        input.focus();
      });
    } else {
      input.focus();
    }
  }

  public get isOpen(): boolean {
    return Boolean(this.popupEl && !this.isDestroyed);
  }

  public getElement(): HTMLElement | null {
    return this.popupEl;
  }

  public getFilteredItems(): ArrowAttachmentItem[] {
    return [...this.filteredItems];
  }

  public getActiveItem(): ArrowAttachmentItem | undefined {
    return this.filteredItems[this.activeIndex];
  }

  public filter(query: string): void {
    const q = query.trim().toLowerCase();
    if (!q) {
      this.filteredItems = [...this.allItems];
    } else {
      this.filteredItems = this.allItems.filter((item) => {
        const matchLabel = item.label.toLowerCase().includes(q);
        const matchDesc = item.description.toLowerCase().includes(q);
        const matchKind = item.kind.toLowerCase().includes(q);
        const matchCat = item.category?.toLowerCase().includes(q) ?? false;
        return matchLabel || matchDesc || matchKind || matchCat;
      });
    }
    this.activeIndex = 0;
    this.renderItems();
  }

  public moveActive(delta: number): void {
    if (this.filteredItems.length === 0) return;
    this.activeIndex = (this.activeIndex + delta + this.filteredItems.length) % this.filteredItems.length;
    this.updateActiveHighlight();
  }

  public selectActive(): void {
    const item = this.getActiveItem();
    if (item) {
      this.selectItem(item);
    } else {
      this.dismissToEmpty();
    }
  }

  public selectIndex(index: number): void {
    if (index >= 0 && index < this.filteredItems.length) {
      this.selectItem(this.filteredItems[index]);
    }
  }

  public selectItem(item: ArrowAttachmentItem): void {
    if (this.isDestroyed) return;

    if (item.id === "vault-note" && this.options.onOpenVaultNote) {
      this.close();
      this.options.onOpenVaultNote();
      return;
    }

    if (item.id === "image" && this.options.onOpenVaultImage) {
      this.close();
      this.options.onOpenVaultImage();
      return;
    }

    this.close();
    this.options.onSelect(item);
  }

  public dismissToEmpty(): void {
    if (this.isDestroyed) return;
    this.close();
    this.options.onDismissToEmpty();
  }

  public close(): void {
    if (this.isDestroyed) return;
    this.isDestroyed = true;

    if (typeof document !== "undefined") {
      document.removeEventListener("mousedown", this.onDocMouseDownBound, true);
      document.removeEventListener("keydown", this.onDocKeyDownBound, true);
    }

    if (this.popupEl) {
      this.popupEl.remove();
      this.popupEl = null;
    }
    this.searchInput = null;
    this.listEl = null;
  }

  private renderItems(): void {
    if (!this.listEl) return;
    this.listEl.textContent = "";

    if (this.filteredItems.length === 0) {
      const emptyNotice = createElHelper<HTMLElement>(this.listEl, "div", {
        cls: "umlcanvas-menu-tip",
        text: "No matching items. Press Esc to point to empty space.",
      });
      return;
    }

    this.filteredItems.forEach((item, index) => {
      const itemEl = createElHelper<HTMLButtonElement>(this.listEl!, "button", {
        cls: "umlcanvas-attachment-item",
        attr: { "data-item-id": item.id },
      });
      if (index === this.activeIndex) {
        itemEl.classList.add("is-active");
      }

      // Icon
      const iconEl = createElHelper<HTMLElement>(itemEl, "span", {
        cls: "umlcanvas-attachment-item-icon",
      });
      if (item.iconSvg) {
        iconEl.innerHTML = item.iconSvg;
      }

      // Content (label & description)
      const contentEl = createElHelper<HTMLElement>(itemEl, "div", {
        cls: "umlcanvas-attachment-item-content",
      });
      createElHelper<HTMLElement>(contentEl, "span", {
        cls: "umlcanvas-attachment-item-label",
        text: item.label,
      });
      createElHelper<HTMLElement>(contentEl, "span", {
        cls: "umlcanvas-attachment-item-desc",
        text: item.description,
      });

      // Shortcut badge
      if (item.shortcut) {
        createElHelper<HTMLElement>(itemEl, "span", {
          cls: "umlcanvas-attachment-item-shortcut",
          text: item.shortcut,
        });
      }

      itemEl.addEventListener("mouseenter", () => {
        this.activeIndex = index;
        this.updateActiveHighlight();
      });

      itemEl.addEventListener("click", (e) => {
        e.stopPropagation();
        e.preventDefault();
        this.selectItem(item);
      });
    });
  }

  private updateActiveHighlight(): void {
    if (!this.listEl) return;
    const items = this.listEl.querySelectorAll(".umlcanvas-attachment-item");
    items.forEach((el, idx) => {
      if (idx === this.activeIndex) {
        el.classList.add("is-active");
        if (typeof (el as any).scrollIntoView === "function") {
          (el as any).scrollIntoView({ block: "nearest" });
        }
      } else {
        el.classList.remove("is-active");
      }
    });
  }

  private updatePosition(): void {
    if (!this.popupEl) return;

    const popupW = 280;
    const popupH = 340;

    let containerW = 800;
    let containerH = 600;
    if (typeof this.container.getBoundingClientRect === "function") {
      const rect = this.container.getBoundingClientRect();
      if (rect.width > 0) containerW = rect.width;
      if (rect.height > 0) containerH = rect.height;
    } else if (this.container.clientWidth > 0) {
      containerW = this.container.clientWidth;
      containerH = this.container.clientHeight;
    }

    let left = this.options.position.x;
    let top = this.options.position.y;

    // Clamp or flip if close to edge
    if (left + popupW > containerW - 12) {
      left = Math.max(12, left - popupW - 8);
    } else {
      left = Math.max(12, left + 8);
    }

    if (top + popupH > containerH - 12) {
      top = Math.max(12, containerH - popupH - 12);
    } else {
      top = Math.max(12, top - 20);
    }

    this.popupEl.style.left = `${Math.round(left)}px`;
    this.popupEl.style.top = `${Math.round(top)}px`;
  }

  private handleDocumentMouseDown(e: MouseEvent): void {
    if (this.isDestroyed || !this.popupEl) return;
    const target = e.target as Node;
    if (this.popupEl.contains(target)) {
      return;
    }
    // Clicked outside -> dismiss to empty space
    this.dismissToEmpty();
  }

  private handleDocumentKeyDown(e: KeyboardEvent): void {
    if (this.isDestroyed || !this.popupEl) return;
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      this.dismissToEmpty();
    }
  }
}
