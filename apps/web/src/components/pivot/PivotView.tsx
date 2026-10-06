import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { teammatesOfPivot } from "@t3tools/client-runtime/pivot-state";
import type { ScopedThreadRef, ThreadId } from "@t3tools/contracts";
import { useAtomValue } from "@effect/atom-react";
import { EllipsisIcon, LayoutDashboardIcon } from "lucide-react";
import {
  type PointerEvent as ReactPointerEvent,
  lazy,
  type ReactNode,
  Suspense,
  useMemo,
  useRef,
  useState,
} from "react";

import { cn } from "../../lib/utils";
import {
  deriveProviderEntriesByEnvironment,
  type ProviderInstanceEntry,
} from "../../providerInstances";
import { useServerConfigs, useThreadShell } from "../../state/entities";
import { usePivotState } from "../../state/pivot";
import {
  primaryServerAvailableEditorsAtom,
  primaryServerKeybindingsAtom,
} from "../../state/server";
import ChatView from "../ChatView";
import { Button } from "../ui/button";
import {
  Menu,
  MenuCheckboxItem,
  MenuItem,
  MenuPopup,
  MenuRadioGroup,
  MenuRadioItem,
  MenuSeparator,
  MenuSub,
  MenuSubPopup,
  MenuSubTrigger,
  MenuTrigger,
} from "../ui/menu";
import { toastManager } from "../ui/toast";
import { openNewPivotDialog } from "./NewPivotDialog";
import { PivotViewSwitch } from "./PivotChatChrome";
import {
  hidePane,
  type LayoutNode,
  listPanes,
  movePaneToEdge,
  openTeammatePane,
  type PaneKind,
  PIVOT_LAYOUT_PRESETS,
  type PivotLayoutEdge,
  type PivotLayoutPreset,
  pivotLayoutPreset,
  resizeSplit,
  showPane,
  type TeammatePaneKind,
} from "./pivotLayout.logic";
import { PivotTeammatesPane } from "./PivotTeammatesPane";
import { InPivotViewContext } from "./pivotViewContext";
import { usePivotLayout, usePivotViewStore } from "./pivotViewStore";
import {
  clampWallpaperDim,
  DEFAULT_WALLPAPER_DIM,
  downscaleWallpaper,
  usePivotWallpaper,
} from "./pivotWallpaper";

const PreviewPanel = lazy(() =>
  import("../preview/PreviewPanel").then((module) => ({ default: module.PreviewPanel })),
);
const DiffPanel = lazy(() => import("../DiffPanel"));
const FilePreviewPanel = lazy(() => import("../files/FilePreviewPanel"));

const PANE_TITLES: Record<PaneKind, string> = {
  "pivot-chat": "Pivot",
  teammates: "Teammates",
  teammate: "Teammate",
  preview: "Preview",
  files: "Files",
  diff: "Diff",
};

const PRESET_LABELS: Record<PivotLayoutPreset, string> = {
  "teammates-top": "Teammates above the chat",
  "chat-left": "Chat left, teammates right",
  "three-columns": "Chat, teammates, teammate",
  "preview-below": "Chat and teammates above a preview",
};

const EDGES: ReadonlyArray<{ readonly edge: PivotLayoutEdge; readonly label: string }> = [
  { edge: "top", label: "Move to top" },
  { edge: "bottom", label: "Move to bottom" },
  { edge: "left", label: "Move to left" },
  { edge: "right", label: "Move to right" },
];

const DIM_LEVELS = [0, 0.2, 0.4, 0.6, 0.8] as const;

/**
 * A Pivot full screen: a layout the user composes from panes, with no sidebar.
 * The layout tree is the only layout state, kept per Pivot on this device.
 */
