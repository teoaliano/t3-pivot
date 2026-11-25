import { Activity, type ReactNode } from "react";

// The neighbouring tab's rows, drawn by the list's own row renderer. Mounted with its tab
// neighbour and only shown during a swipe toward it; inert and hidden from assistive tech.
export function SidebarSwipePreviewList(props: {
  direction: 1 | -1;
  visible: boolean;
  children: ReactNode;
}) {
  return (
    <Activity mode={props.visible ? "visible" : "hidden"}>
      <div
        data-sidebar-swipe-preview
        data-direction={props.direction}
        aria-hidden
        inert
        className="pointer-events-none absolute inset-0 overflow-hidden bg-sidebar"
        style={{ transform: `translateX(${props.direction * 100}%)` }}
      >
        <ul role="presentation" className="flex flex-col gap-px">
          {props.children}
        </ul>
      </div>
    </Activity>
  );
}
