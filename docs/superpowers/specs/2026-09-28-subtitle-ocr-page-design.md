# Subtitle OCR page — design

Date: 2026-09-28
Status: approved in brainstorming, pending implementation plan
Server side: `jellyfin/docs/superpowers/specs/2026-09-28-bitmap-subtitle-ocr-design.md`

## Goal

Give administrators a way to convert a PGS or VobSub subtitle track into an
SRT from the movie details page, without starting playback. The flow is as
automatic as the server allows: the user is prompted only when the server is
uncertain about a glyph, a spelling fix or a detected name. When nothing is
uncertain the SRT is saved with no review step at all.

The result is an external SRT stream on the item, so Chromecast playback from
the Android app picks it up through the existing burn-in pipeline.

Success: an administrator taps one button on a movie, answers a handful of
glyph and uncertainty prompts on a phone screen, and the movie has a usable
SRT. Each answer reduces the prompts needed on the next disc.

## Non-goals

- Changes to the Android app. The page runs inside the web client that the
  server ships, so the Android WebView gets it for free.
- Batch conversion, or a library-wide list of candidate items. The server's
  `GET /SubtitleOcr/Candidates` route is not used by this page.
- Editing arbitrary cues, retiming or full transcript review. The review step
  shows only what the server flagged as uncertain.
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
| Review | Exception list only: uncertain edits and uncertain names; auto-accept when none |
| Uncertainty source | New `certain` flag on edits and names in the server API (server spec amended) |
| Glyph entry | Candidates, free text with hardware keyboard support, italic, skip |
| Resilience | Job id in the URL; glyph answers re-anchor on shape id after failures |

## Verified facts the design relies on

- The details page in use is the legacy controller
  `src/apps/legacy/controllers/itemDetails/index.js`. Its buttons live in
  `.mainDetailButtons` in `index.html`; `btnDownload` is the closest existing
  conditional button. `reloadFromItem` is where visibility is decided and
  `user.Policy.IsAdministrator` is already checked there for the split
  versions button.
- `itemHelper.canEditSubtitles(user, item)` already excludes non-video items,
  recordings in progress, channels, programs and timers.
- React pages for the user-facing app are async routes: an entry in
  `src/apps/legacy/routes/asyncRoutes/user.ts` (and the modern app's
  equivalent) with `{ path, page }`, a page file under
  `src/apps/legacy/routes/`, rendered inside `components/Page`. The Search
  page is the template.
- Feature code lives in `src/apps/legacy/features/<feature>/` with `api`,
  `components`, `constants`, `types`, `utils` folders. API hooks use the SDK
  `Api` from `hooks/useApi` with `@tanstack/react-query`.
- Hand-written API wrappers for routes the generated SDK lacks already exist
  (`src/utils/sdk/authentication-api.ts`).
- `useItem` loads an item by id with react-query. The dashboard already uses
  MUI 6 components.
- vitest is configured; utilities keep a `.test.ts` beside them.
- The bundled `material-design-icons-iconfont` is 6.7.0, which includes the
  `document_scanner` glyph. The plan verifies it renders.
- Jellyfin `MediaStream.Codec` for bitmap subtitles is `PGSSUB` or `DVDSUB`
  (case varies by source). External SRT streams have `IsExternal = true` and
  codec `srt` or `subrip`.

## Architecture

### 1. Details page button

`index.html` gains a button after `btnDownload`:

```html
<button is="emby-button" type="button" class="button-flat btnSubtitleOcr hide detailButton" title="${ConvertSubtitlesToText}">
    <div class="detailButton-content">
        <span class="material-icons detailButton-icon document_scanner" aria-hidden="true"></span>
    </div>
</button>
```

In `reloadFromItem`, the button is shown when all of these hold:

1. `user.Policy.IsAdministrator`
2. `itemHelper.canEditSubtitles(user, item)`
3. `eligibleTracks(item).length > 0`

Otherwise it is hidden. The check runs on every item reload, so the button
disappears once a conversion has saved an SRT.

Click handler: `Dashboard.navigate('subtitleocr?itemId=<id>&serverId=<serverId>')`.
When the page navigates back, the details view reloads its item as it already
does on `viewshow` after other edits.

### 2. Eligibility (`features/subtitleOcr/utils/eligibleTracks.ts`)

