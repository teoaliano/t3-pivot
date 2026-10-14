import {
  type ChatImageAttachment,
  type EnvironmentId,
  PROVIDER_SEND_TURN_MAX_IMAGE_BYTES,
} from "@t3tools/contracts";
import { useState } from "react";

import {
  DraftId,
  type ComposerImageAttachment,
  useComposerDraftStore,
  useComposerThreadDraft,
} from "../../composerDraftStore";
import {
  getUploadedAttachments,
  releaseAttachmentUpload,
  startAttachmentUpload,
  useAttachmentUploadStore,
} from "../../lib/attachmentUploadQueue";
import { attachmentUploadBlockReason } from "../../lib/attachmentUploadState";
import { prepareImageForAttachment } from "../../lib/imageCompression";
import { randomUUID } from "../../lib/utils";
import { toastManager } from "../ui/toast";

/**
 * The composer draft that holds one decision's answer images. It lives in the draft store
 * like a question's attachments, so the images survive a re-render and a route change.
 */
export function pivotDecisionAttachmentDraftId(
  environmentId: EnvironmentId,
  decisionId: string,
): DraftId {
  return DraftId.make(
    `${encodeURIComponent(JSON.stringify(environmentId))}:pivot-decision-${encodeURIComponent(decisionId)}`,
  );
}

export interface PivotDecisionAttachments {
  readonly images: ReadonlyArray<ComposerImageAttachment>;
  /** Images still being read and compressed, which are not in the draft yet. */
  readonly preparing: number;
  /** Why the answer cannot go out with these images yet, or null when it can. */
  readonly blockReason: string | null;
  readonly add: (files: ReadonlyArray<File>) => Promise<void>;
  readonly remove: (imageId: string) => void;
}

/** The answer's images as the decision composer shows them, uploading through the composer's queue. */
export function usePivotDecisionAttachments(input: {
  readonly environmentId: EnvironmentId;
  readonly decisionId: string;
}): PivotDecisionAttachments {
  const { environmentId, decisionId } = input;
  const target = pivotDecisionAttachmentDraftId(environmentId, decisionId);
  const { images } = useComposerThreadDraft(target);
  const uploads = useAttachmentUploadStore((state) => state.uploadsByImageId);
  const [preparing, setPreparing] = useState(0);

  const add = async (files: ReadonlyArray<File>) => {
    const imageFiles = files.filter((file) => file.type.startsWith("image/"));
    if (imageFiles.length === 0) return;
    setPreparing((count) => count + imageFiles.length);
    try {
      const prepared: ComposerImageAttachment[] = [];
      for (const file of imageFiles) {
        const result = await prepareImageForAttachment(file, PROVIDER_SEND_TURN_MAX_IMAGE_BYTES);
        if (!result.ok) {
          toastManager.add({
            type: "error",
            title:
              result.reason === "unreadable"
                ? `'${file.name}' could not be read as an image.`
                : `'${file.name}' is too large to attach, even after compression.`,
          });
          continue;
        }
        const attachmentFile = result.file;
        prepared.push({
          type: "image",
          id: randomUUID(),
          name: attachmentFile.name || "image",
          mimeType: attachmentFile.type,
          sizeBytes: attachmentFile.size,
          previewUrl: URL.createObjectURL(attachmentFile),
          file: attachmentFile,
        });
      }
      const accepted = new Set(useComposerDraftStore.getState().addImages(target, prepared));
      for (const image of prepared) {
        if (accepted.has(image.id)) {
          startAttachmentUpload({ environmentId, image, draftTarget: target });
        } else {
          URL.revokeObjectURL(image.previewUrl);
        }
      }
    } finally {
      setPreparing((count) => count - imageFiles.length);
    }
  };

  const remove = (imageId: string) => {
    const image = images.find((candidate) => candidate.id === imageId);
    releaseAttachmentUpload(imageId);
    useComposerDraftStore.getState().removeImage(target, imageId);
    if (image?.previewUrl.startsWith("blob:")) URL.revokeObjectURL(image.previewUrl);
  };

  return {
    images,
    preparing,
    blockReason: attachmentUploadBlockReason({
      imageIds: images.map((image) => image.id),
      uploadsByImageId: uploads,
      environmentId,
    }),
    add,
    remove,
  };
}

/**
 * The answer's images, uploaded and ready to send, or null while any is still uploading or
 * has failed. The uploads become the answer's attachments, so they are not released here.
 */
export function readyPivotDecisionImages(
  environmentId: EnvironmentId,
  decisionId: string,
): ChatImageAttachment[] | null {
  const target = pivotDecisionAttachmentDraftId(environmentId, decisionId);
  const images = useComposerDraftStore.getState().getComposerDraft(target)?.images ?? [];
  const uploaded = getUploadedAttachments({ environmentId, images });
  if (uploaded === null) return null;
  return uploaded.filter(
    (attachment): attachment is ChatImageAttachment => attachment.type === "image",
  );
}

/** Empties the answer's draft once the answer is recorded; the uploads now belong to the answer. */
export function clearPivotDecisionAttachments(environmentId: EnvironmentId, decisionId: string) {
  const target = pivotDecisionAttachmentDraftId(environmentId, decisionId);
  const store = useComposerDraftStore.getState();
  for (const image of store.getComposerDraft(target)?.images ?? []) {
    if (image.previewUrl.startsWith("blob:")) URL.revokeObjectURL(image.previewUrl);
  }
  store.clearComposerContent(target);
}

/**
 * The answer a decision records. Typed text wins over a picked option; an answer of images
 * alone still needs words, since the Pivot relays text, so it says what was sent.
 */
export function pivotDecisionAnswerText(input: {
  readonly typed: string | null;
  readonly selected: string | null;
  readonly imageCount: number;
}): string | null {
  if (input.typed !== null) return input.typed;
  if (input.selected !== null) return input.selected;
  if (input.imageCount === 0) return null;
  return input.imageCount === 1
    ? "See the attached image."
    : `See the ${input.imageCount} attached images.`;
}
