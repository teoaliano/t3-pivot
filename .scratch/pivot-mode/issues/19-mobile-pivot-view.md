# Mobile Pivot view

Type: prototype
Status: closed (out of scope)
Blocked-by: 15, 16

## Question

How does a Pivot look and work in the mobile app?

Graduated from the map's fog once the desktop layout and the teammate card settled.
Mobile already gets the Pivot as a chat and teammates as threads, because both are
threads. Decide what mobile adds: whether it has a Pivot view at all or a simpler
teammate list above the Pivot chat, how the card from ticket 16 shrinks, how a held
decision is answered on a phone (the relay's `waiting_for_input` push lands here), and
which of Diff, Files and Preview mobile offers. Mobile has its own navigation
(`apps/mobile`), and the layout tree is desktop and web only. Prototype outside
production code, as the desktop sketches were.
