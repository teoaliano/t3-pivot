import { EnvironmentId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  pivotDecisionAnswerText,
  pivotDecisionAttachmentDraftId,
} from "./pivotDecisionAttachments";

describe("pivotDecisionAnswerText", () => {
  it("answers with the typed text, even with images, since the user's words come first", () => {
    expect(
      pivotDecisionAnswerText({ typed: "Use this one.", selected: "Left", imageCount: 2 }),
    ).toBe("Use this one.");
  });

  it("answers with the picked option when nothing is typed", () => {
    expect(pivotDecisionAnswerText({ typed: null, selected: "Left", imageCount: 1 })).toBe("Left");
  });

  it("says what was sent when images are the whole answer", () => {
    expect(pivotDecisionAnswerText({ typed: null, selected: null, imageCount: 1 })).toBe(
      "See the attached image.",
    );
    expect(pivotDecisionAnswerText({ typed: null, selected: null, imageCount: 3 })).toBe(
      "See the 3 attached images.",
    );
  });

  it("has no answer without text, an option or an image", () => {
    expect(pivotDecisionAnswerText({ typed: null, selected: null, imageCount: 0 })).toBeNull();
  });
});

describe("pivotDecisionAttachmentDraftId", () => {
  const environmentId = EnvironmentId.make("env-1");

  it("keys each decision's answer images apart", () => {
    expect(pivotDecisionAttachmentDraftId(environmentId, "d1")).not.toBe(
      pivotDecisionAttachmentDraftId(environmentId, "d2"),
    );
    expect(pivotDecisionAttachmentDraftId(environmentId, "d1")).toBe(
      pivotDecisionAttachmentDraftId(environmentId, "d1"),
    );
  });
});
