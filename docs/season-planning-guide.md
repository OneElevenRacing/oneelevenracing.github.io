# Season planning: going live and running a season

This guide covers the new **Polls & Forms**, **Season Planning** and **Racing Setup** pages.
It's written for admins. The commands are optional; everything else happens on the website
or in the Firebase console.

## What changes for drivers

Nothing, until you switch it on. After the website is published, drivers still see
"Coming Soon!" on **Other Polls and Forms** until an admin chooses **Show to drivers**
(Season Planning → Overview). Admins can open everything straight away to set up and try it.

The existing pages (home, championship, availability, weather, admin) work as before.

## Going live (do these once, in this order)

### 1. Make a backup of the database

In the [Firebase console](https://console.firebase.google.com/), open the project, then
**Realtime Database → Data**. Choose the **⋮** menu → **Export JSON** and keep the file.

### 2. Publish the new database rules

The new rules keep each driver's ballot private and make vote counting tamper-proof.
**They must be live before the new pages are used.** Editing `database.rules.json` in the
repository does not change the live rules; you have to publish them.

**Option A: paste them into the console (simplest)**

1. Open `database.rules.json` from this repository and copy all of it.
2. In the Firebase console, go to **Realtime Database → Rules**.
3. Replace everything in the editor with the copied text and press **Publish**.

**Option B: from the terminal**

```bash
npx firebase login
```

```bash
npx firebase deploy --only database --project one-eleven-app-7f282
```

The Firestore rules (`firestore.rules`) haven't changed and don't need publishing.

**What the new rules change for existing data:** active drivers can still read race info,
weather, season data and driver profiles. They can no longer read the whole database at
once. Admins can still read everything. Signed-out and inactive users get nothing, as before.

### 3. Check the existing site

Signed in as an ordinary driver, open the home page, championship standings, availability
poll and weather generator. Signed in as an admin, check the Admin page saves race info. If
anything says "permission denied", see [Undoing the rules change](#undoing-the-rules-change).

### 4. Publish the website

Merge the `polling` branch into `main` and push it. GitHub Pages publishes it within a few
minutes. Drivers still see "Coming Soon!" at this point.

### 5. Set up Racing Setup (Admin → Open Racing Setup)

1. **Import & export → Built-in track list → Review built-in list.** Locations marked in red
   are groups that may be the same place (for example the three Spa years or the Virginia
   layouts). Give layouts of one real-world track the same location name, tick the
   confirmation and add them. This decides which layouts count as "the same location" for
   exclusions, duplicates and the calendar, so it's worth getting right.
2. **Checks → Check championships** lists saved track names the catalogue doesn't recognise.
   Add each one as an alias of the right layout.
3. **Car classes:** add the classes you might vote on, one at a time or pasted one per line.
4. **Templates & defaults:** set the usual poll length, results setting, how many previous
   seasons' tracks to exclude, and the number of calendar events.

### 6. Try it with a test poll

As an admin, open **Season Planning → Polls → New poll**. Choose a template, use **Preview as
driver** (nothing is saved), publish it, vote on it from Polls & Forms, look at the results,
then close and archive it. If you have a second test account, add it as an active driver in
Edit Team and check it can vote but can't see the admin pages.

The automated tests already play a complete dummy season through the real rules (see
[For developers](#for-developers)), so this step is about checking it works for you.

### 7. Switch it on

**Season Planning → Overview → Drivers' access → Show to drivers.** You can hide it again at
any time; nothing is deleted.

## Running a season

1. **Overview → Start season planning.** Name it and set the stages drivers will see.
2. **Suggestions:** create a poll from the *Car-class suggestions* template. When it closes,
   review the written suggestions (match, merge, add as a new class or exclude), tick the
   shortlist and press **Create round 1 draft**.
3. **Voting rounds:** publish each round. When a round closes, check the result. If there's
   a tie at the cutoff, choose a runoff, put all tied classes through, or decide yourself
   with an explanation. Each next round starts as a draft. When one class is left, confirm
   the winner.
4. **Tracks:** tick the previous seasons to exclude, adjust if needed, resolve any unknown
   track names and press **Create track poll draft**. After it closes, contact drivers who
   lost a shared location, record their new choice (only free locations are offered), and
   settle any identical submission times.
5. **Rules:** turn suggestions into Yes/No proposals, flag related ones, create the vote and
   confirm each outcome after it closes. Outcomes don't change the rules document or scoring;
   update those yourself.
6. **Calendar:** set the number of events and press **Generate calendar**. Use Keep, Pin,
   ↑ ↓, Replace, Remove, Redraw, Shuffle and dates until you're happy. Every change is a saved
   version you can restore. Then **Finalise**.
7. **Summary:** publish the season summary. Drivers see it on Polls & Forms and can print or
   download it. Then set up the championship in Championship Admin as usual; publishing the
   summary doesn't do that for you.

Any poll can also run on its own, outside a season plan (a suggestion box, a quick vote).

### Good to know

- Drivers can't change an answer after submitting; an admin can, from the poll's page
  (**Individual answers → Correct these answers**), with a reason that's kept in the history.
- Changing a published poll's dates or results setting, or closing it, always asks for a
  reason. Questions and options can't change after publishing; use **Replace with a
  corrected poll** instead.
- "Hide class names" only changes what's shown. It isn't secret: someone determined could
  still work the names out.
- If a poll's totals ever look wrong, use **Recount from ballots** on its page.
- Firebase's free plan has daily limits. If a vote can't be saved, the driver is told it
  wasn't saved and can try again; nothing is shown as submitted unless it was.

## Hiding it again

**Season Planning → Overview → Hide from drivers.** Drivers see "Coming Soon!" again and
can't open the pages. All polls, answers and results stay saved.

## Undoing the rules change

Only do this if the existing site stops working and you can't wait for a fix. Hide Polls &
Forms first (above), because the old rules let any active driver read everyone's ballots.
Then publish the previous rules: run the command below in this repository, then paste its
output into **Realtime Database → Rules** and press **Publish**.

```bash
git show fd59d50:database.rules.json
```

## For developers

- Preview with sample data (no Firebase): `python3 tools/preview.py`, then open
  http://127.0.0.1:8000/. Use **Reset sample data** to start again.
- Unit tests: `npm test` (or `node --test tests/*.test.js`).
- Database rules tests, including the full dummy season, in a local emulator: `npm install`
  once, then `npm run test:rules`. Needs Java 17 or newer.

| File | What it does |
|---|---|
| `season-polls.html`, `season-polls.js` | Drivers' hub, ballots, results and season summary |
| `season-planning-admin.html`, `season-planning-admin.js` | Admin overview, polls, builder, poll pages |
| `season-planning-tools.js` | Suggestions, Voting rounds, Tracks, Rules, History tabs |
| `season-planning-calendar.js` | Calendar and Summary tabs |
| `racing-setup.html`, `racing-setup.js` | Car classes, tracks, imports, templates and defaults |
| `track-catalogue.js` | Feeds existing track menus and images from the catalogue |
| `catalogue.js`, `season-ballot.js`, `season-polls-core.js`, `season-results.js`, `season-admin-core.js`, `season-calendar.js` | Logic shared by the pages, covered by unit tests |
| `season-ui.js`, `style_season.css` | Shared screens and styles |
| `database.rules.json` | Realtime Database rules (publish separately, see above) |