export function PivotView(props: { pivot: ScopedThreadRef }) {
  const { pivot } = props;
  const pivotShell = useThreadShell(pivot);
  const state = usePivotState(pivot.environmentId);
  const record = state?.pivots[pivot.threadId] ?? null;
  const teammates = useMemo(
    () => (state === null ? [] : teammatesOfPivot(state, pivot.threadId)),
    [pivot.threadId, state],
  );
  const layout = usePivotLayout(pivot);
  const setStoredLayout = usePivotViewStore((store) => store.setLayout);
  const setLayout = (next: LayoutNode) => {
    if (next !== layout) setStoredLayout(pivot, next);
  };
  const [wallpaper, setWallpaper] = usePivotWallpaper();
  const fileInput = useRef<HTMLInputElement>(null);
  const configs = useServerConfigs();
  const config = configs.get(pivot.environmentId);
  const providerEntries = useMemo(
    () =>
      config === undefined
        ? new Map<string, ProviderInstanceEntry>()
        : (deriveProviderEntriesByEnvironment([
            [pivot.environmentId, config.providers, config.settings],
          ]).get(pivot.environmentId) ?? new Map<string, ProviderInstanceEntry>()),
    [config, pivot.environmentId],
  );
  const openPane = (kind: TeammatePaneKind, teammate: ThreadId) =>
    setLayout(openTeammatePane(layout, kind, teammate));
  const panes = new Set(listPanes(layout));

  const pickWallpaper = async (file: File | undefined) => {
    if (file === undefined) return;
    try {
      const image = await downscaleWallpaper(file);
      setWallpaper({ image, dim: wallpaper?.dim ?? DEFAULT_WALLPAPER_DIM });
    } catch {
      toastManager.add({ type: "error", title: "That image could not be used as a wallpaper." });
    }
  };

  const renderPane = (node: Extract<LayoutNode, { type: "pane" }>) => {
    const teammateRef =
      node.teammate === undefined ? null : scopeThreadRef(pivot.environmentId, node.teammate);
    switch (node.kind) {
      case "pivot-chat":
        return (
          <ChatView
            environmentId={pivot.environmentId}
            threadId={pivot.threadId}
            routeKind="server"
          />
        );
      case "teammates":
        return (
          <PivotTeammatesPane
            environmentId={pivot.environmentId}
            teammates={teammates}
            providerEntries={providerEntries}
            onOpen={openPane}
          />
        );
      default:
        return teammateRef === null ? (
          <p className="p-4 text-sm text-muted-foreground">
            Pick a teammate from its card's menu to show it here.
          </p>
        ) : (
          <TeammatePaneBody kind={node.kind} teammateRef={teammateRef} />
        );
    }
  };

  return (
    <InPivotViewContext value>
      <div className="relative flex h-full min-h-0 flex-col" data-pivot-view="true">
        {wallpaper !== null ? (
          <>
            <img
              src={wallpaper.image}
              alt=""
              aria-hidden
              className="pointer-events-none absolute inset-0 size-full object-cover"
            />
            <div
              aria-hidden
              className="pointer-events-none absolute inset-0 bg-background"
              style={{ opacity: clampWallpaperDim(wallpaper.dim) }}
            />
          </>
        ) : null}
        <header className="relative flex h-[var(--workspace-topbar-height)] shrink-0 items-center gap-3 bg-background px-3">
          <LayoutDashboardIcon className="size-4 text-muted-foreground" />
          <span className="min-w-0 truncate text-sm font-medium">
            {pivotShell?.title ?? "Pivot"}
            {record?.retiredAt != null ? " (retired)" : ""}
          </span>
          <div className="ml-auto flex items-center gap-2">
            <PivotViewSwitch environmentId={pivot.environmentId} threadId={pivot.threadId} force />
            <Menu>
              <MenuTrigger
                render={<Button size="icon-sm" variant="ghost" aria-label="Pivot view menu" />}
              >
                <EllipsisIcon />
              </MenuTrigger>
              <MenuPopup side="bottom" align="end">
                {pivotShell !== null && record?.retiredAt === null ? (
                  <MenuItem
                    onClick={() =>
                      openNewPivotDialog({
                        environmentId: pivot.environmentId,
                        projectId: pivotShell.projectId,
                      })
                    }
                  >
                    New Pivot conversation
                  </MenuItem>
                ) : null}
                <MenuSub>
                  <MenuSubTrigger>Layout</MenuSubTrigger>
                  <MenuSubPopup>
                    {PIVOT_LAYOUT_PRESETS.map((preset) => (
                      <MenuItem key={preset} onClick={() => setLayout(pivotLayoutPreset(preset))}>
                        {PRESET_LABELS[preset]}
                      </MenuItem>
                    ))}
                  </MenuSubPopup>
                </MenuSub>
                <MenuSub>
                  <MenuSubTrigger>Panes</MenuSubTrigger>
                  <MenuSubPopup>
                    {(Object.keys(PANE_TITLES) as PaneKind[]).map((kind) => (
                      <MenuCheckboxItem
                        key={kind}
                        checked={panes.has(kind)}
                        // At least one pane stays: hiding the last one is refused.
                        disabled={panes.has(kind) && panes.size === 1}
                        onCheckedChange={(checked) =>
                          setLayout(checked ? showPane(layout, kind) : hidePane(layout, kind))
                        }
                      >
                        {PANE_TITLES[kind]}
                      </MenuCheckboxItem>
                    ))}
                  </MenuSubPopup>
                </MenuSub>
                <MenuSeparator />
                <MenuItem onClick={() => fileInput.current?.click()}>
                  {wallpaper === null ? "Set wallpaper…" : "Change wallpaper…"}
                </MenuItem>
                {wallpaper !== null ? (
                  <>
                    <MenuSub>
                      <MenuSubTrigger>Dim wallpaper</MenuSubTrigger>
                      <MenuSubPopup>
                        <MenuRadioGroup
                          value={String(wallpaper.dim)}
                          onValueChange={(value) =>
                            setWallpaper({ ...wallpaper, dim: clampWallpaperDim(Number(value)) })
                          }
                        >
                          {DIM_LEVELS.map((level) => (
                            <MenuRadioItem key={level} value={String(level)}>
                              {level === 0 ? "None" : `${Math.round(level * 100)}%`}
                            </MenuRadioItem>
                          ))}
                        </MenuRadioGroup>
                      </MenuSubPopup>
                    </MenuSub>
                    <MenuItem onClick={() => setWallpaper(null)}>Remove wallpaper</MenuItem>
                  </>
                ) : null}
              </MenuPopup>
            </Menu>
            <input
              ref={fileInput}
              type="file"
              accept="image/*"
              hidden
              onChange={(event) => {
                void pickWallpaper(event.target.files?.[0]);
                event.target.value = "";
              }}
            />
          </div>
        </header>
        <div className="relative min-h-0 flex-1 p-1.5">
          <LayoutNodeView
            node={layout}
            path={[]}
            onResize={(path, sizes) => setLayout(resizeSplit(layout, path, sizes))}
            renderPane={(node) => (
              <PaneFrame
                node={node}
                single={panes.size === 1}
                teammateTitle={teammates.find((t) => t.threadId === node.teammate)?.title ?? null}
                onHide={() => setLayout(hidePane(layout, node.kind))}
                onMove={(edge) => setLayout(movePaneToEdge(layout, node.kind, edge))}
              >
                {renderPane(node)}
              </PaneFrame>
            )}
          />
        </div>
      </div>
    </InPivotViewContext>
  );
}

