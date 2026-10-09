import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";

import { ComposerOptionRow } from "./ComposerOptionRow";

const render = (props: Partial<Parameters<typeof ComposerOptionRow>[0]> = {}) =>
  renderToStaticMarkup(
    <ComposerOptionRow
      label="Incremental"
      selected={false}
      shortcutKey={1}
      disabled={false}
      onSelect={() => {}}
      {...props}
    />,
  );

describe("ComposerOptionRow", () => {
  it("shows its shortcut until selected, then a check instead", () => {
    expect(render()).toContain("<kbd");
    expect(render({ selected: true })).not.toContain("<kbd");
    expect(render({ selected: true })).toContain('aria-pressed="true"');
  });

  it("hides a description that only repeats the label", () => {
    expect(render({ description: "Incremental" }).match(/Incremental/g)).toHaveLength(1);
    expect(render({ description: "One module at a time" })).toContain("One module at a time");
  });
});
