# Teammate card

Type: grilling
Status: resolved
Blocked-by: 03, 15

## Question

What does a teammate card show, and in what order do cards sit?

The sketch shows project, elapsed time with "working", title, PR number, and the
provider icon. Decide the fields, how each status from ticket 03 looks, how a card asks
for attention (needs a decision, pending approval, failed), card order, and what finished
or torn-down teammates look like. The card's data is what crosses the wire to every
client, so keep it small (AGENTS.md on WebSocket payloads).

## Carried forward from decisions

A card shows whether its teammate has a decision open with the Pivot or held for the
user.

## Resolution

**Decided 2026-09-29.** The user's mockup, corrected: the cards along the top are
teammates, the large panel is the Pivot chat, and the composer below talks to the Pivot.
The folder and project name on each card go, because a Pivot view is one project.

1. **Card layout.**
   - Top left: the status (colored dot, elapsed time, label, such as "3m working").
   - Top right: the actions menu (View chat, View diff, View files, View preview).
   - Middle: the teammate's title.
   - Bottom left: the PR number if there is one. A scout shows "Scout" there, since
     scouts never open PRs.
   - Bottom right: the provider icon.
2. **Status look.** Each of the eight statuses has a dot color and a label. An
   escalated decision reads "needs you". The attention statuses (`waiting`, `blocked`,
   `failed`, `unreported`, and an escalated decision) also get an accent border.
3. **No motion.** The elapsed time updates at most once a minute. Nothing on a card
   animates: no ticking timer, no spinner (AGENTS.md "Taste").
4. **Stable dispatch order.** Cards never reorder when a status changes.
5. **Small on the wire.** Everything on the card comes from the thread shell
   (`teammate: { kind, status }`, title, PR links, model selection), so nothing new is
   sent per card.
