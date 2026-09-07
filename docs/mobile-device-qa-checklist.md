# Mobile Device QA Checklist — `/play`

Emulation covers layout and touch *events*. It does not reproduce iOS Safari's
gesture handling, its collapsing URL bar, safe-area insets, or real touch
latency — and emulated WebKit is desktop WebKit in a small viewport, not iOS
Safari. Run this pass on real hardware against a Vercel preview before release.

Device: ____________________  OS/browser: ____________________  Date: __________

## Gestures
- [ ] Long-press a card opens the context sheet, and **no iOS text-selection
      callout or magnifier appears** over the board.
- [ ] Long-press then drag (finger moves >10px before 500ms) drags the card and
      does **not** open the menu.
- [ ] Long-press with a slight wobble (3–10px) opens the menu and does **not**
      also move the card or attach a weapon to a Warrior underneath.
- [ ] One finger on the background pans; one finger on a card drags it.
- [ ] Pinch zooms, anchored where the fingers are, and feels smooth (not steppy).
- [ ] Pinching hard past maximum zoom does not walk the board into a corner.
- [ ] Bringing a second finger down mid-drag cancels the drag; the card returns
      to where it started rather than committing.
- [ ] Double-tap a card toggles meek. Double-tap the background returns to fit.
- [ ] Panning twice quickly does **not** reset the camera.
- [ ] Panning and lifting your finger over a zone does **not** move an armed card.

## Layout
- [ ] Scrolling the page does not move the board; the board owns its gestures.
- [ ] Safari's URL bar collapsing/expanding rescales the board without breaking
      the layout or clipping a zone.
- [ ] On a notched device in landscape, no zone or control sits under the notch
      or the home indicator.
- [ ] The floating toolbar does not cover cards in hand.
- [ ] The camera jump cluster does not cover Concede or the sidebar piles.

## Orientation
- [ ] Portrait shows the rotate prompt.
- [ ] "Continue anyway" dismisses it and renders the board.
- [ ] "Back to lobby" leaves the game.
- [ ] With rotation lock ON, a live game is still reachable and concedable.
- [ ] Rotating landscape → portrait → landscape restores the board correctly and
      does not leave the camera showing dead space.
- [ ] iPad Split View / Slide Over does not strand the player.

## Two real devices, one game
- [ ] Tap-to-move: arm a card, tap a destination — it lands where you tapped on
      **both** screens.
- [ ] Cross-side: move a Lost Soul to the opponent's Land of Redemption using
      the rail while zoomed to your own side. Correct on both screens.
- [ ] Tap into opponent territory lands where you touched, not offset.
- [ ] A card into the Field of Battle keeps its owner (it must **not** change
      sides) and keeps its position.
- [ ] Arm a card, have the opponent discard it — the rail closes rather than
      moving it out of the discard.
- [ ] Paragon: the rail offers the shared Land of Bondage, not a per-seat one.

## Menus
- [ ] A long-pressed menu can be dismissed by tapping outside it.
- [ ] Every menu row is comfortably tappable; no mis-taps on adjacent rows.
- [ ] Counter steppers (+/−) are hittable without zooming.
- [ ] Sidebar piles (discard, banish, reserve, LoR) open on tap.

## Wave 9 (2026-09-02) — emulation-verified, needs real-iOS confirmation
- [ ] Portrait "Continue anyway": the top bar is TWO rows (End Turn/Concede on
      top, phase chips below). The chip strip scrolls by swipe with edge fades;
      a tap near Upkeep must never fire End Turn or Concede.
- [ ] With the iOS keyboard open over the chat composer, the composer and any
      Grant/Deny banner stay visible and tappable (emulated 235px viewport was
      fine; `visualViewport` behavior differs on real Safari).
- [ ] There is no End Battle button anywhere: the attacker's band shows only
      "⚑ Win", the defender's only "🏳 Battle Lost", and tapping another phase
      chip (or End Turn) closes an open battle — including while the opponent's
      soul chooser is up (a deliberate walk-away, no soul awarded).
- [ ] Tapping the card scan inside the full-screen reader closes it, and no
      iOS image-save callout appears on the tap.
- [ ] The pause (⏸) button beside the turn chip requests a pause and the
      opponent's accept flows back.

## Known gaps — confirm these are still only annoyances, not blockers
- [ ] Hand / Land of Bondage zone menus are unreachable on touch.
- [ ] Multi-card selection is unavailable on touch.
- [ ] The hover preview may flash in a screen corner during a press.
