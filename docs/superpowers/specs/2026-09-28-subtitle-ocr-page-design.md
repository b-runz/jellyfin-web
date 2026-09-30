# Subtitle OCR page — design

Date: 2026-09-28, revised 2026-09-29
Status: implemented on branch feature/subtitle-ocr-page; manual/browser verification pending
Server side: `jellyfin/docs/superpowers/specs/2026-09-29-subtitle-ocr-scoring-pipeline-design.md`
(supersedes `jellyfin/docs/superpowers/specs/2026-09-28-bitmap-subtitle-ocr-design.md`,
which this page's first revision was written against)

## Revision note

The server's OCR core was replaced after this page's first revision: the
nOCR glyph engine and the Gemini free-text corrector are gone, replaced by a
Tesseract-plus-scoring pipeline that produces one line per cue with a
`certain` / `adjudicated` / `uncertain` verdict and a scored candidate list,
no per-glyph questions. This revision reworks the page around that pipeline.
Everything about the entry point, the page-versus-dialog choice, the
per-item scope, and the leave/cancel behaviour carries over unchanged.

## Goal

Give administrators a way to convert a PGS or VobSub subtitle track into an
SRT from the movie details page, without starting playback. The flow is as
automatic as the server allows: the user is prompted only for lines the
pipeline is still uncertain about after its own adjudication step. When
every line is certain or adjudicated, the SRT is saved with no review step
at all.

The result is an external SRT stream on the item, so Chromecast playback
from the Android app picks it up through the existing burn-in pipeline.

Success: an administrator taps one button on a movie, answers a handful of
line-level prompts on a phone screen, and the movie has a usable SRT. The
server's own target is fewer than 1 in 200 lines needing a human decision;
each answer improves the pipeline's next run through its training loop.

## Non-goals

- Changes to the Android app. The page runs inside the web client that the
  server ships, so the Android WebView gets it for free.
- Batch conversion, or a library-wide list of candidate items. The server's
  `GET /SubtitleOcr/Candidates` route is not used by this page.
- A per-word "never ask again" affordance. The server's `Accept` route
  accepts a `NeverAsk` array, but there is no concrete UI need for it yet;
  this page always sends it empty, matching the server's own test client.
  Revisited once a real need shows up.
- Training and health administration. `POST /SubtitleOcr/Train` and
  `GET /SubtitleOcr/Health` are pipeline-administration actions, not part of
  converting one item's subtitles; they stay in the server's own test page.
- Editing arbitrary cues, retiming, or a full transcript review. The review
  shows only lines the pipeline flagged uncertain, plus a collapsed audit
  list of the rest.
- Non-admin access. The server routes are admin-only and the page follows.
- Component tests. The repository has none today; pure logic is unit tested
  and the page is checked by hand against the rig server.

## Decisions taken with the user

| Question | Decision |
|---|---|
| Where | jellyfin-web, not the Android app or an injected script |
| Entry point | Icon button in the main button row of the details page, `document_scanner` icon |
| Flow host | A React page (route `subtitleocr`), not a dialog, so no React is mounted inside legacy views |
| While a job runs | The page owns the job; leaving mid-job asks for confirmation and cancels |
| Review | Exception list only: lines the server marked `uncertain`; auto-accept when none |
| Certainty source | The server's own `Certainty` field per line (`certain`/`adjudicated`/`uncertain`); the page does not recompute it |
| Uncertain-line entry | Candidate buttons with their score, plus a free-text field with hardware keyboard support |
| Names | One free-text, comma-separated field, shown only when there is a review to show; `NeverAsk` always empty (matches the server's own test client) |
| Crop images | Fetched as authenticated binary requests and shown via object URLs, only for uncertain lines |
| Resilience | Job id in the URL; a 404 on the job means it is gone and the page starts over |
| Testing scope | Admin user only, no separate non-admin pass; Pixel 8 viewport (412 × 915); English and Danish tracks both exercised |
| Burn-in settings | Exposed on Dashboard → Playback → Transcoding only (on/off, font size, outline width); no preview, no per-item controls |

## Verified facts the design relies on

- The details page in use is the legacy controller
  `src/apps/legacy/controllers/itemDetails/index.js`. Its buttons live in
  `.mainDetailButtons` in `index.html`; `btnDownload` is the closest existing
  conditional button. `reloadFromItem` is where visibility is decided.
- `itemHelper.canEditSubtitles(user, item)` already excludes non-video
  items, recordings in progress, channels, programs and timers.
- React pages for the user-facing app are async routes: an entry in
  `src/apps/legacy/routes/asyncRoutes/user.ts` (and the modern app's
  equivalent) with `{ path, page }`, a page file under
  `src/apps/legacy/routes/`, rendered inside `components/Page`.
- Feature code lives in `src/apps/legacy/features/<feature>/` with `api`,
  `components`, `constants`, `types`, `utils` folders. API hooks use the SDK
  `Api` from `hooks/useApi` with `@tanstack/react-query`.
- Jellyfin serialises `/SubtitleOcr` JSON in PascalCase, confirmed by the
  server's own test client (`Id`, `State`, `Stage`, `Lines`, `ChosenText`,
  `Certainty`, `Candidates`, `Score`).
- The server's `SubtitleOcrJobInfo` is
  `(Id, ItemId, MediaSourceId, StreamIndex, State, Stage, Done, Total,
  Error, Warning)` with
  `State ∈ {Extracting, Uploading, Recognising, AwaitingReview, Done,
  Failed, Cancelled}`. `Stage` is one of `ocr`, `candidates`, `scoring`,
  `adjudicating` during `Recognising`, empty otherwise. There is no glyph
  queue and no `QuestionsRemaining`.
- `GET /SubtitleOcr/Jobs/{id}/Review` returns `ReviewInfo { Lines,
  Stats, WeightsVersion }`, each `ReviewLine` carrying `Index, Start, End,
  OcrText, ChosenText, Certainty ('certain'|'adjudicated'|'uncertain'),
  Margin, Candidates: [{Text, Score}], Adjudication?: {ModelId, Options,
  Picked}`.
- `GET /SubtitleOcr/Jobs/{id}/Crops/{index}` returns a raw `image/png`, not
  base64 embedded in JSON. The route is admin-gated, so a bare `<img src>`
  would 401 (browsers do not attach custom headers to image tags); the page
  fetches it as an authenticated binary request and displays it through an
  object URL.
- `POST /SubtitleOcr/Jobs/{id}/Accept` takes
  `{Decisions: [{Index, Text}], Names: string[], NeverAsk: string[]}` and
  returns `{SavedCues}`. `Decisions` lists only lines the user changed or
  confirmed among the uncertain ones; every other line keeps its
  server-chosen text.
- A `404` on `GET /SubtitleOcr/Jobs/{id}` means Jellyfin has no record of
  the job id at all (stale link, or an unrestorable restart); a `200` with
  `State: "Failed"` means Jellyfin knows the job but it could not finish
  (sidecar unreachable, or lost mid-poll after a sidecar restart). These are
  handled differently: the first drops the id and starts over, the second
  shows the error with a retry.
- `useItem` loads an item by id with react-query. The dashboard already
  uses MUI 6 components.
- vitest is configured; utilities keep a `.test.ts` beside them.
- `URL.createObjectURL` / `URL.revokeObjectURL` is an established pattern in
  the codebase for authenticated binary downloads
  (`src/apps/dashboard/routes/logs/file.tsx`).
- The bundled `material-design-icons-iconfont` is 6.7.0, which includes the
  `document_scanner` glyph. The plan verifies it renders.
- Jellyfin `MediaStream.Codec` for bitmap subtitles is `PGSSUB` or `DVDSUB`
  (case varies by source). External SRT streams have `IsExternal = true` and
  codec `srt` or `subrip`. This eligibility check is unaffected by the
  server's pipeline change.

## Architecture

### 1. Details page button

Unchanged from the previous revision: a button after `btnDownload`,
`document_scanner` icon, shown when the user is an administrator,
`itemHelper.canEditSubtitles` passes, and `eligibleTracks(item)` is
non-empty (PGS/VobSub stream with no external SRT of the same language in
the same media source).

### 2. Route and page

Unchanged in shape: async route `subtitleocr`, page file
`src/apps/legacy/routes/subtitleOcr.tsx` reading `itemId`, `serverId` and
`jobId` from the query string, non-administrators redirected to home with a
toast. The phase table changes to match the new job states:

| Condition | Rendered |
|---|---|
| Item loading | `Loading` |
| No `jobId`, more than one eligible track | `TrackPicker` |
| No `jobId`, exactly one eligible track | Start immediately, then `JobProgress` |
| No `jobId`, no eligible track | `NothingToConvert` with a Back button |
| Job in `Extracting`, `Uploading`, `Recognising` | `JobProgress` |
| Job in `AwaitingReview`, at least one `uncertain` line | `ReviewTable` |
| Job in `AwaitingReview`, no `uncertain` line | Accept is posted automatically; `JobProgress` shows "Saving" |
| Job `Done` | Toast "Subtitles saved" with `SavedCues`, invalidate item queries, replace the current history entry with the details route so it loads fresh |
| Job `Failed` | `JobFailed` with the message and Retry |

The `jobId` in the URL and the leave-mid-job confirmation are unchanged:
leaving while the job is non-terminal asks for confirmation and cancels the
job on the server.

### 3. Progress

`JobProgress` shows a label derived from `State` and, during `Recognising`,
from `Stage`: "Extracting subtitles", "Uploading to the OCR service",
"Recognising text" (`ocr`), "Generating candidates" (`candidates`),
"Scoring candidates" (`scoring`), "Checking uncertain lines" (`adjudicating`).
A determinate bar uses `Done`/`Total` whenever `Total > 0`. `Job.Warning` is
shown as a dismissible notice (for example a feedback-post failure after a
previous accept); it does not change the phase.

### 4. Review

`GET /SubtitleOcr/Jobs/{id}/Review` returns every line, not just the
uncertain ones. The page partitions them by `Certainty`:

- **`certain`** and **`adjudicated`** lines need no action. They are listed
  collapsed under a "N lines resolved automatically" toggle, each row
  showing `OcrText` next to `ChosenText` with the changed words highlighted
  (reusing the existing word-diff highlighting), and `adjudicated` rows
  carry a small marker plus the `Adjudication.ModelId` on hover, so the
  administrator can audit a run without acting on it. **Crop images are not
  fetched for these rows** — with up to ~1500 lines in a full movie, eagerly
  loading a crop per row would be prohibitively expensive; the diff text
  alone is enough for an audit view, and it stays collapsed by default.
- **`uncertain`** lines are the only ones needing input, expanded above the
  collapsed list. Each shows the line's crop image (fetched on demand, only
  for the uncertain lines actually rendered), the candidate buttons with
  their `Score`, and a free-text field for a manual override. Selecting a
  candidate or typing and submitting records that line's decision. A line
  with a decision shows which text is currently chosen; one still needs a
  choice until the user picks or types something. This view is structurally
  the direct successor of the old glyph picker, just operating on a whole
  line's text instead of one letter.
