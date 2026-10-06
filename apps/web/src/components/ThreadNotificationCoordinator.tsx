import { presentThreadShell } from "@t3tools/client-runtime/state/models";
import { useAtomValue } from "@effect/atom-react";
import { useNavigate, useParams } from "@tanstack/react-router";
import type { PivotState } from "@t3tools/client-runtime/pivot-state";
import type { EnvironmentId, OrchestrationV2ThreadShell, ThreadId } from "@t3tools/contracts";
import { pivotTurnAnswersUser } from "@t3tools/shared/teammateStatus";
import * as Option from "effect/Option";
import {
  CircleAlertIcon,
  CircleCheckIcon,
  MessageCircleQuestionIcon,
  ShieldQuestionIcon,
} from "lucide-react";
import { type ReactNode, useCallback, useEffect, useRef } from "react";

import { getClientSettings, useClientSettings } from "../hooks/useSettings";
import { useEnvironmentIds } from "../state/environments";
import { environmentShell } from "../state/shell";
import {
  hasDesktopNotifications,
  hasNotificationSound,
  playNotificationSound,
  setNotificationBadge,
  unlockNotificationAudio,
} from "../threadNotifications";
import { usePivotState } from "../state/pivot";
import { resolveSidebarThreadStatus } from "./Sidebar.logic";
import { pivotNoticesBetween } from "./pivot/pivotNotifications.logic";
import { threadNotifiesUser } from "./sidebar/pivotNesting.logic";
import { toastManager } from "./ui/toast";

export function ThreadNotificationCoordinator() {
  const environmentIds = useEnvironmentIds();
  const mode = useClientSettings((settings) => settings.notificationMode);
  const inAppNotificationsEnabled = useClientSettings(
    (settings) => settings.inAppNotificationsEnabled,
  );
  const pending = useRef(
    new Map<string, { environmentId: EnvironmentId; notification: Notification }>(),
  );
  const onNotification = useCallback((environmentId: EnvironmentId, notification: Notification) => {
    pending.current.get(notification.tag)?.notification.close();
    pending.current.set(notification.tag, { environmentId, notification });
    setNotificationBadge(pending.current.size);
  }, []);

  useEffect(() => {
    const activeIds = new Set(environmentIds);
    const count = pending.current.size;
    for (const [tag, { environmentId, notification }] of pending.current) {
      if (activeIds.has(environmentId)) continue;
      notification.close();
      pending.current.delete(tag);
    }
    if (count !== pending.current.size) setNotificationBadge(pending.current.size);
  }, [environmentIds]);

  useEffect(() => {
    const clear = () => {
      for (const { notification } of pending.current.values()) notification.close();
      pending.current.clear();
      setNotificationBadge(0);
    };
    clear();
    if (!hasDesktopNotifications(mode)) return;
    const unsubscribe = window.desktopBridge?.onNotificationBadgeClear?.(clear);
    window.addEventListener("focus", clear);
    return () => {
      unsubscribe?.();
      window.removeEventListener("focus", clear);
      clear();
    };
  }, [mode]);

  useEffect(() => {
    if (!hasNotificationSound(mode)) return;
    document.addEventListener("pointerdown", unlockNotificationAudio);
    document.addEventListener("keydown", unlockNotificationAudio);
    return () => {
      document.removeEventListener("pointerdown", unlockNotificationAudio);
      document.removeEventListener("keydown", unlockNotificationAudio);
    };
  }, [mode]);

  if (mode === "off" && !inAppNotificationsEnabled) return null;

  return environmentIds.map((environmentId) => (
    <EnvironmentNotifications
      key={environmentId}
      environmentId={environmentId}
      onNotification={onNotification}
    />
  ));
}

interface NotificationState {
  readonly raw: OrchestrationV2ThreadShell;
  readonly attention: string | null;
  readonly completion: number | null;
}