function TeammatePaneBody(props: {
  kind: Exclude<PaneKind, "pivot-chat" | "teammates">;
  teammateRef: ScopedThreadRef;
}) {
  const shell = useThreadShell(props.teammateRef);
  const keybindings = useAtomValue(primaryServerKeybindingsAtom);
  const availableEditors = useAtomValue(primaryServerAvailableEditorsAtom);
  const [openFile, setOpenFile] = useState<string | null>(null);
  // Panes refresh their file reads when the teammate's latest run settles.
  const workspaceMutationId = shell?.latestRun?.completedAt ?? null;
  const { teammateRef } = props;
  switch (props.kind) {
    case "teammate":
      return (
        <ChatView
          key={teammateRef.threadId}
          environmentId={teammateRef.environmentId}
          threadId={teammateRef.threadId}
          routeKind="server"
          pivotReadOnly
        />
      );
    case "preview":
      return (
        <Suspense fallback={null}>
          <PreviewPanel
            key={teammateRef.threadId}
            mode="embedded"
            threadRef={teammateRef}
            checkoutPath={shell?.worktreePath ?? null}
            visible
          />
        </Suspense>
      );
    case "diff":
      return (
        <Suspense fallback={null}>
          <DiffPanel
            key={teammateRef.threadId}
            mode="embedded"
            threadRef={teammateRef}
            composerDraftTarget={teammateRef}
            workspaceMutationId={workspaceMutationId}
          />
        </Suspense>
      );
    case "files":
      return shell?.worktreePath == null ? (
        <p className="p-4 text-sm text-muted-foreground">This teammate has no worktree.</p>
      ) : (
        <Suspense fallback={null}>
          <FilePreviewPanel
            key={teammateRef.threadId}
            environmentId={teammateRef.environmentId}
            cwd={shell.worktreePath}
            projectName={shell.title}
            relativePath={openFile}
            threadRef={teammateRef}
            composerDraftTarget={teammateRef}
            keybindings={keybindings}
            availableEditors={availableEditors}
            revealLine={null}
            revealRequestId={0}
            onOpenFile={setOpenFile}
            onPendingChange={() => {}}
            selectedFilePending={false}
            workspaceMutationId={workspaceMutationId}
          />
        </Suspense>
      );
  }
}