- Below the uncertain lines, one free-text field collects comma-separated
  names to remember (`Names`); there is no separate field for `NeverAsk`
  (see Non-goals).
- A Finish button is enabled once every uncertain line has a decision. It
  posts `Accept` with `Decisions` for every uncertain line the user acted
  on, `Names` parsed from the free-text field (trimmed, deduplicated, empty
  entries dropped), and `NeverAsk: []`.

When there are zero `uncertain` lines, this whole view is skipped: the page
posts `Accept` with an empty `Decisions` array and an empty `Names` array,
since there was no review, and shows "Saving" until `Done`.

### 5. Leaving the page

Unchanged: a router blocker is active while the job is in a non-terminal
state, confirming before cancelling the job and navigating away. A browser
refresh is not blocked, since the `jobId` in the URL rejoins the job.

### 6. Crop images

A small hook fetches `GET /SubtitleOcr/Jobs/{id}/Crops/{index}` as a binary
response through the same authenticated request helper as every other
`/SubtitleOcr` call, wraps the result in `URL.createObjectURL`, and revokes
it when the line is no longer rendered or the component unmounts. This
replaces the old design's embedded base64 glyph images, which are no longer
how the server serves images.

### 7. Burned-in subtitle settings (dashboard)

The server branch `feature/subtitle-burn-in-engine` burns text subtitles into
the video by default and adds three `EncodingOptions` members:
`BurnInTextSubtitles` (bool, default true), `BurnInSubtitleFontSize1080p`
(int, 8..200, default 48) and `BurnInSubtitleOutlineWidth1080p` (int, 0..20,
default 2). The SRTs this page produces are rendered through that path, so
the administrator needs a place to set the size. This is otherwise unrelated
to the OCR pipeline change above and unaffected by it.

