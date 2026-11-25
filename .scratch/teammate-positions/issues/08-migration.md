# Migration

Type: grilling
Status: open
Blocked-by: 01, 04

## Question

How do existing data and names move to positions? Cover stored teammates with kind
ship/scout/inline in `PivotStore` (and its migrations), the `teammateModels` and
`teammateKindModelSelections` settings, shipped clients that still read `kind`, the MCP
tools named after kinds (`record_scout_report`, `promote_scout`), and teammates hosted on a
remote environment running an older server. Use `codebase-design` for where the seam goes
so `PivotService`, `PivotHost` and the cards stop branching on kind literals.

From What a position is: positions are environment-only, so decide what happens to existing
project overrides of `teammateModels` and `teammateKindModelSelections`. The teammate row's
`kind` and `model_entry` become one `position` snapshot column; decide the snapshot that old
ship, scout and inline rows get.
