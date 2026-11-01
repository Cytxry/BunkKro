# BunkKro AI: reading uploaded timetables

When a student uploads a timetable on the **Smart Timetable** page, the site sends it to **BunkKro AI**. That is the
timetable reader in the `BunkKro-AI` folder, and it runs on this computer. The periods then appear in the weekly
schedule. If the AI is not running, photos still go through the built-in in-browser scanner, as before.

## Start it

1. In `C:\Users\Charan\Desktop\BunkKro-AI`, double-click **`start_bunkkro_ai.bat`** and keep that window open.
2. Open the site as usual. The upload card shows a green **"✨ BunkKro AI on · PDFs & scans welcome"** pill. When
   the AI is not running it shows **"BunkKro AI off"** instead.

## What a student sees

1. **Upload:** a PDF, photo or screenshot (PNG, JPG, WebP or PDF, up to 25 MB). A progress bar shows the reading.
   A born-digital PDF page takes about 5–10 s; a photo or scanned page takes about 1–2 minutes. A PDF with many
   pages shows "Reading page 3 of 19".
2. **"Which timetable is yours?"** appears when the file holds several timetables (one per class, year or page).
3. **"Which row is yours?"** appears when a page prints several sections or batches per day.
4. **"Your subjects":** each subject appears once, with how many classes it has per week and on which days. The
   student can:
   - tidy the name, for example drop teacher or room text (`MA102` and `MA 102` already count as one subject);
   - **create** it as a new BunkKro subject (its weekly count is filled in, and its class days come from the
     timetable);
   - **link** it to a subject they already track;
   - **remove** classes that are not theirs, such as the other batch's tutorial.
5. **Schedule:** the periods appear with their times and breaks. Only classes with a real doubt are marked
   "Review": no printed time, two classes at the same time, or a cell the reader was unsure about. The **Issues**
   tab says why for each one.
6. **Inspector:** the uploaded page itself, with every period boxed where it was read. Double-click a box to see the
   crop, fix the subject, or split the cell.

## How it fits together

| Piece | Where | What it does |
|---|---|---|
| `ai-bridge.js` | this folder | talks to the AI, shows the choosers and the subjects step, builds the Inspector boxes |
| hooks in `bunkke.js` | `handleTimetableFileUpload`, `processTimetableImage`, `applyAiSubjectPlan` | try the AI first, then fall back to the built-in scanner |
| `index.html` | upload card | the AI status pill, PDFs allowed in the file picker, `ai-bridge.js` loaded |
| `server.py` | `BunkKro-AI` | local reading service: `/scan` → `/status` → `/result`, plus `/export` and `/image` |
| `bunkkro_export.py` | `BunkKro-AI` | converts the reader's output into this app's slots (`day` 1–7, `period`, times, `isBreak`, `isUncertain`, cell box) |

## Privacy

- **Stays on this computer:** the server listens on `127.0.0.1` only. It accepts requests only from pages opened
  locally (file://, localhost, 127.0.0.1); other websites get "403 forbidden".
- **No cloud services:** no file is sent anywhere else.
- **Stored readings:** they are kept in `BunkKro-AI\output\server_jobs`. Delete that folder to clear them.

## Putting the site online for other students

The AI cannot run in a student's browser: it needs Python, OCR models and about 2 GB of memory. To use it from a
hosted site:

1. Run `server.py` on a machine you control.
2. Add the site's address to `BUNKKRO_ORIGINS`.
3. Set `window.BUNKKRO_AI_URL` to the server's HTTPS address before `ai-bridge.js` loads.

A cloud server costs money. Until then, other students get the built-in scanner.

## Limits

- **Day-Order timetables** ("Day 1" to "Day 6"): the app maps classes to calendar weekdays, so the AI refuses these
  with a message instead of guessing.
- **Speed:** scanned PDFs with many pages take about a minute per page; only the first 40 pages are read.
- **Subject names:** still contain extra text on some timetables, which is why the subjects step lets the student
  tidy them once.
