import {
  CircleAlertIcon,
  CircleCheckIcon,
  CircleDashedIcon,
  CircleDotDashedIcon,
  MessageCircleQuestionIcon,
  ShieldQuestionIcon,
  UserRoundIcon,
} from "lucide-react";

export type SidebarStatusIconKind =
  | "working"
  | "waiting"
  | "input"
  | "request"
  | "approval"
  | "failed"
  | "done";

/** The icon a sidebar row shows beside its status. Colored by the parent's text color. */
export function SidebarStatusIcon(props: { kind: SidebarStatusIconKind }) {
  const className = "size-4 shrink-0";
  switch (props.kind) {
    case "working":
      return <CircleDashedIcon aria-hidden className={className} />;
    case "waiting":
      return <CircleDotDashedIcon aria-hidden className={className} />;
    case "input":
      return <MessageCircleQuestionIcon aria-hidden className={className} />;
    case "request":
      return <UserRoundIcon aria-hidden className={className} />;
    case "approval":
      return <ShieldQuestionIcon aria-hidden className={className} />;
    case "failed":
      return <CircleAlertIcon aria-hidden className={className} />;
    case "done":
      return <CircleCheckIcon aria-hidden className={className} />;
  }
}