`src/apps/dashboard/routes/playback/transcoding.tsx` gains a "Burned-in
subtitles" block after the subtitle-extraction checkbox: a checkbox and two
numeric fields with `min`/`max` matching the server ranges, bound through the
page's existing state, change handlers and JSON submit. The bundled SDK's
`EncodingOptions` type predates the members, so a local
`ExtendedEncodingOptions` intersection type in
`src/apps/dashboard/features/playback/types/encodingOptions.ts` carries them
until the SDK is regenerated. The fields fall back to the server defaults when
an older server omits the members. Validation beyond `min`/`max` is not
needed: the server clamps out-of-range values to the default and logs a
warning.

## Error handling

- **Start fails** (no admin, server too old, no such stream): the page
  shows the server's message with a Back button. A 404 on the start route
  reads "This server does not support subtitle conversion".
- **Job `Failed`**: `JobFailed` with the job's error and Retry, which starts
  a fresh job for the same track.
- **A 404 on `GET /Jobs/{id}`** (job unknown to Jellyfin): the page drops
  `jobId` from the URL and lets the normal start flow run again, which
  reuses a still-running job on the server if one exists.
- **Polling failure** (network drop, server restart): keep the last known
  state on screen with a small "reconnecting" indicator and back off polling
  up to 10 seconds.