function PaneFrame(props: {
  node: Extract<LayoutNode, { type: "pane" }>;
  single: boolean;
  teammateTitle: string | null;
  onHide: () => void;
  onMove: (edge: PivotLayoutEdge) => void;
  children: ReactNode;
}) {
  const { node } = props;
  // The Teammates pane is see-through, so a wallpaper shows behind the cards.
  const solid = node.kind !== "teammates";
  return (
    <section
      aria-label={PANE_TITLES[node.kind]}
      className={cn(
        "flex size-full min-h-0 min-w-0 flex-col overflow-hidden rounded-lg border border-border",
        solid ? "bg-background" : "bg-background/40",
      )}
    >
      <div className="flex h-8 shrink-0 items-center gap-2 border-b border-border px-2 text-xs">
        <span className="font-medium">{PANE_TITLES[node.kind]}</span>
        {props.teammateTitle !== null ? (
          <span className="min-w-0 truncate text-muted-foreground">{props.teammateTitle}</span>
        ) : null}
        <Menu>
          <MenuTrigger
            render={
              <Button
                size="icon-micro"
                variant="ghost-muted"
                aria-label="Pane menu"
                className="ml-auto"
              />
            }
          >
            <EllipsisIcon />
          </MenuTrigger>
          <MenuPopup side="bottom" align="end">
            {EDGES.map(({ edge, label }) => (
              <MenuItem key={edge} onClick={() => props.onMove(edge)}>
                {label}
              </MenuItem>
            ))}
            <MenuSeparator />
            <MenuItem disabled={props.single} onClick={props.onHide}>
              Hide pane
            </MenuItem>
          </MenuPopup>
        </Menu>
      </div>
      <div className="relative min-h-0 flex-1">{props.children}</div>
    </section>
  );
}

/** Renders the tree: splits as flex rows or columns with dividers between children. */
function LayoutNodeView(props: {
  node: LayoutNode;
  path: ReadonlyArray<number>;
  onResize: (path: ReadonlyArray<number>, sizes: ReadonlyArray<number>) => void;
  renderPane: (node: Extract<LayoutNode, { type: "pane" }>) => ReactNode;
}) {
  const { node } = props;
  const container = useRef<HTMLDivElement>(null);
  // While dragging, sizes live here and commit to the stored tree on release.
  const [dragSizes, setDragSizes] = useState<ReadonlyArray<number> | null>(null);
  if (node.type === "pane") return <>{props.renderPane(node)}</>;
  const sizes = dragSizes ?? node.sizes;
  const horizontal = node.type === "row";

  const startDrag = (index: number, event: ReactPointerEvent<HTMLDivElement>) => {
    const element = container.current;
    if (element === null) return;
    event.preventDefault();
    const rect = element.getBoundingClientRect();
    const extent = horizontal ? rect.width : rect.height;
    const origin = horizontal ? event.clientX : event.clientY;
    const start = [...node.sizes];
    let latest: ReadonlyArray<number> = start;
    const move = (moveEvent: PointerEvent) => {
      const delta = ((horizontal ? moveEvent.clientX : moveEvent.clientY) - origin) / extent;
      const next = [...start];
      next[index] = start[index]! + delta;
      next[index + 1] = start[index + 1]! - delta;
      if (next[index]! <= 0.02 || next[index + 1]! <= 0.02) return;
      latest = next;
      setDragSizes(next);
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      setDragSizes(null);
      if (latest !== start) props.onResize(props.path, latest);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  return (
    <div
      ref={container}
      className={cn("flex size-full min-h-0 min-w-0", horizontal ? "flex-row" : "flex-col")}
    >
      {node.children.map((child, index) => (
        <PaneSlot key={paneKey(child, index)} grow={sizes[index] ?? 1}>
          <LayoutNodeView
            node={child}
            path={[...props.path, index]}
            onResize={props.onResize}
            renderPane={props.renderPane}
          />
          {index < node.children.length - 1 ? (
            <div
              role="separator"
              aria-orientation={horizontal ? "vertical" : "horizontal"}
              onPointerDown={(event) => startDrag(index, event)}
              className={cn(
                "absolute z-10 bg-transparent hover:bg-border",
                horizontal
                  ? "top-0 -right-1.5 h-full w-1.5 cursor-col-resize"
                  : "-bottom-1.5 left-0 h-1.5 w-full cursor-row-resize",
              )}
            />
          ) : null}
        </PaneSlot>
      ))}
    </div>
  );
}

function PaneSlot(props: { grow: number; children: ReactNode }) {
  return (
    <div className="relative min-h-0 min-w-0 p-0.75" style={{ flex: `${props.grow} 1 0` }}>
      {props.children}
    </div>
  );
}

const paneKey = (node: LayoutNode, index: number): string =>
  node.type === "pane" ? node.kind : `${node.type}-${index}`;
