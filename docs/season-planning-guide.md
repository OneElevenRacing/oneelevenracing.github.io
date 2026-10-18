# Season planning: going live and running a season

This guide covers the new **Polls & Forms**, **Season Planning** and **Racing Setup** pages.
It's written for admins. The commands are optional; everything else happens on the website
or in the Firebase console.

## What changes for drivers

Nothing, until you switch it on. After the website is published, drivers still see
"Coming Soon!" on **Other Polls and Forms** until an admin chooses **Show to drivers**
(Season Planning → Settings). Admins can open everything straight away to set up and try it.

The existing pages (home, championship, availability, weather, admin) work as before.

## Going live: step by step

Do these once, **in this order**. Allow about an hour, at a quiet time (not on a race night).
The order matters: the new database rules must be live *before* the new pages are, because
the rules are what keep ballots private and votes tamper-proof.

### Quick checklist

- [ ] 1. Save the `polling` branch to GitHub
- [ ] 2. Back up the database
- [ ] 3. Publish the new database rules
- [ ] 4. Check the existing site still works
- [ ] 5. Merge `polling` into `main` (publishes the website)
- [ ] 6. Set up Racing Setup
- [ ] 7. Try a test poll
- [ ] 8. Switch it on for drivers

### Before you start

You need:

- Access to the [Firebase console](https://console.firebase.google.com/) for the project
  **one-eleven-app-7f282**, as an owner or editor.
- Access to the [GitHub repository](https://github.com/OneElevenRacing/oneelevenracing.github.io)
  with permission to push and merge.
- Your admin account on the website, and if possible one ordinary (non-admin) driver
  account for testing.

### 1. Save the `polling` branch to GitHub

All the new work is on a branch called `polling` on this computer. GitHub doesn't have it yet.

**With GitHub Desktop:** open the repository, choose **Current branch → polling**, then press
**Publish branch** (or **Push origin** if it says that).

**Or from the terminal**, in the repository folder:

```bash
git push -u origin polling
```

This doesn't change the live website. GitHub Pages only publishes `main`.

### 2. Back up the database

1. Open the [Firebase console](https://console.firebase.google.com/) and choose the project.
2. In the left menu, choose **Build → Realtime Database**, then the **Data** tab.
3. Press the **⋮** menu (top right of the data panel) → **Export JSON**.
4. Save the file somewhere safe and name it with today's date, for example
   `one-eleven-backup-2026-10-18.json`.

### 3. Publish the new database rules

The new rules keep each driver's ballot private and make vote counting tamper-proof.
Editing `database.rules.json` in the repository does **not** change the live rules; you have
to publish them.

> **Use the new version of the file.** It's the one in this folder while the `polling` branch
> is checked out (or on GitHub under the `polling` branch). The copy on `main` is the *old*
> rules until step 5.

**Option A: paste them into the console (simplest)**

1. On this computer, make sure the `polling` branch is checked out (GitHub Desktop:
   **Current branch → polling**).
2. Open `database.rules.json` from the repository folder in a text editor. Select all of it
   (**Cmd+A**) and copy it (**Cmd+C**). It starts with `{` and ends with `}`.
3. In the Firebase console, go to **Realtime Database → Rules**.
4. Optional but sensible: copy what's already in the editor into a text file called
   `old-rules.json`, as a second backup.
5. Click in the editor, select everything (**Cmd+A**) and paste (**Cmd+V**) to replace it.
6. Press **Publish**. If the console reports an error, nothing has changed: check you
   copied the whole file and try again.

**Option B: from the terminal**, in the repository folder with `polling` checked out:

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
The current live website only reads branches the new rules still allow, so it keeps working.

### 4. Check the existing site still works

On the **live** website (it's still the old version at this point):

1. **Signed in as an ordinary driver** (or ask a driver to try): open the home page (race
   info and weather show), the championship standings, the availability poll and the
   weather generator.
2. **Signed in as yourself (admin):** open the Admin page, change something small in the
   race info, save it, and check it shows on the home page. Change it back.

If anything says "permission denied" or stays empty, see
[Undoing the rules change](#undoing-the-rules-change). Usually a one-line rule addition fixes it.

### 5. Merge `polling` into `main` (publishes the website)

**On the GitHub website (recommended):**

1. Open the [repository](https://github.com/OneElevenRacing/oneelevenracing.github.io) and
   choose **Pull requests → New pull request**.
2. Set **base: main** and **compare: polling**. GitHub should say "Able to merge".
3. Press **Create pull request**, give it a title such as "Season planning", and create it.
4. Press **Merge pull request → Confirm merge**.

**Or with GitHub Desktop:** switch to **Current branch → main**, press **Fetch origin**, then
**Branch → Merge into current branch… → polling → Merge**, then **Push origin**.

GitHub Pages publishes within a few minutes. To follow it, open the repository's
**Actions** tab and wait for the "pages build and deployment" run to show a green tick.

Then open the website and do a hard refresh (**Cmd+Shift+R** on a Mac, **Ctrl+F5** on
Windows) so the browser fetches the new files. On a phone, close the tab and open it again.
Check the home page still loads and that Admin now shows **Open Season Planning** and
**Open Racing Setup**. Drivers still see "Coming Soon!" on Other Polls and Forms.

### 6. Set up Racing Setup (Admin → Open Racing Setup)

1. **Import & export → Built-in track list → Review built-in list.** Locations marked in red
   are groups that may be the same place (for example the three Spa years or the Virginia
   layouts). Give layouts of one real-world track the same location name, tick
   **I've checked the locations marked in red** and add them. This decides which layouts
   count as "the same location" for exclusions, duplicates and the calendar, so it's worth
   getting right.
2. **Checks → Check championships** lists saved track names the catalogue doesn't recognise.
   For each, press **Add as alias** on the right layout.
3. **Car classes:** add the classes you might vote on, one at a time with **Add class**, or
   many at once under **Import & export → Import car classes** (paste one name per line,
   press **Preview changes**, then confirm).
4. **Templates & defaults:** set the usual poll length, results setting, how many previous
   seasons' tracks to exclude, and the number of calendar events.

You can come back to any of this later; nothing here is visible to drivers.

### 7. Try a test poll

1. Open **Admin → Open Season Planning → Polls → New poll**. Choose a template.
2. Press **Preview as driver** to see exactly what drivers will see (nothing is saved).
3. Publish it, then open **Polls & Forms** from the home page and vote. You'll see the
   Submit button spin, turn into a tick, and the receipt appear.
4. Open the poll's **Results** tab and check the chart.
5. If you have a second test account, add it as an active driver in Edit Team, sign in as
   that account, check it can vote, and check it **can't** open Season Planning or Racing Setup.
6. Back in Season Planning, open the poll, **close** it and **archive** it.

The automated tests already play a complete dummy season through the real rules (see
[For developers](#for-developers)), so this step is about checking it works for you.

### 8. Switch it on for drivers

**Season Planning → Settings → Drivers' access → Show to drivers.** The badge changes from
*Hidden* to *Visible*, and drivers can open Polls & Forms straight away. You can hide it again
at any time; nothing is deleted.

When you're ready, start your first season from **Season Planning → Season** (see below) and
let drivers know on WhatsApp.

### If something goes wrong

| What you see | What to do |
|---|---|
| "Permission denied" on an existing page after step 3 | See [Undoing the rules change](#undoing-the-rules-change). A missing `.read` rule for that branch usually fixes it. |
| The website still looks old after step 5 | Wait a few minutes, check **Actions** shows a green tick, then hard refresh. |
| GitHub says the branches can't be merged automatically | Stop and ask for help rather than resolving it on the website. |
| A driver says their vote didn't save | It tells them clearly and keeps their answers; they can press Submit again. Nothing shows as submitted unless it was saved. |
| You need to hide everything quickly | **Season Planning → Settings → Hide from drivers.** |

## Running a season

Everything happens on **Season Planning → Season**, a checklist of steps. Each step shows a
status: *To do*, *Waiting* (for votes), **Needs you**, *Done* or *Skipped*. The line at the
top, **What needs doing**, always points at the next thing to do; press **Go** to open it.
Polls created from a step only ask for a closing date and an optional message, then
publish. Choose **Edit questions first** if you want to change the questions.

1. **Start a season.** Name it and untick any steps you don't need this time. Drivers see the
   ticked steps as the progress strip on Polls & Forms. **Edit season** changes this later.
2. **Car-class suggestions:** create the suggestions poll. When it closes, review the written
   suggestions (match, merge, add as a new class or exclude), tick the shortlist and press
   **Start round 1**.
3. **Car-class voting rounds:** when a round closes, check the result. If there's a tie at the
   cutoff, choose a runoff, put all tied classes through, or decide yourself with an
   explanation. Then set up the next round. When one class is left, confirm the winner. (If
   you skipped suggestions, tick the classes for round 1 here instead.)
4. **Track picks:** tick the previous seasons to exclude, adjust if needed, resolve any unknown
   track names and press **Open track picks**. After it closes, contact drivers who lost a
   shared location, record their new choice (only free locations are offered), and settle
   any identical submission times.
5. **Rule changes:** turn suggestions into Yes/No proposals, flag related ones, open the vote
   and confirm each outcome after it closes. Outcomes don't change the rules document or
   scoring; update those yourself.
6. **Calendar:** set the number of events and press **Generate calendar**. Use Keep, Pin,
   ↑ ↓, Replace, Remove, Redraw, Shuffle and dates until you're happy. Every change is a saved
   version you can restore. Then **Finalise**.
7. **Publish the summary.** Drivers see it on Polls & Forms and can print it. Then set up the
   championship in Championship Admin as usual; publishing the summary doesn't do that for
   you. **Finish season** at the top of the page when you're done.

Each step has an **Activity** list of its decisions; **Full activity log** (bottom of the Season
page, or Settings) shows everything.

Any poll can also run on its own, outside a season (a suggestion box, a quick vote): use **Polls → New poll**.

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
- Drivers' pages use short animations: live result bars stretch and re-order as votes arrive,
  the Submit button spins and turns into a tick, and the hub's progress strip fills in.
  Anyone who has switched on "reduce motion" on their phone or computer sees no movement.
  The admin pages don't animate.

## Hiding it again

**Season Planning → Settings → Hide from drivers.** Drivers see "Coming Soon!" again and
can't open the pages. All polls, answers and results stay saved.

## Undoing the rules change

**Prefer a fix over a rollback.** The new rules only stop drivers reading the *whole*
database at once; every branch the site uses is still readable. If a page breaks with
"permission denied", it's reading a branch the rules don't list. Adding a `.read` rule for that
branch fixes it without exposing anything else.

**If you really must go back to the old rules**, know this first: the old rules let every
active driver read the entire database directly, including everyone's private ballots.
Hiding Polls & Forms doesn't prevent that, because it only hides the pages, not the data.
So before restoring them:

1. **Realtime Database → Data**: open `seasonPlanning`, choose **⋮ → Export JSON** and keep the
   file safe. It holds every poll, ballot and decision.
2. Delete the `seasonPlanning` branch (hover over it and press the bin icon). Drivers'
   ballots are now gone from the live database, so the old rules can't expose them.
3. Get the old rules by running the command below in this repository. Paste its output into
   **Realtime Database → Rules** and press **Publish**.

```bash
git show fd59d50:database.rules.json
```

When the new rules are back in place, import the saved file into `seasonPlanning` (**⋮ →
Import JSON** on that branch) to restore everything.

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
| `season-planning-season.js` | Season checklist and Settings |
| `season-planning-tools.js` | Tools inside the suggestions, voting rounds, track picks and rule steps; activity log |
| `season-planning-calendar.js` | Tools inside the calendar and summary steps |
| `racing-setup.html`, `racing-setup.js` | Car classes, tracks, imports, templates and defaults |
| `track-catalogue.js` | Feeds existing track menus and images from the catalogue |
| `catalogue.js`, `season-ballot.js`, `season-polls-core.js`, `season-results.js`, `season-admin-core.js`, `season-calendar.js` | Logic shared by the pages, covered by unit tests |
| `season-ui.js`, `style_season.css` | Shared screens and styles |
| `database.rules.json` | Realtime Database rules (publish separately, see above) |