- **A crop image fails to load**: the row shows a placeholder and a retry
  affordance instead of blocking the rest of the review.
- **Accept fails**: error shown with Retry; decisions and the names field
  stay in place so nothing is retyped.
- **`Job.Warning` set while active**: a dismissible notice, not an error
  state.
- **Not an administrator**: toast and redirect to home.

## Testing

Unit tests (vitest, beside the utilities):

- `eligibleTracks`: unaffected by the pipeline change; unchanged from the
  previous revision.
- `wordDiff`: unchanged; now used for the collapsed certain/adjudicated
  audit rows as well as, previously, edit highlighting.
- Review partitioning: given a `ReviewLine[]`, splits into
  certain/adjudicated versus uncertain, and computes whether the review can
  be skipped (no uncertain lines).
- Names parsing: comma-separated input trimmed, deduplicated, empty entries
  dropped.

Manual passes against the rig server, on the Pixel 8 viewport (412 × 915
CSS pixels) and on desktop, always signed in as the administrator (the page
and its button are admin-gated; no separate pass as another user type is
needed):

1. A track that yields uncertain lines: full flow through the review table
   to a saved SRT; the details page button disappears; the collapsed
   certain/adjudicated list shows a plausible line count and no crop images
   were fetched for it.
2. A track where everything is certain or adjudicated: progress straight to
   "Subtitles saved", no review shown.
3. Refresh during `Recognising` rejoins the job; back button mid-job asks
   and cancels; stopping the server mid-poll shows Reconnecting and
   recovers; stopping the sidecar (not Jellyfin) surfaces as the job going
   to `Failed` with a clear message, not a page-level crash.
4. A Danish-language bitmap track: the sidecar's Tesseract `dan` model and
   `da_DK` lexicon are exercised server-side; on the page, crop images and
   candidate text render æ, ø and å correctly, typing them in the free-text
   override works, and the collapsed audit rows for this track's certain
   lines display them correctly too.

## Strings

New keys in `src/strings/en-us.json` only: `ConvertSubtitlesToText`,
`SubtitleOcrTitle`, `SubtitleOcrExtracting`, `SubtitleOcrUploading`,
`SubtitleOcrRecognising`, `SubtitleOcrGeneratingCandidates`,
`SubtitleOcrScoringCandidates`, `SubtitleOcrCheckingUncertain`,
`SubtitleOcrSaving`, `SubtitleOcrReviewTitle`, `SubtitleOcrResolvedCount`,
`SubtitleOcrShowResolved`, `SubtitleOcrAdjudicatedBy`,
`SubtitleOcrTypeCorrection`, `SubtitleOcrNamesLabel`,
`SubtitleOcrNamesPlaceholder`, `SubtitleOcrFinish`, `SubtitleOcrSaved`,
`SubtitleOcrCancelConversion`, `SubtitleOcrLeaveConfirm`,
`SubtitleOcrNotSupported`, `SubtitleOcrNothingToConvert`,
`SubtitleOcrReconnecting`, `SubtitleOcrAdminRequired`,
`SubtitleOcrPickTrack`, `SubtitleOcrConvert`, `SubtitleOcrFailed`,
`SubtitleOcrRetry`, `SubtitleOcrCropLoadFailed`.

Burn-in settings (dashboard): `HeaderBurnedInSubtitles`,
`LabelBurnInTextSubtitles`, `LabelBurnInTextSubtitlesHelp`,
`LabelBurnInSubtitleFontSize`, `LabelBurnInSubtitleFontSizeHelp`,
`LabelBurnInSubtitleOutlineWidth`, `LabelBurnInSubtitleOutlineWidthHelp`.
