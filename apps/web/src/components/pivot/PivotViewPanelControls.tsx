import { PanelLayoutControls } from "../chat/PanelLayoutControls";

/**
 * Chat's header panel toggles, kept in the Pivot view's top bar so the row is the same in
 * both views. The panels they toggle don't exist in the Pivot view, so they stay greyed out.
 */
export function PivotViewPanelControls() {
  return (
    <PanelLayoutControls
      disabled
      terminalAvailable={false}
      terminalOpen={false}
      terminalShortcutLabel={null}
      threadPanelOpen={false}
      threadPanelPresentation="inline"
      threadPanelShortcutLabel={null}
      rightPanelAvailable={false}
      rightPanelOpen={false}
      rightPanelShortcutLabel={null}
      rightPanelUnavailableLabel="Not available in the Pivot view"
      onToggleTerminal={() => {}}
      onToggleThreadPanel={() => {}}
      onToggleRightPanel={() => {}}
    />
  );
}
