# ONE ELEVEN Website/App
One Eleven Racing

## Preview changes before committing

From this project folder, run `python3 tools/preview.py`, then open
[the local preview](http://127.0.0.1:8000/). Leave the command running while reviewing;
press Ctrl+C to stop it. Refresh a page after editing its files.

The preview shows the actual Home, Championship and Admin pages with sample data.
Use the controls at the top to switch pages and mobile/desktop sizes. Sample changes
last for the current browser tab; **Reset sample data** restores the starting example.
It does not sign in to Firebase or change live data, commit files, or publish anything.

## Homepage track

The track defaults to the next event in the active championship: the event after
the latest event with recorded results (including participation or bonus entries).
Before results exist it shows the first event; after the final event it shows TBD.
The name and track image update together when championship results change.

On the Admin page, select a track from the dropdown and press
**Save Race Info**. Choose **Automatic** and save to resume following the championship.
Overrides apply to the active season; a new season defaults to automatic.
With no active championship, the existing saved manual track is used.
Race date, time and weather continue to use their existing controls.

## Next-race calculations

Exact championship-position ranges support up to 10 drivers for one race and
6 drivers for a two-race event. Larger grids show an unavailable message for the
unsupported range; a supported single-race range is still calculated separately.
Each finishing position is assigned to one driver per race.

Calculations run in a background worker with a calculating message. Selecting a
different driver or closing the calculator cancels pending work. Completed driver
ranges are reused while the calculator stays open. Finishing orders are generated
one at a time to keep memory use low. These limits apply to the next-race/event
outlook. The season table uses conservative position bounds, allowing zero future
points and calculating remaining Race 2, special events, drops and bonuses.
Future wins and podiums are included in the bounds; unresolved ties prevent a
position from being declared locked. Completed seasons use their established order.
Next-race finish conditions use the same remaining-season bounds. A position may
remain unconfirmed even when a tighter search could prove it locked; bounds do not
claim that every position inside the range is achievable. The previous heuristic
whole-event clinch messages have been removed.

Both the title overview and selected-driver calculation have percentage progress
bars based on completed work. Early exits can advance the percentage in jumps.

Run the automated checks with Node.js 18 or newer: `node --test tests/*.test.js`.
