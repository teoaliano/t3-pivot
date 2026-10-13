import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";

import { PivotViewPanelControls } from "./PivotViewPanelControls";

describe("the Pivot view's header row", () => {
  it("keeps Chat's details, terminal and right panel buttons", () => {
    const html = renderToStaticMarkup(<PivotViewPanelControls />);
    expect(html).toContain('aria-label="Toggle thread details panel"');
    expect(html).toContain('aria-label="Toggle terminal drawer"');
    expect(html).toContain('aria-label="Toggle right panel"');
  });
});