```ts
interface EligibleTrack {
    mediaSourceId: string;
    streamIndex: number;
    codec: string;          // normalised lower case
    language?: string;
    isForced: boolean;
    displayTitle: string;
}

function eligibleTracks(item: BaseItemDto): EligibleTrack[]
```

For each `MediaSource`, a subtitle stream is eligible when its codec, lower
cased, is `pgssub`, `dvdsub` or `vobsub`, and no other subtitle stream in the
same media source is external with codec `srt` or `subrip` and the same
language. Language comparison lower cases both sides and treats two missing
languages as equal. Result order follows the media source and stream order.

### 3. Route and page

- `ASYNC_USER_ROUTES` in `src/apps/legacy/routes/asyncRoutes/user.ts` and the
  modern app's async user routes both gain `{ path: 'subtitleocr', page: 'subtitleOcr' }`.
- `src/apps/legacy/routes/subtitleOcr.tsx` reads `itemId`, `serverId` and the
  optional `jobId` from the query string, wraps content in `Page` with id
  `subtitleOcrPage`, title "Convert subtitles", back button enabled, now
  playing bar disabled.
- If the current user is not an administrator, the page toasts
  "Administrator access required" and navigates to home.
- Phase selection:

| Condition | Rendered |
|---|---|
| Item loading | `Loading` |
| No `jobId`, more than one eligible track | `TrackPicker` |
| No `jobId`, exactly one eligible track | Start immediately, then `JobProgress` |
| No `jobId`, no eligible track | `NothingToConvert` with a Back button |
| Job in `Extracting`, `Recognising`, `Correcting` | `JobProgress` |
| Job in `AwaitingGlyph` | `GlyphPrompt` |
| Job in `AwaitingReview`, uncertain items present | `UncertaintyPrompt` |
| Job in `AwaitingReview`, nothing uncertain | Accept is posted; `JobProgress` shows "Saving" |
| Job `Done` | Toast "Subtitles saved" with `SavedCues`, invalidate item queries, replace the current history entry with the details route so it loads fresh (a plain back would restore the cached details view and the button would linger) |
| Job `Failed` | `JobFailed` with the message and Retry |

When a job starts, `jobId` is written into the URL with `replace`, so a
refresh rejoins the same job instead of starting another. Starting without a
`jobId` is still safe: the server returns the existing job for the same
track.

### 4. Feature folder `src/apps/legacy/features/subtitleOcr/`

**`types/`** mirrors the server records from the server plan (Task 9 and
Task 10). Jellyfin serialises them in PascalCase, like every other route the
web client consumes:

```ts
type JobState = 'Extracting' | 'Recognising' | 'AwaitingGlyph' | 'Correcting'
    | 'AwaitingReview' | 'Done' | 'Failed' | 'Cancelled';

interface OcrJob { Id: string; ItemId: string; MediaSourceId: string; StreamIndex: number;
    State: JobState; CuesDone: number; CuesTotal: number; QuestionsRemaining: number;
    Error?: string | null; Warning?: string | null; }

interface GlyphQuestion { ShapeId: string; CueIndex: number; LetterPngBase64: string;
    CuePngBase64: string; Left: number; Top: number; Width: number; Height: number;
    Candidates: string[]; Remaining: number; Occurrences: number; }

interface StartJobRequest { ItemId: string; MediaSourceId: string; StreamIndex: number; }
interface GlyphAnswer { ShapeId: string; Text?: string | null; Italic: boolean; Skip: boolean; }

interface ReviewCue { Index: number; Start: string; End: string; Text: string; }
interface ReviewEdit { Id: number; CueIndex: number; Original: string; Corrected: string;
    Reason: string; Certain: boolean; }
interface DetectedName { Name: string; CueIndex: number; Certain: boolean; }
interface Review { Cues: ReviewCue[]; Edits: ReviewEdit[]; DetectedNames: DetectedName[];
    CorrectorError?: string | null; }

interface AcceptRequest { RejectedEditIds: number[]; Names: string[]; NeverAsk: string[]; }
interface AcceptResult { SavedCues: number; }
```

**`constants/`**: `QUERY_KEY = 'SubtitleOcr'`, `PROGRESS_STATES`,
`POLL_INTERVAL_MS = 1000`, `POLL_BACKOFF_MAX_MS = 10000`.

**`api/`**, one file per hook, all built on the SDK `Api` from `useApi` and
its `axiosInstance` with `basePath`, so authentication headers match every
other call:

| Hook | Route | Notes |
|---|---|---|
| `useStartJob` | `POST /SubtitleOcr/Jobs` | mutation; on success writes `jobId` to the URL |
| `useJob(jobId)` | `GET /SubtitleOcr/Jobs/{id}` | `refetchInterval` 1 s while state is in `PROGRESS_STATES`, off otherwise; on error, `retryDelay` doubles up to 10 s and the last data is kept |
| `useGlyph(jobId)` | `GET /SubtitleOcr/Jobs/{id}/Glyph` | enabled only in `AwaitingGlyph`; 204 maps to `null` |
| `useAnswerGlyph` | `POST /SubtitleOcr/Jobs/{id}/Glyph` | mutation; see re-anchoring below |
| `useReview(jobId)` | `GET /SubtitleOcr/Jobs/{id}/Review` | enabled only in `AwaitingReview` |
| `useAccept` | `POST /SubtitleOcr/Jobs/{id}/Accept` | mutation |
| `useCancelJob` | `DELETE /SubtitleOcr/Jobs/{id}` | mutation |

Query keys are `[QUERY_KEY, 'Job', jobId]`, `[QUERY_KEY, 'Glyph', jobId]`,
`[QUERY_KEY, 'Review', jobId]`. Mutations invalidate the job key; a glyph
answer also invalidates the glyph key.

**`utils/`**, pure and unit tested:

- `eligibleTracks(item)` as in section 2.
- `wordDiff(original, corrected)` returns segments
  `{ text, kind: 'same' | 'removed' | 'added' }` at word granularity, used to
  render struck-through and highlighted words. Also exposes
  `changedWords(original, corrected)` for the never-ask default.
- `splitReview(review)` returns
  `{ uncertainEdits, certainEdits, uncertainNames, certainNames, autoAccept }`
  where `autoAccept` is true when both uncertain lists are empty.
- `buildAcceptRequest(review, answers)` maps the user's answers into an
  `AcceptRequest`: rejected edit ids, accepted names plus all certain names,
  never-ask words.

**`components/`**, MUI based, each taking data and callbacks only:

- `TrackPicker`: list of eligible tracks with display title, codec and
  language, one Convert button per row.
- `JobProgress`: phase label ("Extracting subtitles", "Recognising text",
  "Checking spelling", "Saving"), a linear progress bar from
  `cuesDone / cuesTotal` during recognition, and "N shapes need your help"
  when `questionsRemaining > 0`. Shows a small "Reconnecting" chip when the
  last poll failed. A Cancel button cancels the job and navigates back.
- `GlyphPrompt`: cue image with the letter bounds (`Left`, `Top`, `Width`,
  `Height`) drawn on a canvas overlay,
  the letter enlarged below it, up to five candidate buttons, a text field,
  an italic checkbox, Skip, and a "N remaining" counter. Enter or a candidate
  tap submits. Focus rules: the field is auto-focused on desktop and TV
  layouts; on touch layouts it is not, but a `keydown` listener on the prompt
  forwards printable keys to the field so a hardware keyboard works without a
  tap. Images are shown through `data:image/png;base64,` URLs built from
  `LetterPngBase64` and `CuePngBase64`. `Occurrences` is shown next to the
  remaining counter ("used in 12 cues").
- `UncertaintyPrompt`: one list in server order of `EditCard` and `NameCard`.
  `EditCard` shows the cue text rendered with `wordDiff`, the reason, Accept
  and Reject; Reject reveals "Never ask about this word again", checked by
  default when exactly one word changed. `NameCard` shows the name and the
  cue it first appears in, with "It's a name" and "Not a name". A notice line
  shows `correctorError` when set. Finish is enabled when every card has an
  answer and posts Accept.
- `JobFailed`: message, Retry (starts a new job for the same track) and Back.
- `NothingToConvert`: explanation and Back.

### 5. Leaving the page

A router blocker (`useBlocker`) is active while the job is in a non-terminal
state. It shows a confirmation dialog: "Leaving cancels the conversion".
Confirming calls `useCancelJob`, waits for it, then proceeds. A browser
refresh is not blocked, since the `jobId` in the URL rejoins the job.

### 6. Glyph answer re-anchoring

Every glyph question carries the server's `shapeId`, and the server always
serves the head of its queue. On a failed answer request:

1. Refetch the current glyph.
2. If its `shapeId` equals the one just answered, resend the same answer
   once automatically.
3. If that fails too, show a Retry button that keeps the typed answer.
4. If the `shapeId` differs, or the response is 204, the answer was applied:
   drop the pending answer and continue.

A 409 is handled the same way as step 4 after a refetch, since it means the
job or queue moved on.

### 7. Server spec amendment (jellyfin repository)

The server design gains a certainty flag so the page can prompt only on
uncertainty:

Applied to the server implementation plan
(`docs/superpowers/plans/2026-09-28-bitmap-subtitle-ocr.md`, Tasks 7 to 9
and 11) on 2026-09-29; the server design spec is to follow:

- `CorrectionEdit` and `ReviewEdit` gain `bool Certain`.
- `DetectedNames` becomes `IReadOnlyList<DetectedName>` with
  `DetectedName(string Name, int CueIndex, bool Certain)`.
- The Gemini prompt asks the model to mark each edit and name `certain` when
  it is an unambiguous OCR or spelling fix or a name that appears
  consistently, and `uncertain` otherwise. The structured-output schema
  carries the flag. A missing flag is read as uncertain.
- `GET /SubtitleOcr/Jobs/{id}/Review` returns both flags. The test client
  shows uncertain items with a `(?)` marker.

## Error handling

- **Start fails**: the server's message with Back. A 404 on the start route
  reads "This server does not support subtitle conversion".
- **Job `Failed`**: `JobFailed` with the job's error and Retry. Retry starts a
  fresh job, matching the server rule that failed jobs are discarded.
- **Polling failure**: last known state stays on screen with the Reconnecting
  chip; polling backs off to 10 s. Jobs waiting on the user survive server
  restarts, so this resumes cleanly.
- **Glyph answer failure or 409**: re-anchoring in section 6.
- **Corrector error**: notice line in `UncertaintyPrompt`, or a toast when
  auto-accepting. Acceptance is never blocked.
- **Accept fails**: error with Retry; answers stay in component state.
- **Job `Warning` set** (glyph memory save failure): a dismissible notice,
  not an error state. `Error` is only set on `Failed`.
- **Not an administrator**: toast and redirect to home.

## Testing

Unit tests (vitest, beside the utilities):

- `eligibleTracks`: PGS and VobSub codecs in either case; external SRT with
  the same language excludes; different language does not; two missing
  languages match; internal SRT does not exclude; non-subtitle streams
  ignored; multiple media sources.
- `wordDiff`: single word change, insertion, deletion, punctuation attached
  to words, identical strings; `changedWords` count.
- `splitReview` and `buildAcceptRequest`: all certain gives `autoAccept` and
  all certain names; mixed lists; rejected edit ids; never-ask collection;
  accepted uncertain names added to certain names.

Manual passes against the rig server, on a phone-sized viewport and on
desktop:

1. A disc that needs glyph answers and yields uncertain edits: full flow
   through both prompts to a saved SRT; the details page button disappears.
2. A disc where everything is certain: progress straight to "Subtitles saved".
3. Refresh during the glyph phase rejoins the job; back button mid-job asks
   and cancels; stopping the server mid-poll shows Reconnecting and recovers.

Rig integration (jellyfin repository, separate change): the container build
copies a jellyfin-web production build into the web directory when a path is
given, so the Playwright pass drives this page instead of the standalone test
client.

## Strings

New keys in `src/strings/en-us.json` only: `ConvertSubtitlesToText`,
`SubtitleOcrTitle`, `SubtitleOcrExtracting`, `SubtitleOcrRecognising`,
`SubtitleOcrChecking`, `SubtitleOcrSaving`, `SubtitleOcrShapesNeedHelp`,
`SubtitleOcrRemaining`, `SubtitleOcrSkip`, `SubtitleOcrItalic`,
`SubtitleOcrTypeLetter`, `SubtitleOcrAccept`, `SubtitleOcrReject`,
`SubtitleOcrNeverAsk`, `SubtitleOcrIsName`, `SubtitleOcrNotName`,
`SubtitleOcrFinish`, `SubtitleOcrSaved`, `SubtitleOcrLeaveConfirm`,
`SubtitleOcrNotSupported`, `SubtitleOcrNothingToConvert`,
`SubtitleOcrReconnecting`, `SubtitleOcrAdminRequired`.