function EnvironmentNotifications({
  environmentId,
  onNotification,
}: {
  environmentId: EnvironmentId;
  onNotification: (environmentId: EnvironmentId, notification: Notification) => void;
}) {
  const shell = useAtomValue(environmentShell.stateValueAtom(environmentId));
  // The shell reducer keeps the thread list and unchanged thread objects
  // stable, so this only rescans when a thread actually changed.
  const threads =
    shell.status === "live" && Option.isSome(shell.snapshot) ? shell.snapshot.value.threads : null;
  const mode = useClientSettings((settings) => settings.notificationMode);
  const inAppNotificationsEnabled = useClientSettings(
    (settings) => settings.inAppNotificationsEnabled,
  );
  const navigate = useNavigate();
  const { environmentId: activeEnvironmentId, threadId: activeThreadId } = useParams({
    strict: false,
  });
  const previous = useRef(new Map<ThreadId, NotificationState>());
  const pivotState = usePivotState(environmentId);

  /** Plays the sound, then shows a toast while focused elsewhere, or a desktop notification. */
  const emit = useCallback(
    (notice: {
      readonly kind: "input" | "completion";
      readonly title: string;
      readonly threadId: ThreadId;
      readonly description: string;
      readonly tone: "success" | "error" | "warning";
      readonly icon: ReactNode;
    }) => {
      const open = () =>
        void navigate({
          to: "/$environmentId/$threadId",
          params: { environmentId, threadId: notice.threadId },
        });
      if (hasNotificationSound(mode)) {
        void playNotificationSound(notice.kind, () =>
          hasNotificationSound(getClientSettings().notificationMode),
        );
      }
      if (
        inAppNotificationsEnabled &&
        document.visibilityState === "visible" &&
        document.hasFocus() &&
        (activeEnvironmentId !== environmentId || activeThreadId !== notice.threadId)
      ) {
        const toastId = toastManager.add({
          type: notice.tone,
          title: notice.title,
          description: notice.description,
          data: { hideCopyButton: true, leadingIcon: notice.icon },
          actionProps: {
            children: "Open thread",
            onClick: () => {
              toastManager.close(toastId);
              open();
            },
          },
        });
        return;
      }
      if (
        !hasDesktopNotifications(mode) ||
        (document.visibilityState === "visible" && document.hasFocus()) ||
        typeof Notification === "undefined" ||
        Notification.permission !== "granted"
      )
        return;
      try {
        const notification = new Notification(notice.title, {
          body: notice.description,
          tag: `${environmentId}:${notice.threadId}`,
          silent: true,
        });
        onNotification(environmentId, notification);
        notification.addEventListener("click", () => {
          notification.close();
          window.focus();
          open();
        });
      } catch {
        // Some browsers expose Notification but reject desktop presentation.
      }
    },
    [
      activeEnvironmentId,
      activeThreadId,
      environmentId,
      inAppNotificationsEnabled,
      mode,
      navigate,
      onNotification,
    ],
  );

  useEffect(() => {
    if (threads === null) {
      previous.current.clear();
      return;
    }
    const next = new Map<ThreadId, NotificationState>();
    for (const rawThread of threads) {
      if (rawThread.lineage.relationshipToParent === "subagent") continue;
      // A teammate's news reaches the user through its Pivot.
      if (!threadNotifiesUser(rawThread.id, pivotState)) continue;
      const prior = previous.current.get(rawThread.id);
      // The same object cannot produce a new notification.
      if (prior?.raw === rawThread) {
        next.set(rawThread.id, prior);
        continue;
      }
      const thread = presentThreadShell(environmentId, rawThread);
      const isPivot = pivotState?.pivots[rawThread.id] !== undefined;
      let status = resolveSidebarThreadStatus(thread);
      if (status === "ready" && thread.latestRun?.status === "failed") status = "failed";
      const attention =
        status === "input" || status === "approval" || status === "failed" || status === "limited"
          ? `${thread.latestRun?.runId ?? ""}:${status}`
          : null;
      const completedAt = Date.parse(thread.latestRun?.completedAt ?? "");
      // Commands left running (a dev server) read as ready; subagents and monitors wait.
      const completion =
        status === "ready" &&
        thread.latestRun?.status === "completed" &&
        Number.isFinite(completedAt)
          ? completedAt
          : (prior?.completion ?? null);
      next.set(thread.id, { raw: rawThread, attention, completion });
      if (!prior || thread.archivedAt !== null) continue;
      const kind =
        attention && attention !== prior.attention
          ? "input"
          : completion !== null && (prior.completion === null || completion > prior.completion)
            ? "completion"
            : null;
      if (!kind) continue;
      // A Pivot finishing a turn the user did not start (a teammate wake) is not news.
      if (kind === "completion" && isPivot && !pivotTurnAnswersUser(rawThread)) continue;
      const title =
        kind === "completion"
          ? "Thread completed"
          : status === "approval"
            ? "Approval needed"
            : status === "limited"
              ? "Usage limit reached"
              : status === "failed"
                ? "Thread failed"
                : "Input needed";
      emit({
        kind,
        title,
        threadId: thread.id,
        description: thread.title,
        tone: kind === "completion" ? "success" : status === "failed" ? "error" : "warning",
        icon:
          kind === "completion" ? (
            <CircleCheckIcon aria-hidden className="size-4 text-success-foreground" />
          ) : status === "approval" ? (
            <ShieldQuestionIcon aria-hidden className="size-4 text-warning-foreground" />
          ) : status === "failed" ? (
            <CircleAlertIcon aria-hidden className="size-4 text-destructive-foreground" />
          ) : (
            <MessageCircleQuestionIcon aria-hidden className="size-4 text-info-foreground" />
          ),
      });
    }
    previous.current = next;
  }, [emit, environmentId, pivotState, threads]);

  // A Pivot also speaks up when it holds a decision for the user or a scout's
  // findings are in; its teammates never notify on their own.
  const previousPivotState = useRef<PivotState | null>(null);
  useEffect(() => {
    if (pivotState === null) {
      previousPivotState.current = null;
      return;
    }
    const notices = pivotNoticesBetween(previousPivotState.current, pivotState);
    previousPivotState.current = pivotState;
    const titleOf = (pivotThreadId: ThreadId) =>
      threads?.find((thread) => thread.id === pivotThreadId)?.title ?? "Pivot";
    for (const notice of notices) {
      emit(
        notice.kind === "decision"
          ? {
              kind: "input",
              title: "The Pivot needs you",
              threadId: notice.pivotThreadId,
              description: titleOf(notice.pivotThreadId),
              tone: "warning",
              icon: (
                <MessageCircleQuestionIcon aria-hidden className="size-4 text-info-foreground" />
              ),
            }
          : {
              kind: "completion",
              title: "Scout findings ready",
              threadId: notice.pivotThreadId,
              description: notice.teammateTitle,
              tone: "success",
              icon: <CircleCheckIcon aria-hidden className="size-4 text-success-foreground" />,
            },
      );
    }
  }, [emit, pivotState, threads]);

  return null;
}
