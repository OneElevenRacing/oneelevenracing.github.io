# ONE ELEVEN Website/App
One Eleven Racing

## Preview changes before committing

From this project folder, run `python3 tools/preview.py`, then open
[the local preview](http://127.0.0.1:8000/). Leave the command running while reviewing;
press Ctrl+C to stop it. Refresh a page after editing its files.

The preview shows the actual Home, Championship, Admin and Availability pages with sample data.
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

## Polls & Forms and Season Planning

**Going live or running a season? Start with [docs/season-planning-guide.md](docs/season-planning-guide.md).**
It covers publishing the database rules (needed first), setup, a season step by step, and
how to hide the feature again. Drivers see "Coming Soon!" until an admin chooses
**Show to drivers** in Season Planning → Settings.

**Other Polls and Forms** on the home page opens the drivers' hub (`season-polls.html`). It
shows the active season plan's stages, open polls ordered by deadline (with each driver's
Submitted / Not submitted status), upcoming polls, results and an archive. The existing
availability poll is separate and unchanged.

Each poll has a Vote and a Results tab. Drivers search and tick options, then review their
answers before submitting; after that only an admin can change them, and a receipt shows
what was saved and when. Unfinished answers are kept in the browser tab until submitted
or signed out. Results show respondents and total selections separately, a text summary,
a table view and PNG/CSV downloads. When class names are hidden they are hidden in the
chart, summary and downloads too (a presentation choice, not secrecy). Rule votes pass
only when Yes beats No; a tie fails and no votes means no decision.

Admins use **Admin → Open Season Planning** (`season-planning-admin.html`). It has three
pages:

- **Season:** a checklist of steps: car-class suggestions, voting rounds, track picks, rule
  changes, calendar and summary. Untick the ones you don't need when starting the season;
  drivers see the rest as the progress strip. Each step shows its status, and **What needs
  doing** points at the next decision. Polls made by a step only ask for a closing date
  before publishing. The rules each step follows:
  - Each driver counts once per class in suggestions.
  - Half the classes (rounded up) go through each round, and a tie at the cutoff is always
    the admin's decision.
  - Locations used in the chosen previous seasons are excluded from track picks.
  - When drivers pick the same location, the one who submitted last keeps it.
  - A rule passes only when Yes beats No.
  - The calendar draws locations equally likely, never repeats one, saves every change as
    a version, and only finalises once track clashes are settled.
  - The summary can be printed and downloaded (CSV, Markdown, JSON) by admins.
  - Nothing creates or changes a championship.
- **Polls:** every poll, plus **New poll** for standalone polls. Each poll's page has Preview as
  driver, dates and results settings, close/finalise/archive, duplicate/replace, result
  snapshots, recount, individual answers (with corrections) and its history.
- **Settings:** the drivers' access switch and links to Racing Setup, templates and defaults,
  and the activity log.

Every change to a published poll needs a reason, which is kept in the history, and drivers'
original answers are never changed. Questions, options and quotas are frozen once published.

Default poll settings and saved templates live in **Racing Setup → Templates & defaults**.
Defaults only shape new drafts. All dates are stored in UTC and shown in UK time.

## Racing Setup (car classes and tracks)

Admins open **Admin → Open Racing Setup** to manage the shared car-class and track lists.
Tracks are stored as locations (e.g. Brands Hatch) with layouts (e.g. Grand Prix, Indy);
layouts at one location count as the same track for season-planning exclusions and
duplicates. Entries are archived rather than deleted. Renaming keeps the old name as an
alias, so championships saved under the old name still show the right label and image.

Until the track catalogue is set up, every page uses the built-in list in `tracks.js`. To set
it up, go to **Import & export → Built-in track list → Review built-in list**. Check the
locations marked in red, then add them. Running this again only adds missing tracks.
Afterwards the next-race selector, championship editor, homepage image and championship
labels all read the catalogue. **Checks → Check championships** lists saved track names the
catalogue doesn't recognise and lets you add each one as an alias.

Car classes can be added one at a time, pasted one per line, or imported from CSV. Every
import shows a preview of what will be added or changed before anything is saved.
The sample preview includes Racing Setup; its changes stay in the browser tab.

## Next-race calculations

Exact championship-position ranges support up to 10 drivers for one race and
6 drivers for a two-race event. Larger grids show an unavailable message for the
unsupported range; a supported single-race range is still calculated separately.
Finisher positions are unique; absent/DNF drivers can share the position after the
last finisher. Pole, fastest lap and off-podium fastest lap are separate +1 awards.
Each award is assigned once; off-podium awards require a position outside the top three.

Calculations run in a background worker with a calculating message. Selecting a
different driver or closing the calculator cancels pending work. Completed driver
ranges are reused while the calculator stays open. Finishing orders are generated
one at a time to keep memory use low. These limits apply to the next-race/event
outlook. The season table uses conservative position bounds, with last-place points
for the active grid as the future minimum, and accounts for remaining Race 2,
special events, drops and bonuses. Minimum totals can remain unchanged if the new
finishing scores are dropped.
Future wins and podiums are included in the bounds; unresolved ties prevent a
position from being declared locked. Completed seasons use their established order.
Next-race finish conditions use the same remaining-season bounds. A position may
remain unconfirmed even when a tighter search could prove it locked; bounds do not
claim that every position inside the range is achievable. The previous heuristic
whole-event clinch messages have been removed.

Both the title overview and selected-driver calculation have percentage progress
bars based on completed work. Early exits can advance the percentage in jumps.

Selecting a driver also finds the lowest next-race finish that permits a move up.
The example assumes nobody receives bonus points and lists only drivers ahead who
can be passed and drivers behind who could move ahead. The main rank ranges still
account for bonus awards.

Run the automated checks with Node.js 18 or newer: `node --test tests/*.test.js`.


## Scheduling from availability

The saved race day has a thicker outline in the availability results table. Active admins
can select a current/future date heading and confirm setting the race date and 7pm
time together. Other drivers see ordinary headings. Existing availability answers
are preserved. New date saves include the year; older yearless dates are interpreted
as the closest matching date to today, including across New Year.

## Firebase setup

The Firebase project settings live in `firebase-config.js`, which every page loads after
the Firebase SDK scripts. Security rules are kept in `firestore.rules` (Firestore) and
`database.rules.json` (Realtime Database). Editing these files does not change the live
rules; paste them into the Firebase console (or deploy them) after any change. The season
planning guide explains both ways.

### Testing the Realtime Database rules

The rules tests run against a local Firebase emulator and never touch live data. They need
Java 17 or newer. Once, run `npm install`; then run `npm run test:rules`. The website itself
still needs no packages or build step; `package.json` only lists these development tools.

Drivers can read only the database branches the site uses (race info, weather, season data
and driver profiles); admins can read everything. Season-planning ballots live under
`seasonPlanning/v1/polls/<poll>/ballots`. A driver can read only their own ballot. Each ballot is
saved together with its vote counters in one update, and the rules reject one without the
other. Publishing a poll freezes its questions and sets every counter to zero.

Drivers can enter results only for existing races (up to race 30) in the active season.
Track names, special events, the schedule and past seasons are admin-only. Race weather
slots can be generated once by any driver; only admins can overwrite or reset them.
