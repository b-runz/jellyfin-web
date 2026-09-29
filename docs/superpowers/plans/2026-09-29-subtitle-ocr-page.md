# Subtitle OCR Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `subtitleocr` React page to jellyfin-web, reached from a new button on the movie details page, that drives the server's scoring-pipeline OCR job and prompts the administrator only for lines the pipeline is still uncertain about after its own adjudication step. Also expose the server's new burned-in subtitle settings (on/off, font size, outline width) on the dashboard's Transcoding page, so the SRTs this page produces render at a size the administrator can control.

**Architecture:** A feature folder `src/apps/legacy/features/subtitleOcr/` holds typed react-query hooks over the `/SubtitleOcr` routes, pure utilities (eligibility, word diff, review splitting, name-list parsing) with vitest tests, and MUI components for each phase. A page file `src/apps/legacy/routes/subtitleOcr.tsx` reads `itemId`, `serverId` and `jobId` from the query string and renders the component matching the job state. Review data comes back as one flat list of scored lines with a `Certainty` of `certain`, `adjudicated` or `uncertain`; only `uncertain` lines need a decision, each shown with its crop image (fetched as an authenticated binary request, not embedded in the JSON) and scored candidate buttons. The legacy details page controller gains one button that navigates to the route. Separately, `src/apps/dashboard/routes/playback/transcoding.tsx` gains a "Burned-in subtitles" block bound to three `EncodingOptions` properties added by the server branch `feature/subtitle-burn-in-engine`, typed through a small local extension of the SDK's `EncodingOptions`.

**Tech Stack:** React 18, react-router-dom 6.30 (`useSearchParams`, `useNavigate`, `useBlocker`), `@tanstack/react-query` 5, `@jellyfin/sdk` `Api` (axios) via `hooks/useApi`, MUI 6 (`@mui/material`), vitest 3 with jsdom, ESLint with `@stylistic` (4-space indent, single quotes, no trailing commas).

**Spec:** `docs/superpowers/specs/2026-09-28-subtitle-ocr-page-design.md`

## Global Constraints

- Repository `C:\Users\bru\spare-source\jellyfin-web`, branch `feature/subtitle-ocr-page`. Run all commands from the repository root.
- Node modules are not installed at the time of writing; run `npm ci` once before Task 1.
- Style: 4-space indentation, single quotes (`'`), JSX single quotes, no trailing commas, spaces inside object braces and array brackets (`[ a, b ]`, `{ a }`), semicolons, final newline. Check with `npx eslint <files>`.
- Type check with `npm run build:check` (`tsc --noEmit`). Tests with `npx vitest run <path>`.
- MUI components are imported per file: `import Button from '@mui/material/Button';`. Icons from `@mui/icons-material/<Name>`.
- Translations: add keys to `src/strings/en-us.json` only, inserted alphabetically among the existing `Subtitle...` keys. Never edit other language files.
- Server payloads are PascalCase (`Id`, `State`, `Stage`, `ChosenText`, `Certainty`). Type names in `types/` mirror the server scoring-pipeline plan's C# records exactly (Task 9/10 of `jellyfin/docs/superpowers/plans/2026-09-29-subtitle-ocr-scoring-pipeline.md`).
- `GET /SubtitleOcr/Jobs/{id}/Crops/{index}` returns raw `image/png`, not JSON. It is admin-gated, so it must be fetched as an authenticated binary request (`responseType: 'blob'`) and shown through `URL.createObjectURL`, never a bare `<img src="...">`, which would carry no `Authorization` header and 401.
- Every server route lives under `${api.basePath}/SubtitleOcr` and needs the `Authorization: api.authorizationHeader` header, as `src/utils/bitrateTest.ts` does.
- The job id URL parameter is `jobId`; item and server parameters are `itemId` and `serverId`.
- Commit after every task with the trailer `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.

## Review Focus

1. **A media source with a PGS track and an external SRT whose `Language` differs only in case (`ENG` vs `eng`).** Expected: the track is not eligible. Test in Task 1.
2. **A cue where the correction only inserts a word, or only deletes one (`"I am here"` to `"I am not here"`).** Expected: `wordDiff` yields an `added` or `removed` segment with no crash and `changedWords` counts one word. Test in Task 2.
3. **A review whose lines are all `certain` or `adjudicated` except one `uncertain` line.** Expected: `splitReview` reports `autoAccept: false` with exactly that one line in `uncertainLines`, and the certain/adjudicated ones do not require any decision. Test in Task 3.
4. **A movie-length review (hundreds of `certain` lines, a handful `uncertain`).** Expected: crop images are fetched only for the `uncertain` lines, never for the collapsed certain/adjudicated list, so opening the review does not trigger hundreds of image requests. Guaranteed by construction in Task 8: `ResolvedLinesList` never renders `LineCropImage`, only `UncertainLineCard` (rendered once per `split.uncertainLines` entry) does, and `useCropImage` is `enabled` only when both `jobId` and `index` are given; verified by the manual pass with a full-length track.
5. **Rejoining via URL a job the server no longer knows (404 on `GET /Jobs/{id}`).** Expected: the page removes `jobId` from the URL and starts again through `POST /Jobs`, which returns the running job if there is one. Test in Task 10 (unit test of `nextStepAfterJobError`).

---

### Task 1: Feature types, constants and the eligibility utility

**Files:**
- Create: `src/apps/legacy/features/subtitleOcr/types/index.ts`
- Create: `src/apps/legacy/features/subtitleOcr/constants/index.ts`
- Create: `src/apps/legacy/features/subtitleOcr/utils/eligibleTracks.ts`
- Test: `src/apps/legacy/features/subtitleOcr/utils/eligibleTracks.test.ts`

**Interfaces:**
- Consumes: `BaseItemDto`, `MediaSourceInfo`, `MediaStream` from `@jellyfin/sdk/lib/generated-client`.
- Produces:
  - all types listed in Step 3 (`JobState`, `OcrJob`, `StartJobRequest`, `ReviewCandidate`, `Adjudication`, `Certainty`, `ReviewLine`, `ReviewStats`, `Review`, `ReviewDecision`, `AcceptRequest`, `AcceptResult`, `EligibleTrack`)
  - constants `QUERY_KEY`, `PROGRESS_STATES`, `POLL_INTERVAL_MS`, `POLL_BACKOFF_MAX_MS`, `ROUTE_PATH`, `ITEM_ID_PARAM`, `SERVER_ID_PARAM`, `JOB_ID_PARAM`
  - `eligibleTracks(item: Pick<BaseItemDto, 'MediaSources'>): EligibleTrack[]`

- [ ] **Step 1: Install dependencies once**

Run: `npm ci`
Expected: completes without error; `node_modules/` exists.

- [ ] **Step 2: Write the failing eligibility tests**

`src/apps/legacy/features/subtitleOcr/utils/eligibleTracks.test.ts`:

```ts
import type { MediaSourceInfo } from '@jellyfin/sdk/lib/generated-client/models/media-source-info';
import type { MediaStream } from '@jellyfin/sdk/lib/generated-client/models/media-stream';
import { describe, expect, it } from 'vitest';

import { eligibleTracks } from './eligibleTracks';

const stream = (overrides: Partial<MediaStream>): MediaStream => ({
    Type: 'Subtitle',
    Index: 0,
    IsExternal: false,
    IsForced: false,
    DisplayTitle: 'Subtitle',
    ...overrides
});

const source = (id: string, streams: MediaStream[]): MediaSourceInfo => ({
    Id: id,
    MediaStreams: streams
});

describe('eligibleTracks', () => {
    it('returns PGS and VobSub subtitle streams regardless of codec case', () => {
        const item = { MediaSources: [ source('s1', [
            stream({ Index: 2, Codec: 'PGSSUB', Language: 'eng', DisplayTitle: 'English PGS' }),
            stream({ Index: 3, Codec: 'dvdsub', Language: 'ger' }),
            stream({ Index: 4, Codec: 'VobSub', Language: 'fre' })
        ]) ] };

        const result = eligibleTracks(item);

        expect(result.map(t => t.streamIndex)).toEqual([ 2, 3, 4 ]);
        expect(result[0]).toEqual({
            mediaSourceId: 's1',
            streamIndex: 2,
            codec: 'pgssub',
            language: 'eng',
            isForced: false,
            displayTitle: 'English PGS'
        });
    });

    it('ignores non-subtitle streams and text subtitle streams', () => {
        const item = { MediaSources: [ source('s1', [
            stream({ Index: 0, Type: 'Video', Codec: 'h264' }),
            stream({ Index: 1, Type: 'Audio', Codec: 'aac' }),
            stream({ Index: 2, Codec: 'srt', Language: 'eng' }),
            stream({ Index: 3, Codec: 'ass', Language: 'eng' })
        ]) ] };

        expect(eligibleTracks(item)).toEqual([]);
    });

    it('excludes a bitmap track when an external SRT of the same language exists, comparing case-insensitively', () => {
        const item = { MediaSources: [ source('s1', [
            stream({ Index: 2, Codec: 'PGSSUB', Language: 'ENG' }),
            stream({ Index: 3, Codec: 'PGSSUB', Language: 'ger' }),
            stream({ Index: 10, Codec: 'subrip', Language: 'eng', IsExternal: true })
        ]) ] };

        expect(eligibleTracks(item).map(t => t.streamIndex)).toEqual([ 3 ]);
    });

    it('does not exclude when the SRT of the same language is internal', () => {
        const item = { MediaSources: [ source('s1', [
            stream({ Index: 2, Codec: 'PGSSUB', Language: 'eng' }),
            stream({ Index: 3, Codec: 'srt', Language: 'eng', IsExternal: false })
        ]) ] };

        expect(eligibleTracks(item).map(t => t.streamIndex)).toEqual([ 2 ]);
    });

    it('treats two missing languages as equal', () => {
        const item = { MediaSources: [ source('s1', [
            stream({ Index: 2, Codec: 'DVDSUB', Language: null }),
            stream({ Index: 3, Codec: 'srt', IsExternal: true })
        ]) ] };

        expect(eligibleTracks(item)).toEqual([]);
    });

    it('evaluates each media source separately and keeps source order', () => {
        const item = { MediaSources: [
            source('s1', [
                stream({ Index: 2, Codec: 'PGSSUB', Language: 'eng' }),
                stream({ Index: 3, Codec: 'srt', Language: 'eng', IsExternal: true })
            ]),
            source('s2', [
                stream({ Index: 2, Codec: 'PGSSUB', Language: 'eng' })
            ])
        ] };

        expect(eligibleTracks(item)).toEqual([ {
            mediaSourceId: 's2',
            streamIndex: 2,
            codec: 'pgssub',
            language: 'eng',
            isForced: false,
            displayTitle: 'Subtitle'
        } ]);
    });

    it('returns an empty list when there are no media sources', () => {
        expect(eligibleTracks({})).toEqual([]);
        expect(eligibleTracks({ MediaSources: null })).toEqual([]);
    });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npx vitest run src/apps/legacy/features/subtitleOcr/utils/eligibleTracks.test.ts`
Expected: FAIL with "Failed to resolve import './eligibleTracks'".

- [ ] **Step 4: Write the types, constants and the utility**

`src/apps/legacy/features/subtitleOcr/types/index.ts`:

```ts
/** Server job states, see the server scoring-pipeline plan Task 10 (`SubtitleOcrJobState`). */
export type JobState =
    | 'Extracting'
    | 'Uploading'
    | 'Recognising'
    | 'AwaitingReview'
    | 'Done'
    | 'Failed'
    | 'Cancelled';

/** Sub-stage of `Recognising`, empty outside it. One of 'ocr', 'candidates', 'scoring', 'adjudicating'. */
export type JobStage = 'ocr' | 'candidates' | 'scoring' | 'adjudicating' | '';

export interface OcrJob {
    Id: string;
    ItemId: string;
    MediaSourceId: string;
    StreamIndex: number;
    State: JobState;
    Stage: JobStage;
    Done: number;
    Total: number;
    Error?: string | null;
    Warning?: string | null;
}

export interface StartJobRequest {
    ItemId: string;
    MediaSourceId: string;
    StreamIndex: number;
}

/** Certainty verdict the server's scoring pipeline assigns to a line. */
export type Certainty = 'certain' | 'adjudicated' | 'uncertain';

export interface ReviewCandidate {
    Text: string;
    Score: number | null;
}

export interface Adjudication {
    ModelId: string;
    Options: string[];
    Picked: number | null;
}

export interface ReviewLine {
    Index: number;
    Start: string;
    End: string;
    OcrText: string;
    ChosenText: string;
    Certainty: Certainty;
    Margin: number;
    Candidates: ReviewCandidate[];
    Adjudication?: Adjudication | null;
}

export interface ReviewStats {
    CuesIn: number;
    CuesDropped: number;
    LinesFlagged: number;
    LmCalls: number;
    VlmCalls: number;
    LmFailed: boolean;
    VlmFailed: boolean;
}

export interface Review {
    Lines: ReviewLine[];
    Stats: ReviewStats;
    WeightsVersion: string;
}

export interface ReviewDecision {
    Index: number;
    Text: string;
}

export interface AcceptRequest {
    Decisions: ReviewDecision[];
    Names: string[];
    NeverAsk: string[];
}

export interface AcceptResult {
    SavedCues: number;
}

/** A bitmap subtitle stream the page can offer for conversion. */
export interface EligibleTrack {
    mediaSourceId: string;
    streamIndex: number;
    /** Lower-cased codec, one of `pgssub`, `dvdsub`, `vobsub`. */
    codec: string;
    language?: string;
    isForced: boolean;
    displayTitle: string;
}
```

`src/apps/legacy/features/subtitleOcr/constants/index.ts`:

```ts
import type { JobState } from '../types';

export const QUERY_KEY = 'SubtitleOcr';

export const ROUTE_PATH = 'subtitleocr';
export const ITEM_ID_PARAM = 'itemId';
export const SERVER_ID_PARAM = 'serverId';
export const JOB_ID_PARAM = 'jobId';

/** States in which the server is working and the page polls. */
export const PROGRESS_STATES: JobState[] = [ 'Extracting', 'Uploading', 'Recognising' ];

export const POLL_INTERVAL_MS = 1000;
export const POLL_BACKOFF_MAX_MS = 10000;

export const BITMAP_CODECS = [ 'pgssub', 'dvdsub', 'vobsub' ];
export const TEXT_SRT_CODECS = [ 'srt', 'subrip' ];
```

`src/apps/legacy/features/subtitleOcr/utils/eligibleTracks.ts`:

```ts
import type { BaseItemDto } from '@jellyfin/sdk/lib/generated-client/models/base-item-dto';
import type { MediaStream } from '@jellyfin/sdk/lib/generated-client/models/media-stream';

import { BITMAP_CODECS, TEXT_SRT_CODECS } from '../constants';
import type { EligibleTrack } from '../types';

const normalizeLanguage = (language?: string | null) => (language || '').toLowerCase();

const isBitmapSubtitle = (stream: MediaStream) =>
    stream.Type === 'Subtitle' && BITMAP_CODECS.includes((stream.Codec || '').toLowerCase());

const isExternalSrt = (stream: MediaStream) =>
    stream.Type === 'Subtitle'
    && stream.IsExternal === true
    && TEXT_SRT_CODECS.includes((stream.Codec || '').toLowerCase());

/**
 * Lists the PGS and VobSub subtitle streams of an item that have no external SRT of the same language
 * in the same media source. The order follows the media sources and their streams.
 */
export const eligibleTracks = (item: Pick<BaseItemDto, 'MediaSources'>): EligibleTrack[] => {
    const tracks: EligibleTrack[] = [];

    for (const source of item.MediaSources || []) {
        const streams = source.MediaStreams || [];
        const srtLanguages = new Set(streams.filter(isExternalSrt).map(s => normalizeLanguage(s.Language)));

        for (const stream of streams) {
            if (!isBitmapSubtitle(stream) || srtLanguages.has(normalizeLanguage(stream.Language))) {
                continue;
            }

            tracks.push({
                mediaSourceId: source.Id || '',
                streamIndex: stream.Index ?? 0,
                codec: (stream.Codec || '').toLowerCase(),
                language: stream.Language || undefined,
                isForced: stream.IsForced === true,
                displayTitle: stream.DisplayTitle || ''
            });
        }
    }

    return tracks;
};
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run src/apps/legacy/features/subtitleOcr/utils/eligibleTracks.test.ts`
Expected: PASS, 7 tests.

- [ ] **Step 6: Lint and type check**

Run: `npx eslint src/apps/legacy/features/subtitleOcr && npm run build:check`
Expected: no output from eslint; tsc exits 0.

- [ ] **Step 7: Commit**

```bash
git add src/apps/legacy/features/subtitleOcr
git commit -m "Add subtitle OCR feature types and track eligibility

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2: Word diff utility

**Files:**
- Create: `src/apps/legacy/features/subtitleOcr/utils/wordDiff.ts`
- Test: `src/apps/legacy/features/subtitleOcr/utils/wordDiff.test.ts`

**Interfaces:**
- Produces:
  - `interface DiffSegment { text: string; kind: 'same' | 'removed' | 'added' }`
  - `wordDiff(original: string, corrected: string): DiffSegment[]` — segments in reading order; adjacent tokens of the same kind are merged into one segment; whitespace is kept inside `same` segments so the text can be rendered by concatenating `text`.
  - `changedWords(original: string, corrected: string): string[]` — the `removed` words with surrounding punctuation stripped, deduplicated, in order.

- [ ] **Step 1: Write the failing tests**

`src/apps/legacy/features/subtitleOcr/utils/wordDiff.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

import { changedWords, wordDiff } from './wordDiff';

describe('wordDiff', () => {
    it('returns one same segment for identical strings', () => {
        expect(wordDiff('I am here.', 'I am here.')).toEqual([
            { text: 'I am here.', kind: 'same' }
        ]);
    });

    it('marks a single changed word as removed then added', () => {
        expect(wordDiff('l am here.', 'I am here.')).toEqual([
            { text: 'l', kind: 'removed' },
            { text: 'I', kind: 'added' },
            { text: ' am here.', kind: 'same' }
        ]);
    });

    it('handles an insertion', () => {
        expect(wordDiff('I am here', 'I am not here')).toEqual([
            { text: 'I am ', kind: 'same' },
            { text: 'not', kind: 'added' },
            { text: ' here', kind: 'same' }
        ]);
    });

    it('handles a deletion', () => {
        expect(wordDiff('I am not here', 'I am here')).toEqual([
            { text: 'I am ', kind: 'same' },
            { text: 'not', kind: 'removed' },
            { text: ' here', kind: 'same' }
        ]);
    });

    it('keeps punctuation attached to the word it belongs to', () => {
        expect(wordDiff('Hello Anakln.', 'Hello Anakin.')).toEqual([
            { text: 'Hello ', kind: 'same' },
            { text: 'Anakln.', kind: 'removed' },
            { text: 'Anakin.', kind: 'added' }
        ]);
    });

    it('merges adjacent changed words into one segment per kind', () => {
        expect(wordDiff('a b c d', 'a x y d')).toEqual([
            { text: 'a ', kind: 'same' },
            { text: 'b c', kind: 'removed' },
            { text: 'x y', kind: 'added' },
            { text: ' d', kind: 'same' }
        ]);
    });

    it('treats line breaks as whitespace and keeps them in same segments', () => {
        expect(wordDiff('one\ntwo', 'one\nthree')).toEqual([
            { text: 'one\n', kind: 'same' },
            { text: 'two', kind: 'removed' },
            { text: 'three', kind: 'added' }
        ]);
    });
});

describe('changedWords', () => {
    it('returns removed words without punctuation, deduplicated', () => {
        expect(changedWords('Hello Anakln. Anakln!', 'Hello Anakin. Anakin!')).toEqual([ 'Anakln' ]);
    });

    it('returns one word for a pure insertion (the added word)', () => {
        expect(changedWords('I am here', 'I am not here')).toEqual([ 'not' ]);
    });

    it('returns an empty list for identical text', () => {
        expect(changedWords('same', 'same')).toEqual([]);
    });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/apps/legacy/features/subtitleOcr/utils/wordDiff.test.ts`
Expected: FAIL with "Failed to resolve import './wordDiff'".

- [ ] **Step 3: Implement the diff**

`src/apps/legacy/features/subtitleOcr/utils/wordDiff.ts`:

```ts
export interface DiffSegment {
    text: string;
    kind: 'same' | 'removed' | 'added';
}

interface Token {
    /** The word itself, without surrounding whitespace. */
    word: string;
    /** Whitespace that preceded the word in the source text. */
    leading: string;
}

const tokenize = (text: string): Token[] => {
    const tokens: Token[] = [];
    const pattern = /(\s*)(\S+)/g;
    let match: RegExpExecArray | null;

    while ((match = pattern.exec(text)) !== null) {
        tokens.push({ leading: match[1], word: match[2] });
    }

    return tokens;
};

/** Longest common subsequence table over the word values. */
const lcsTable = (a: Token[], b: Token[]): number[][] => {
    const table: number[][] = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0));

    for (let i = a.length - 1; i >= 0; i--) {
        for (let j = b.length - 1; j >= 0; j--) {
            table[i][j] = a[i].word === b[j].word ?
                table[i + 1][j + 1] + 1 :
                Math.max(table[i + 1][j], table[i][j + 1]);
        }
    }

    return table;
};

const push = (segments: DiffSegment[], text: string, kind: DiffSegment['kind']) => {
    if (!text) return;

    const last = segments[segments.length - 1];
    if (last && last.kind === kind) {
        last.text += text;
    } else {
        segments.push({ text, kind });
    }
};

/**
 * Word-level diff of two cue texts. Whitespace travels with the following word and is emitted as `same`
 * so that concatenating every segment's text in order reproduces the corrected text (plus removed words).
 */
export const wordDiff = (original: string, corrected: string): DiffSegment[] => {
    const a = tokenize(original);
    const b = tokenize(corrected);
    const table = lcsTable(a, b);
    const segments: DiffSegment[] = [];
    let i = 0;
    let j = 0;

    while (i < a.length || j < b.length) {
        if (i < a.length && j < b.length && a[i].word === b[j].word) {
            push(segments, b[j].leading + b[j].word, 'same');
            i++;
            j++;
        } else if (j < b.length && (i >= a.length || table[i][j + 1] >= table[i + 1][j])) {
            // Emit whitespace before the first changed word as unchanged, then the added word.
            push(segments, b[j].leading, 'same');
            pushChanged(segments, b[j].word, 'added');
            j++;
        } else {
            if (j >= b.length || segments.length === 0 || segments[segments.length - 1].kind === 'same') {
                push(segments, a[i].leading, 'same');
            }
            pushChanged(segments, a[i].word, 'removed');
            i++;
        }
    }

    return segments;
};

/** Changed words of one kind are joined with single spaces inside a single segment. */
const pushChanged = (segments: DiffSegment[], word: string, kind: 'removed' | 'added') => {
    const last = segments[segments.length - 1];
    if (last && last.kind === kind) {
        last.text += ' ' + word;
    } else {
        segments.push({ text: word, kind });
    }
};

const stripPunctuation = (word: string) => word.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '');

/**
 * Words the corrector changed, used for the "never ask again" default. Removed words come first;
 * when nothing was removed (a pure insertion) the added words are returned instead.
 */
export const changedWords = (original: string, corrected: string): string[] => {
    const segments = wordDiff(original, corrected);
    const pick = (kind: 'removed' | 'added') => segments
        .filter(s => s.kind === kind)
        .flatMap(s => s.text.split(' '))
        .map(stripPunctuation)
        .filter(Boolean);

    const removed = pick('removed');
    const words = removed.length ? removed : pick('added');

    return Array.from(new Set(words));
};
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/apps/legacy/features/subtitleOcr/utils/wordDiff.test.ts`
Expected: PASS, 10 tests. If the "merges adjacent changed words" or "line breaks" case fails on whitespace placement, adjust only the `push(segments, leading, 'same')` calls so that the whitespace preceding a changed run is emitted once, before the `removed` segment, and never between `removed` and `added`.

- [ ] **Step 5: Lint**

Run: `npx eslint src/apps/legacy/features/subtitleOcr/utils`
Expected: no output.

- [ ] **Step 6: Commit**

```bash
git add src/apps/legacy/features/subtitleOcr/utils/wordDiff.ts src/apps/legacy/features/subtitleOcr/utils/wordDiff.test.ts
git commit -m "Add word-level diff for subtitle OCR review

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 3: Review splitting, accept request builder and names parsing

**Files:**
- Create: `src/apps/legacy/features/subtitleOcr/utils/review.ts`
- Test: `src/apps/legacy/features/subtitleOcr/utils/review.test.ts`

**Interfaces:**
- Consumes: `Review`, `ReviewLine`, `AcceptRequest` (Task 1).
- Produces:
  - `interface SplitReview { resolvedLines: ReviewLine[]; uncertainLines: ReviewLine[]; autoAccept: boolean }`
  - `splitReview(review: Review): SplitReview`
  - `isReviewComplete(split: SplitReview, decisions: Record<number, string>): boolean`
  - `buildAcceptRequest(split: SplitReview, decisions: Record<number, string>, namesText: string): AcceptRequest`
  - `parseNames(text: string): string[]`

- [ ] **Step 1: Write the failing tests**

`src/apps/legacy/features/subtitleOcr/utils/review.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

import type { Review, ReviewLine } from '../types';
import { buildAcceptRequest, isReviewComplete, parseNames, splitReview } from './review';

const line = (index: number, certainty: ReviewLine['Certainty'], ocrText = 'l am here', chosenText = 'I am here'): ReviewLine => ({
    Index: index,
    Start: '00:00:01.000',
    End: '00:00:02.000',
    OcrText: ocrText,
    ChosenText: chosenText,
    Certainty: certainty,
    Margin: certainty === 'uncertain' ? 0.1 : 5,
    Candidates: [ { Text: ocrText, Score: 0.4 }, { Text: chosenText, Score: 0.9 } ]
});

const review = (lines: ReviewLine[]): Review => ({
    Lines: lines,
    Stats: { CuesIn: lines.length, CuesDropped: 0, LinesFlagged: 0, LmCalls: 0, VlmCalls: 0, LmFailed: false, VlmFailed: false },
    WeightsVersion: 'test'
});

describe('splitReview', () => {
    it('auto-accepts when every line is certain or adjudicated', () => {
        const split = splitReview(review([ line(0, 'certain'), line(1, 'adjudicated') ]));

        expect(split.autoAccept).toBe(true);
        expect(split.resolvedLines).toHaveLength(2);
        expect(split.uncertainLines).toHaveLength(0);
    });

    it('auto-accepts an empty review', () => {
        expect(splitReview(review([])).autoAccept).toBe(true);
    });

    it('does not auto-accept when one line is uncertain', () => {
        const split = splitReview(review([ line(0, 'certain'), line(1, 'uncertain') ]));

        expect(split.autoAccept).toBe(false);
        expect(split.uncertainLines.map(l => l.Index)).toEqual([ 1 ]);
        expect(split.resolvedLines.map(l => l.Index)).toEqual([ 0 ]);
    });
});

describe('isReviewComplete', () => {
    it('requires a decision for every uncertain line only', () => {
        const split = splitReview(review([ line(0, 'certain'), line(1, 'uncertain'), line(2, 'uncertain') ]));

        expect(isReviewComplete(split, {})).toBe(false);
        expect(isReviewComplete(split, { 1: 'I am here' })).toBe(false);
        expect(isReviewComplete(split, { 1: 'I am here', 2: 'l am here' })).toBe(true);
    });

    it('is complete immediately when nothing is uncertain', () => {
        expect(isReviewComplete(splitReview(review([ line(0, 'certain') ])), {})).toBe(true);
    });
});

describe('buildAcceptRequest', () => {
    it('sends no decisions and no names on auto-accept', () => {
        const split = splitReview(review([ line(0, 'certain') ]));

        expect(buildAcceptRequest(split, {}, '')).toEqual({
            Decisions: [],
            Names: [],
            NeverAsk: []
        });
    });

    it('sends one decision per uncertain line and parsed names', () => {
        const split = splitReview(review([ line(0, 'certain'), line(1, 'uncertain'), line(2, 'uncertain') ]));

        const request = buildAcceptRequest(split, { 1: 'I am here', 2: 'l am here' }, 'Anakin,  Padme ,Anakin');

        expect(request).toEqual({
            Decisions: [ { Index: 1, Text: 'I am here' }, { Index: 2, Text: 'l am here' } ],
            Names: [ 'Anakin', 'Padme' ],
            NeverAsk: []
        });
    });

    it('omits a decision for an uncertain line the user never answered', () => {
        const split = splitReview(review([ line(0, 'uncertain') ]));

        expect(buildAcceptRequest(split, {}, '').Decisions).toEqual([]);
    });
});

describe('parseNames', () => {
    it('trims, deduplicates and drops empty entries', () => {
        expect(parseNames(' Anakin, Padme ,, Anakin ,')).toEqual([ 'Anakin', 'Padme' ]);
    });

    it('returns an empty list for blank input', () => {
        expect(parseNames('')).toEqual([]);
        expect(parseNames('   ')).toEqual([]);
    });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/apps/legacy/features/subtitleOcr/utils/review.test.ts`
Expected: FAIL with "Failed to resolve import './review'".

- [ ] **Step 3: Implement**

`src/apps/legacy/features/subtitleOcr/utils/review.ts`:

```ts
import type { AcceptRequest, Review, ReviewLine } from '../types';

export interface SplitReview {
    /** `certain` and `adjudicated` lines: nothing to ask, listed collapsed for audit. */
    resolvedLines: ReviewLine[];
    /** `uncertain` lines: the only ones needing a decision. */
    uncertainLines: ReviewLine[];
    /** True when there is nothing to ask the user about. */
    autoAccept: boolean;
}

export const splitReview = (review: Review): SplitReview => {
    const resolvedLines = review.Lines.filter(l => l.Certainty !== 'uncertain');
    const uncertainLines = review.Lines.filter(l => l.Certainty === 'uncertain');

    return { resolvedLines, uncertainLines, autoAccept: uncertainLines.length === 0 };
};

/** `decisions` is keyed by `ReviewLine.Index`, holding the text the user picked or typed for that line. */
export const isReviewComplete = (split: SplitReview, decisions: Record<number, string>): boolean =>
    split.uncertainLines.every(l => decisions[l.Index] !== undefined);

export const buildAcceptRequest = (
    split: SplitReview,
    decisions: Record<number, string>,
    namesText: string
): AcceptRequest => ({
    Decisions: split.uncertainLines
        .filter(l => decisions[l.Index] !== undefined)
        .map(l => ({ Index: l.Index, Text: decisions[l.Index] })),
    Names: parseNames(namesText),
    NeverAsk: []
});

/** Comma-separated free text into a deduplicated, trimmed list of names, in first-seen order. */
export const parseNames = (text: string): string[] => {
    const seen = new Set<string>();
    const names: string[] = [];

    for (const raw of text.split(',')) {
        const name = raw.trim();
        if (name && !seen.has(name)) {
            seen.add(name);
            names.push(name);
        }
    }

    return names;
};
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/apps/legacy/features/subtitleOcr/utils`
Expected: PASS, all three utility test files (`eligibleTracks`, `wordDiff`, `review`).

- [ ] **Step 5: Lint and commit**

```bash
npx eslint src/apps/legacy/features/subtitleOcr
git add src/apps/legacy/features/subtitleOcr/utils/review.ts src/apps/legacy/features/subtitleOcr/utils/review.test.ts
git commit -m "Add review splitting, accept request builder and names parsing

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 4: API hooks over the `/SubtitleOcr` routes

**Files:**
- Create: `src/apps/legacy/features/subtitleOcr/api/request.ts`
- Create: `src/apps/legacy/features/subtitleOcr/api/useStartJob.ts`
- Create: `src/apps/legacy/features/subtitleOcr/api/useJob.ts`
- Create: `src/apps/legacy/features/subtitleOcr/api/useReview.ts`
- Create: `src/apps/legacy/features/subtitleOcr/api/useAccept.ts`
- Create: `src/apps/legacy/features/subtitleOcr/api/useCancelJob.ts`
- Create: `src/apps/legacy/features/subtitleOcr/api/useCropImage.ts`
- Test: `src/apps/legacy/features/subtitleOcr/api/request.test.ts`

**Interfaces:**
- Consumes: `Api` from `@jellyfin/sdk` (`api.basePath`, `api.authorizationHeader`, `api.axiosInstance`), `useApi` from `hooks/useApi`, `queryClient` from `utils/query/queryClient`, types and constants from Task 1.
- Produces:
  - `ocrRequest<T>(api: Api, method: 'GET' | 'POST' | 'DELETE', path: string, data?: unknown, signal?: AbortSignal, config?: Partial<AxiosRequestConfig>): Promise<AxiosResponse<T>>` — `path` is appended to `/SubtitleOcr`; `config` merges in extra axios options such as `responseType`.
  - `statusOf(error: unknown): number | undefined` — HTTP status of an axios error, else undefined.
  - `jobQueryKey(jobId)`, `reviewQueryKey(jobId)`, `cropQueryKey(jobId, index)`.
  - `useStartJob(): UseMutationResult<OcrJob, unknown, StartJobRequest>`
  - `useJob(jobId?: string): UseQueryResult<OcrJob>` — polls while in `PROGRESS_STATES`.
  - `useReview(jobId: string | undefined, enabled: boolean): UseQueryResult<Review>`
  - `useAccept(jobId?: string): UseMutationResult<AcceptResult, unknown, AcceptRequest>`
  - `useCancelJob(): UseMutationResult<void, unknown, string>` (argument is the job id)
  - `useCropImage(jobId: string | undefined, index: number | undefined): UseQueryResult<Blob>` — fetches `GET /Jobs/{id}/Crops/{index}` as a binary response; the crop route is admin-gated and returns raw PNG, so it must be fetched with the same `Authorization` header as every other call rather than loaded as a bare `<img src>`.

- [ ] **Step 1: Write the failing test for the request helper**

`src/apps/legacy/features/subtitleOcr/api/request.test.ts`:

```ts
import type { Api } from '@jellyfin/sdk';
import { AxiosError } from 'axios';
import { describe, expect, it, vi } from 'vitest';

import { ocrRequest, statusOf } from './request';

describe('ocrRequest', () => {
    it('sends to the SubtitleOcr route with the authorization header and body', async () => {
        const request = vi.fn().mockResolvedValue({ status: 200, data: { Id: 'j1' } });
        const api = {
            basePath: 'https://server',
            authorizationHeader: 'MediaBrowser Token="t"',
            axiosInstance: { request }
        } as unknown as Api;

        const response = await ocrRequest<{ Id: string }>(api, 'POST', '/Jobs', { ItemId: 'i' });

        expect(response.data.Id).toBe('j1');
        expect(request).toHaveBeenCalledWith({
            method: 'POST',
            url: 'https://server/SubtitleOcr/Jobs',
            data: { ItemId: 'i' },
            headers: { Authorization: 'MediaBrowser Token="t"' },
            signal: undefined
        });
    });

    it('merges extra axios config, such as responseType, without dropping the auth header', async () => {
        const request = vi.fn().mockResolvedValue({ status: 200, data: new Blob() });
        const api = {
            basePath: 'https://server',
            authorizationHeader: 'MediaBrowser Token="t"',
            axiosInstance: { request }
        } as unknown as Api;

        await ocrRequest<Blob>(api, 'GET', '/Jobs/j1/Crops/3', undefined, undefined, { responseType: 'blob' });

        expect(request).toHaveBeenCalledWith({
            method: 'GET',
            url: 'https://server/SubtitleOcr/Jobs/j1/Crops/3',
            data: undefined,
            headers: { Authorization: 'MediaBrowser Token="t"' },
            signal: undefined,
            responseType: 'blob'
        });
    });
});

describe('statusOf', () => {
    it('returns the response status of an axios error', () => {
        const error = new AxiosError('conflict', '409', undefined, undefined, {
            status: 409, statusText: 'Conflict', data: {}, headers: {}, config: { headers: {} } as never
        });

        expect(statusOf(error)).toBe(409);
    });

    it('returns undefined for other errors', () => {
        expect(statusOf(new Error('x'))).toBeUndefined();
        expect(statusOf(undefined)).toBeUndefined();
    });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/apps/legacy/features/subtitleOcr/api/request.test.ts`
Expected: FAIL with "Failed to resolve import './request'".

- [ ] **Step 3: Write the request helper**

`src/apps/legacy/features/subtitleOcr/api/request.ts`:

```ts
import type { Api } from '@jellyfin/sdk';
import { type AxiosRequestConfig, type AxiosResponse, isAxiosError } from 'axios';

import { QUERY_KEY } from '../constants';

export type OcrMethod = 'GET' | 'POST' | 'DELETE';

/**
 * Sends a request to a `/SubtitleOcr` route. These routes are not in the generated SDK client,
 * so the SDK's axios instance is used directly with the same authorization header the SDK would send.
 * `config` merges in extra axios options, such as `responseType: 'blob'` for the crop image route.
 */
export const ocrRequest = <T>(
    api: Api,
    method: OcrMethod,
    path: string,
    data?: unknown,
    signal?: AbortSignal,
    config?: Partial<AxiosRequestConfig>
): Promise<AxiosResponse<T>> => api.axiosInstance.request<T>({
    ...config,
    method,
    url: `${api.basePath}/SubtitleOcr${path}`,
    data,
    headers: { Authorization: api.authorizationHeader },
    signal
});

/** The HTTP status carried by an axios error, if any. */
export const statusOf = (error: unknown): number | undefined =>
    isAxiosError(error) ? error.response?.status : undefined;

export const jobQueryKey = (jobId?: string) => [ QUERY_KEY, 'Job', jobId ];
export const reviewQueryKey = (jobId?: string) => [ QUERY_KEY, 'Review', jobId ];
export const cropQueryKey = (jobId?: string, index?: number) => [ QUERY_KEY, 'Crop', jobId, index ];
```

Note: the `headers` spread order matters. `config` is spread first so that a caller cannot accidentally override `method`, `url`, `data`, `headers` or `signal` by passing them in `config`; only genuinely extra options like `responseType` should go there.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/apps/legacy/features/subtitleOcr/api/request.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 5: Write the hooks**

`src/apps/legacy/features/subtitleOcr/api/useStartJob.ts`:

```ts
import { useMutation } from '@tanstack/react-query';

import { useApi } from 'hooks/useApi';
import { queryClient } from 'utils/query/queryClient';

import type { OcrJob, StartJobRequest } from '../types';
import { jobQueryKey, ocrRequest } from './request';

export const useStartJob = () => {
    const { api } = useApi();

    return useMutation({
        mutationFn: async (body: StartJobRequest) => {
            const response = await ocrRequest<OcrJob>(api!, 'POST', '/Jobs', body);
            return response.data;
        },
        onSuccess: job => {
            queryClient.setQueryData(jobQueryKey(job.Id), job);
        }
    });
};
```

`src/apps/legacy/features/subtitleOcr/api/useJob.ts`:

```ts
import { useQuery } from '@tanstack/react-query';

import { useApi } from 'hooks/useApi';

import { POLL_BACKOFF_MAX_MS, POLL_INTERVAL_MS, PROGRESS_STATES } from '../constants';
import type { OcrJob } from '../types';
import { jobQueryKey, ocrRequest } from './request';

/**
 * Loads a job and polls it every second while the server is working. Polling stops in states
 * that wait for the user or are terminal. Failed polls retry with a growing delay capped at 10 s,
 * and the last successful data stays available for rendering.
 */
export const useJob = (jobId?: string) => {
    const { api } = useApi();

    return useQuery({
        queryKey: jobQueryKey(jobId),
        queryFn: async ({ signal }) => {
            const response = await ocrRequest<OcrJob>(api!, 'GET', `/Jobs/${jobId}`, undefined, signal);
            return response.data;
        },
        enabled: !!api && !!jobId,
        refetchInterval: query => {
            const state = query.state.data?.State;
            return state && PROGRESS_STATES.includes(state) ? POLL_INTERVAL_MS : false;
        },
        retry: (failureCount, error) => {
            // A missing job will not come back; let the page handle it.
            const status = (error as { response?: { status?: number } }).response?.status;
            return status !== 404 && failureCount < 3;
        },
        retryDelay: attempt => Math.min(POLL_INTERVAL_MS * 2 ** attempt, POLL_BACKOFF_MAX_MS)
    });
};
```

`src/apps/legacy/features/subtitleOcr/api/useReview.ts`:

```ts
import { useQuery } from '@tanstack/react-query';

import { useApi } from 'hooks/useApi';

import type { Review } from '../types';
import { ocrRequest, reviewQueryKey } from './request';

export const useReview = (jobId: string | undefined, enabled: boolean) => {
    const { api } = useApi();

    return useQuery({
        queryKey: reviewQueryKey(jobId),
        queryFn: async ({ signal }) => {
            const response = await ocrRequest<Review>(api!, 'GET', `/Jobs/${jobId}/Review`, undefined, signal);
            return response.data;
        },
        enabled: !!api && !!jobId && enabled
    });
};
```

`src/apps/legacy/features/subtitleOcr/api/useAccept.ts`:

```ts
import { useMutation } from '@tanstack/react-query';

import { useApi } from 'hooks/useApi';
import { queryClient } from 'utils/query/queryClient';

import type { AcceptRequest, AcceptResult } from '../types';
import { jobQueryKey, ocrRequest } from './request';

export const useAccept = (jobId?: string) => {
    const { api } = useApi();

    return useMutation({
        mutationFn: async (body: AcceptRequest) => {
            const response = await ocrRequest<AcceptResult>(api!, 'POST', `/Jobs/${jobId}/Accept`, body);
            return response.data;
        },
        onSuccess: () => queryClient.invalidateQueries({ queryKey: jobQueryKey(jobId) })
    });
};
```

`src/apps/legacy/features/subtitleOcr/api/useCancelJob.ts`:

```ts
import { useMutation } from '@tanstack/react-query';

import { useApi } from 'hooks/useApi';
import { queryClient } from 'utils/query/queryClient';

import { QUERY_KEY } from '../constants';
import { ocrRequest } from './request';

export const useCancelJob = () => {
    const { api } = useApi();

    return useMutation({
        mutationFn: async (jobId: string) => {
            await ocrRequest<void>(api!, 'DELETE', `/Jobs/${jobId}`);
        },
        onSettled: () => queryClient.invalidateQueries({ queryKey: [ QUERY_KEY ] })
    });
};
```

`src/apps/legacy/features/subtitleOcr/api/useCropImage.ts`:

```ts
import { useQuery } from '@tanstack/react-query';

import { useApi } from 'hooks/useApi';

import { cropQueryKey, ocrRequest } from './request';

/**
 * Fetches one line's crop image as a `Blob`. Only enabled when both `jobId` and `index` are given,
 * so a component only fetches crops for the uncertain lines it actually renders, never eagerly for
 * every line in the review. The result is cached indefinitely: a crop never changes once generated.
 */
export const useCropImage = (jobId: string | undefined, index: number | undefined) => {
    const { api } = useApi();

    return useQuery({
        queryKey: cropQueryKey(jobId, index),
        queryFn: async ({ signal }) => {
            const response = await ocrRequest<Blob>(
                api!, 'GET', `/Jobs/${jobId}/Crops/${index}`, undefined, signal, { responseType: 'blob' }
            );
            return response.data;
        },
        enabled: !!api && !!jobId && index !== undefined,
        staleTime: Infinity,
        gcTime: Infinity
    });
};
```

- [ ] **Step 6: Lint and type check**

Run: `npx eslint src/apps/legacy/features/subtitleOcr && npm run build:check`
Expected: no lint output, tsc exits 0. If tsc complains that `refetchInterval`'s callback parameter is untyped, annotate it as `(query: { state: { data?: OcrJob } })`.

- [ ] **Step 7: Commit**

```bash
git add src/apps/legacy/features/subtitleOcr/api
git commit -m "Add react-query hooks for the subtitle OCR routes

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 5: Route registration, strings, page skeleton with track picker

**Files:**
- Modify: `src/apps/legacy/routes/asyncRoutes/user.ts`
- Modify: `src/apps/modern/routes/asyncRoutes/user.ts`
- Modify: `src/strings/en-us.json`
- Create: `src/apps/legacy/routes/subtitleOcr.tsx`
- Create: `src/apps/legacy/features/subtitleOcr/components/TrackPicker.tsx`
- Create: `src/apps/legacy/features/subtitleOcr/components/NothingToConvert.tsx`
- Create: `src/apps/legacy/features/subtitleOcr/components/PageMessage.tsx`

**Interfaces:**
- Consumes: `eligibleTracks`, constants, `EligibleTrack` (Task 1); `useItem` from `hooks/useItem`; `useApi`; `Page` from `components/Page`; `toast` from `components/toast/toast`; `globalize` from `lib/globalize`.
- Produces:
  - `TrackPicker({ tracks: EligibleTrack[], onSelect: (track: EligibleTrack) => void, disabled?: boolean })`
  - `NothingToConvert({ onBack: () => void })`
  - `PageMessage({ title: string, text?: string | null, children?: ReactNode })` — centred card used by every terminal view.
  - The page's `useSubtitleOcrParams()` helper returning `{ itemId, serverId, jobId, setJobId }` (kept inside the page file).
  - Route `subtitleocr` available under both layouts.

- [ ] **Step 1: Register the route in both apps**

In `src/apps/legacy/routes/asyncRoutes/user.ts`, add one entry keeping alphabetical order:

```ts
export const ASYNC_USER_ROUTES: AsyncRoute[] = [
    { path: 'mypreferencesmenu', page: 'user/settings' },
    { path: 'quickconnect', page: 'quickConnect' },
    { path: 'search', page: 'search' },
    { path: 'subtitleocr', page: 'subtitleOcr' },
    { path: 'userprofile', page: 'user/userprofile' }
];
```

In `src/apps/modern/routes/asyncRoutes/user.ts`, add after the `search` entry (no `type`, so the legacy page file is used):

```ts
    { path: 'search' },
    { path: 'subtitleocr', page: 'subtitleOcr' },
    { path: 'tv', page: 'shows', type: AppType.Modern },
```

- [ ] **Step 2: Add the strings**

In `src/strings/en-us.json`, insert these keys alphabetically among the existing `Subtitle...` keys (the file is not strictly sorted, so place each next to its nearest neighbour; `ConvertSubtitlesToText` goes next to the other `Convert...` keys):

```json
    "ConvertSubtitlesToText": "Convert subtitles to text",
    "SubtitleOcrAdjudicatedBy": "Confirmed by a vision model",
    "SubtitleOcrAdminRequired": "Administrator access is required to convert subtitles.",
    "SubtitleOcrCancelConversion": "Cancel conversion",
    "SubtitleOcrCheckingUncertain": "Checking uncertain lines",
    "SubtitleOcrConvert": "Convert",
    "SubtitleOcrCropLoadFailed": "Could not load this line's image",
    "SubtitleOcrExtracting": "Extracting subtitles",
    "SubtitleOcrFailed": "The conversion failed",
    "SubtitleOcrFinish": "Finish",
    "SubtitleOcrGeneratingCandidates": "Generating candidates",
    "SubtitleOcrLeaveConfirm": "Leaving this page cancels the conversion. Leave anyway?",
    "SubtitleOcrNamesLabel": "Names to remember",
    "SubtitleOcrNamesPlaceholder": "Anakin, Padme",
    "SubtitleOcrNothingToConvert": "This item has no PGS or VobSub subtitle track without a text version.",
    "SubtitleOcrNotSupported": "This server does not support subtitle conversion.",
    "SubtitleOcrPickTrack": "Choose the subtitle track to convert",
    "SubtitleOcrRecognising": "Recognising text",
    "SubtitleOcrReconnecting": "Reconnecting",
    "SubtitleOcrResolvedCount": "{0} lines resolved automatically",
    "SubtitleOcrRetry": "Retry",
    "SubtitleOcrReviewTitle": "Please check these",
    "SubtitleOcrSaved": "Subtitles saved ({0} cues)",
    "SubtitleOcrSaving": "Saving",
    "SubtitleOcrScoringCandidates": "Scoring candidates",
    "SubtitleOcrTitle": "Convert subtitles",
    "SubtitleOcrTypeCorrection": "Type a correction",
    "SubtitleOcrUploading": "Uploading to the OCR service",
```

Run: `node -e "JSON.parse(require('fs').readFileSync('src/strings/en-us.json','utf8')); console.log('valid')"`
Expected: `valid`.

- [ ] **Step 3: Write the shared message card and the two simple views**

`src/apps/legacy/features/subtitleOcr/components/PageMessage.tsx`:

```tsx
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import React, { type FC, type PropsWithChildren } from 'react';

interface PageMessageProps {
    title: string;
    text?: string | null;
}

/** Centred card for terminal and waiting views. Children render as the action row. */
const PageMessage: FC<PropsWithChildren<PageMessageProps>> = ({ title, text, children }) => (
    <Card sx={{ maxWidth: 560, mx: 'auto', my: 2 }}>
        <CardContent>
            <Stack spacing={2}>
                <Typography variant='h2' component='h2'>{title}</Typography>
                {text && <Typography variant='body1'>{text}</Typography>}
                {children && <Stack direction='row' spacing={1} justifyContent='flex-end'>{children}</Stack>}
            </Stack>
        </CardContent>
    </Card>
);

export default PageMessage;
```

`src/apps/legacy/features/subtitleOcr/components/NothingToConvert.tsx`:

```tsx
import Button from '@mui/material/Button';
import React, { type FC } from 'react';

import globalize from 'lib/globalize';

import PageMessage from './PageMessage';

interface NothingToConvertProps {
    onBack: () => void;
}

const NothingToConvert: FC<NothingToConvertProps> = ({ onBack }) => (
    <PageMessage
        title={globalize.translate('SubtitleOcrTitle')}
        text={globalize.translate('SubtitleOcrNothingToConvert')}
    >
        <Button variant='contained' onClick={onBack}>{globalize.translate('ButtonBack')}</Button>
    </PageMessage>
);

export default NothingToConvert;
```

`src/apps/legacy/features/subtitleOcr/components/TrackPicker.tsx`:

```tsx
import Button from '@mui/material/Button';
import List from '@mui/material/List';
import ListItem from '@mui/material/ListItem';
import ListItemText from '@mui/material/ListItemText';
import Typography from '@mui/material/Typography';
import React, { type FC } from 'react';

import globalize from 'lib/globalize';

import type { EligibleTrack } from '../types';

interface TrackPickerProps {
    tracks: EligibleTrack[];
    onSelect: (track: EligibleTrack) => void;
    disabled?: boolean;
}

const TrackPicker: FC<TrackPickerProps> = ({ tracks, onSelect, disabled = false }) => (
    <>
        <Typography variant='h2' component='h2' sx={{ mb: 1 }}>
            {globalize.translate('SubtitleOcrPickTrack')}
        </Typography>
        <List>
            {tracks.map(track => (
                <ListItem
                    key={`${track.mediaSourceId}-${track.streamIndex}`}
                    secondaryAction={
                        <Button
                            variant='contained'
                            disabled={disabled}
                            onClick={() => onSelect(track)}
                        >
                            {globalize.translate('SubtitleOcrConvert')}
                        </Button>
                    }
                >
                    <ListItemText
                        primary={track.displayTitle}
                        secondary={[ track.codec.toUpperCase(), track.language, track.isForced ? globalize.translate('MediaInfoForced') : null ]
                            .filter(Boolean)
                            .join(' · ')}
                    />
                </ListItem>
            ))}
        </List>
    </>
);

export default TrackPicker;
```

- [ ] **Step 4: Write the page skeleton**

`src/apps/legacy/routes/subtitleOcr.tsx`:

```tsx
import CircularProgress from '@mui/material/CircularProgress';
import Container from '@mui/material/Container';
import React, { type FC, useCallback, useEffect, useMemo } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';

import { ITEM_ID_PARAM, JOB_ID_PARAM, SERVER_ID_PARAM } from 'apps/legacy/features/subtitleOcr/constants';
import NothingToConvert from 'apps/legacy/features/subtitleOcr/components/NothingToConvert';
import TrackPicker from 'apps/legacy/features/subtitleOcr/components/TrackPicker';
import type { EligibleTrack } from 'apps/legacy/features/subtitleOcr/types';
import { eligibleTracks } from 'apps/legacy/features/subtitleOcr/utils/eligibleTracks';
import Page from 'components/Page';
import toast from 'components/toast/toast';
import { useApi } from 'hooks/useApi';
import { useItem } from 'hooks/useItem';
import globalize from 'lib/globalize';

/** Reads and writes the page's URL parameters. `setJobId` replaces history so refresh rejoins the job. */
const useSubtitleOcrParams = () => {
    const [ searchParams, setSearchParams ] = useSearchParams();

    const setJobId = useCallback((jobId?: string) => {
        const next = new URLSearchParams(searchParams);
        if (jobId) {
            next.set(JOB_ID_PARAM, jobId);
        } else {
            next.delete(JOB_ID_PARAM);
        }
        setSearchParams(next, { replace: true });
    }, [ searchParams, setSearchParams ]);

    return {
        itemId: searchParams.get(ITEM_ID_PARAM) || undefined,
        serverId: searchParams.get(SERVER_ID_PARAM) || undefined,
        jobId: searchParams.get(JOB_ID_PARAM) || undefined,
        setJobId
    };
};

const SubtitleOcr: FC = () => {
    const navigate = useNavigate();
    const { user } = useApi();
    const { itemId, serverId, jobId } = useSubtitleOcrParams();
    const { data: item, isPending: isItemPending } = useItem(itemId);

    const tracks = useMemo(() => (item ? eligibleTracks(item) : []), [ item ]);

    const isAdmin = user?.Policy?.IsAdministrator === true;

    useEffect(() => {
        if (user && !isAdmin) {
            toast(globalize.translate('SubtitleOcrAdminRequired'));
            navigate('/home', { replace: true });
        }
    }, [ isAdmin, navigate, user ]);

    const goBack = useCallback(() => navigate(-1), [ navigate ]);

    const onSelectTrack = useCallback((track: EligibleTrack) => {
        // Replaced in Task 7 with the start mutation.
        console.debug('[SubtitleOcr] selected track', track, serverId);
    }, [ serverId ]);

    let content;
    if (!user || isItemPending) {
        content = <CircularProgress sx={{ display: 'block', mx: 'auto', my: 4 }} />;
    } else if (!jobId && tracks.length === 0) {
        content = <NothingToConvert onBack={goBack} />;
    } else if (!jobId) {
        content = <TrackPicker tracks={tracks} onSelect={onSelectTrack} />;
    } else {
        content = <CircularProgress sx={{ display: 'block', mx: 'auto', my: 4 }} />;
    }

    return (
        <Page
            id='subtitleOcrPage'
            title={globalize.translate('SubtitleOcrTitle')}
            className='mainAnimatedPage libraryPage noSecondaryNavPage'
            isBackButtonEnabled
            isNowPlayingBarEnabled={false}
        >
            <Container maxWidth='md' sx={{ py: 2 }}>
                {content}
            </Container>
        </Page>
    );
};

export default SubtitleOcr;
```

- [ ] **Step 5: Lint and type check**

Run: `npx eslint src/apps/legacy/routes/subtitleOcr.tsx src/apps/legacy/features/subtitleOcr src/apps/legacy/routes/asyncRoutes src/apps/modern/routes/asyncRoutes && npm run build:check`
Expected: clean.

- [ ] **Step 6: Verify the route renders in the dev server**

Run: `npm start` (webpack dev server on http://localhost:8080). In a browser, connect to the rig server, sign in as the admin, then open `http://localhost:8080/#/subtitleocr?itemId=<id of the Bitmap movie>&serverId=<server id>` (the ids are visible in the details page URL `#/details?id=...&serverId=...`).
Expected: the page titled "Convert subtitles" shows a track picker listing the PGS track with a Convert button. For an item without bitmap tracks the "nothing to convert" card appears with Back. (The page is only reachable through the button, which is itself admin-gated in Task 6, so no separate non-admin pass is needed here.)

- [ ] **Step 7: Commit**

```bash
git add src/apps/legacy/routes/subtitleOcr.tsx src/apps/legacy/routes/asyncRoutes/user.ts src/apps/modern/routes/asyncRoutes/user.ts src/strings/en-us.json src/apps/legacy/features/subtitleOcr/components
git commit -m "Add subtitle OCR page route with track picker

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 6: Details page button

**Files:**
- Modify: `src/apps/legacy/controllers/itemDetails/index.html` (after the `btnDownload` block, lines 31-35)
- Modify: `src/apps/legacy/controllers/itemDetails/index.js` (imports near line 40; `reloadFromItem` after the split-versions block near line 599; `init` near line 2122; a new `onSubtitleOcrClick` next to `onDownloadClick` near line 2039)

**Interfaces:**
- Consumes: `eligibleTracks` (Task 1), constants `ROUTE_PATH`, `ITEM_ID_PARAM`, `SERVER_ID_PARAM` (Task 1), `itemHelper.canEditSubtitles`, `Dashboard.navigate`, `hideAll`, `bindAll`.
- Produces: `.btnSubtitleOcr` button in `.mainDetailButtons`.

- [ ] **Step 1: Add the button markup**

In `index.html`, directly after the `btnDownload` button:

```html
                    <button is="emby-button" type="button" class="button-flat btnSubtitleOcr hide detailButton" title="${ConvertSubtitlesToText}">
                        <div class="detailButton-content">
                            <span class="material-icons detailButton-icon document_scanner" aria-hidden="true"></span>
                        </div>
                    </button>
```

- [ ] **Step 2: Add the visibility rule and click handler**

In `index.js`, add the import after `import Dashboard from 'utils/dashboard';`:

```js
import { ITEM_ID_PARAM, ROUTE_PATH, SERVER_ID_PARAM } from 'apps/legacy/features/subtitleOcr/constants';
import { eligibleTracks } from 'apps/legacy/features/subtitleOcr/utils/eligibleTracks';
```

In `reloadFromItem`, directly after the `btnSplitVersions` if/else block:

```js
    const canConvertSubtitles = user.Policy.IsAdministrator
        && itemHelper.canEditSubtitles(user, item)
        && eligibleTracks(item).length > 0;
    hideAll(page, 'btnSubtitleOcr', canConvertSubtitles);
```

Inside the controller function, next to `onDownloadClick`:

```js
    function onSubtitleOcrClick() {
        const params = new URLSearchParams({
            [ITEM_ID_PARAM]: currentItem.Id,
            [SERVER_ID_PARAM]: currentItem.ServerId
        });
        Dashboard.navigate(`${ROUTE_PATH}?${params.toString()}`);
    }
```

In `init`, after `bindAll(view, '.btnDownload', 'click', onDownloadClick);`:

```js
        bindAll(view, '.btnSubtitleOcr', 'click', onSubtitleOcrClick);
```

- [ ] **Step 3: Lint**

Run: `npx eslint src/apps/legacy/controllers/itemDetails/index.js`
Expected: clean.

- [ ] **Step 4: Verify in the browser**

With `npm start` running and signed in as admin, open the Bitmap movie's details page.
Expected: a `document_scanner` icon button appears after Download with the tooltip "Convert subtitles to text" and tapping it opens the page from Task 5 with the track picker. On a movie with only text subtitles the button is absent. All manual passes in this plan are run signed in as the admin; the code still checks `IsAdministrator` as a safety net, but a separate non-admin pass is not part of this plan. If the icon renders as a box with text, the font lacks that glyph: switch the class to `text_fields` in both this step and the spec.

- [ ] **Step 5: Commit**

```bash
git add src/apps/legacy/controllers/itemDetails/index.html src/apps/legacy/controllers/itemDetails/index.js
git commit -m "Add convert-subtitles button to the item details page

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 7: Starting a job, progress view, polling, cancel and leave guard

**Files:**
- Create: `src/apps/legacy/features/subtitleOcr/components/JobProgress.tsx`
- Create: `src/apps/legacy/features/subtitleOcr/hooks/useLeaveGuard.ts`
- Create: `src/apps/legacy/features/subtitleOcr/utils/phase.ts`
- Test: `src/apps/legacy/features/subtitleOcr/utils/phase.test.ts`
- Modify: `src/apps/legacy/routes/subtitleOcr.tsx`

**Interfaces:**
- Consumes: hooks from Task 4, `TrackPicker`, `PageMessage` (Task 5), `confirm` from `components/confirm/confirm`, `useBlocker` from `react-router-dom`.
- Produces:
  - `type Phase = 'loading' | 'pick' | 'nothing' | 'progress' | 'review' | 'done' | 'failed'`
  - `phaseFor(args: { hasJobId: boolean; job?: OcrJob; trackCount: number; itemLoaded: boolean }): Phase`
  - `isJobActive(state?: JobState): boolean` — true for every non-terminal state.
  - `progressLabelKey(state: JobState, stage: JobStage): string` — the translation key for the phase label; `stage` only matters during `Recognising`.
  - `JobProgress({ job, isReconnecting, onCancel, isCancelling, labelKeyOverride? })`
  - `useLeaveGuard(active: boolean, onLeave: () => Promise<void>)` — blocks in-app navigation while `active`, confirms with the user, runs `onLeave` then proceeds.

- [ ] **Step 1: Write the failing phase tests**

`src/apps/legacy/features/subtitleOcr/utils/phase.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

import type { OcrJob } from '../types';
import { isJobActive, phaseFor, progressLabelKey } from './phase';

const job = (State: OcrJob['State'], Stage: OcrJob['Stage'] = ''): OcrJob => ({
    Id: 'j', ItemId: 'i', MediaSourceId: 'm', StreamIndex: 2, State, Stage, Done: 0, Total: 0
});

describe('phaseFor', () => {
    it('is loading until the item is loaded', () => {
        expect(phaseFor({ hasJobId: false, trackCount: 0, itemLoaded: false })).toBe('loading');
    });

    it('is nothing when there is no job and no eligible track', () => {
        expect(phaseFor({ hasJobId: false, trackCount: 0, itemLoaded: true })).toBe('nothing');
    });

    it('is pick when there is no job and more than one track', () => {
        expect(phaseFor({ hasJobId: false, trackCount: 2, itemLoaded: true })).toBe('pick');
    });

    it('is progress when there is no job and exactly one track (start is automatic)', () => {
        expect(phaseFor({ hasJobId: false, trackCount: 1, itemLoaded: true })).toBe('progress');
    });

    it('is loading when a job id exists but the job has not loaded', () => {
        expect(phaseFor({ hasJobId: true, trackCount: 1, itemLoaded: true })).toBe('loading');
    });

    it('maps job states to phases', () => {
        const at = (state: OcrJob['State']) => phaseFor({ hasJobId: true, job: job(state), trackCount: 1, itemLoaded: true });

        expect(at('Extracting')).toBe('progress');
        expect(at('Uploading')).toBe('progress');
        expect(at('Recognising')).toBe('progress');
        expect(at('AwaitingReview')).toBe('review');
        expect(at('Done')).toBe('done');
        expect(at('Failed')).toBe('failed');
        expect(at('Cancelled')).toBe('failed');
    });
});

describe('isJobActive', () => {
    it('is true for non-terminal states only', () => {
        expect(isJobActive('Extracting')).toBe(true);
        expect(isJobActive('Uploading')).toBe(true);
        expect(isJobActive('AwaitingReview')).toBe(true);
        expect(isJobActive('Done')).toBe(false);
        expect(isJobActive('Failed')).toBe(false);
        expect(isJobActive('Cancelled')).toBe(false);
        expect(isJobActive(undefined)).toBe(false);
    });
});

describe('progressLabelKey', () => {
    it('names each working phase', () => {
        expect(progressLabelKey('Extracting', '')).toBe('SubtitleOcrExtracting');
        expect(progressLabelKey('Uploading', '')).toBe('SubtitleOcrUploading');
        expect(progressLabelKey('AwaitingReview', '')).toBe('SubtitleOcrSaving');
    });

    it('names each Recognising sub-stage', () => {
        expect(progressLabelKey('Recognising', 'ocr')).toBe('SubtitleOcrRecognising');
        expect(progressLabelKey('Recognising', 'candidates')).toBe('SubtitleOcrGeneratingCandidates');
        expect(progressLabelKey('Recognising', 'scoring')).toBe('SubtitleOcrScoringCandidates');
        expect(progressLabelKey('Recognising', 'adjudicating')).toBe('SubtitleOcrCheckingUncertain');
        expect(progressLabelKey('Recognising', '')).toBe('SubtitleOcrRecognising');
    });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/apps/legacy/features/subtitleOcr/utils/phase.test.ts`
Expected: FAIL with "Failed to resolve import './phase'".

- [ ] **Step 3: Implement the phase helpers**

`src/apps/legacy/features/subtitleOcr/utils/phase.ts`:

```ts
import type { JobStage, JobState, OcrJob } from '../types';

export type Phase = 'loading' | 'pick' | 'nothing' | 'progress' | 'review' | 'done' | 'failed';

interface PhaseArgs {
    hasJobId: boolean;
    job?: OcrJob;
    trackCount: number;
    itemLoaded: boolean;
}

const TERMINAL_STATES: JobState[] = [ 'Done', 'Failed', 'Cancelled' ];

export const isJobActive = (state?: JobState): boolean => !!state && !TERMINAL_STATES.includes(state);

export const phaseFor = ({ hasJobId, job, trackCount, itemLoaded }: PhaseArgs): Phase => {
    if (!itemLoaded) return 'loading';

    if (!hasJobId) {
        if (trackCount === 0) return 'nothing';
        return trackCount === 1 ? 'progress' : 'pick';
    }

    if (!job) return 'loading';

    switch (job.State) {
        case 'AwaitingReview':
            return 'review';
        case 'Done':
            return 'done';
        case 'Failed':
        case 'Cancelled':
            return 'failed';
        default:
            return 'progress';
    }
};

export const progressLabelKey = (state: JobState, stage: JobStage): string => {
    switch (state) {
        case 'Extracting':
            return 'SubtitleOcrExtracting';
        case 'Uploading':
            return 'SubtitleOcrUploading';
        case 'Recognising':
            switch (stage) {
                case 'candidates':
                    return 'SubtitleOcrGeneratingCandidates';
                case 'scoring':
                    return 'SubtitleOcrScoringCandidates';
                case 'adjudicating':
                    return 'SubtitleOcrCheckingUncertain';
                default:
                    return 'SubtitleOcrRecognising';
            }
        default:
            return 'SubtitleOcrSaving';
    }
};
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/apps/legacy/features/subtitleOcr/utils/phase.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the progress view and the leave guard**

`src/apps/legacy/features/subtitleOcr/components/JobProgress.tsx`:

```tsx
import Alert from '@mui/material/Alert';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import LinearProgress from '@mui/material/LinearProgress';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import React, { type FC } from 'react';

import globalize from 'lib/globalize';

import type { OcrJob } from '../types';
import { progressLabelKey } from '../utils/phase';
import PageMessage from './PageMessage';

interface JobProgressProps {
    job?: OcrJob;
    /** True while the last poll failed and the page keeps trying. */
    isReconnecting: boolean;
    /** Overrides the label derived from the job state, used for "Saving" during accept. */
    labelKeyOverride?: string;
    onCancel: () => void;
    isCancelling: boolean;
}

const JobProgress: FC<JobProgressProps> = ({ job, isReconnecting, labelKeyOverride, onCancel, isCancelling }) => {
    const labelKey = labelKeyOverride || (job ? progressLabelKey(job.State, job.Stage) : 'SubtitleOcrExtracting');
    const showBar = !!job && job.Total > 0;
    const percent = showBar ? Math.round((job.Done / job.Total) * 100) : 0;

    return (
        <PageMessage title={globalize.translate('SubtitleOcrTitle')}>
            <Stack spacing={2} sx={{ width: '100%' }}>
                <Stack direction='row' spacing={1} alignItems='center'>
                    <Typography variant='body1'>{globalize.translate(labelKey)}</Typography>
                    {isReconnecting && <Chip size='small' color='warning' label={globalize.translate('SubtitleOcrReconnecting')} />}
                </Stack>
                {showBar ? (
                    <LinearProgress variant='determinate' value={percent} />
                ) : (
                    <LinearProgress variant='indeterminate' />
                )}
                {showBar && (
                    <Typography variant='body2'>{job.Done} / {job.Total}</Typography>
                )}
                {job?.Warning && <Alert severity='warning'>{job.Warning}</Alert>}
                <Stack direction='row' justifyContent='flex-end'>
                    <Button color='error' onClick={onCancel} disabled={isCancelling}>
                        {globalize.translate('SubtitleOcrCancelConversion')}
                    </Button>
                </Stack>
            </Stack>
        </PageMessage>
    );
};

export default JobProgress;
```

`src/apps/legacy/features/subtitleOcr/hooks/useLeaveGuard.ts`:

```ts
import { useEffect } from 'react';
import { useBlocker } from 'react-router-dom';

import confirm from 'components/confirm/confirm';
import globalize from 'lib/globalize';

/**
 * Blocks in-app navigation while `active`. When blocked, asks the user; on confirmation runs `onLeave`
 * (which cancels the job) and then lets the navigation proceed. Browser refresh is not blocked because
 * the job id in the URL rejoins the job.
 */
export const useLeaveGuard = (active: boolean, onLeave: () => Promise<void>) => {
    const blocker = useBlocker(({ currentLocation, nextLocation }) =>
        active && currentLocation.pathname !== nextLocation.pathname
    );

    useEffect(() => {
        if (blocker.state !== 'blocked') return;

        confirm({
            title: globalize.translate('SubtitleOcrTitle'),
            text: globalize.translate('SubtitleOcrLeaveConfirm'),
            confirmText: globalize.translate('SubtitleOcrCancelConversion'),
            primary: 'delete'
        }).then(async () => {
            await onLeave();
            blocker.proceed();
        }).catch(() => {
            blocker.reset();
        });
    }, [ blocker, onLeave ]);
};
```

- [ ] **Step 6: Wire start, polling, cancel and the guard into the page**

Replace the body of `src/apps/legacy/routes/subtitleOcr.tsx` with:

```tsx
import CircularProgress from '@mui/material/CircularProgress';
import Container from '@mui/material/Container';
import React, { type FC, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';

import { useCancelJob } from 'apps/legacy/features/subtitleOcr/api/useCancelJob';
import { useJob } from 'apps/legacy/features/subtitleOcr/api/useJob';
import { useStartJob } from 'apps/legacy/features/subtitleOcr/api/useStartJob';
import JobProgress from 'apps/legacy/features/subtitleOcr/components/JobProgress';
import NothingToConvert from 'apps/legacy/features/subtitleOcr/components/NothingToConvert';
import TrackPicker from 'apps/legacy/features/subtitleOcr/components/TrackPicker';
import { ITEM_ID_PARAM, JOB_ID_PARAM, SERVER_ID_PARAM } from 'apps/legacy/features/subtitleOcr/constants';
import { useLeaveGuard } from 'apps/legacy/features/subtitleOcr/hooks/useLeaveGuard';
import type { EligibleTrack } from 'apps/legacy/features/subtitleOcr/types';
import { eligibleTracks } from 'apps/legacy/features/subtitleOcr/utils/eligibleTracks';
import { isJobActive, phaseFor } from 'apps/legacy/features/subtitleOcr/utils/phase';
import Page from 'components/Page';
import toast from 'components/toast/toast';
import { useApi } from 'hooks/useApi';
import { useItem } from 'hooks/useItem';
import globalize from 'lib/globalize';

const useSubtitleOcrParams = () => {
    const [ searchParams, setSearchParams ] = useSearchParams();

    const setJobId = useCallback((jobId?: string) => {
        const next = new URLSearchParams(searchParams);
        if (jobId) {
            next.set(JOB_ID_PARAM, jobId);
        } else {
            next.delete(JOB_ID_PARAM);
        }
        setSearchParams(next, { replace: true });
    }, [ searchParams, setSearchParams ]);

    return {
        itemId: searchParams.get(ITEM_ID_PARAM) || undefined,
        serverId: searchParams.get(SERVER_ID_PARAM) || undefined,
        jobId: searchParams.get(JOB_ID_PARAM) || undefined,
        setJobId
    };
};

const Spinner: FC = () => <CircularProgress sx={{ display: 'block', mx: 'auto', my: 4 }} />;

const SubtitleOcr: FC = () => {
    const navigate = useNavigate();
    const { user } = useApi();
    const { itemId, jobId, setJobId } = useSubtitleOcrParams();
    const { data: item, isPending: isItemPending } = useItem(itemId);
    const tracks = useMemo(() => (item ? eligibleTracks(item) : []), [ item ]);

    const startJob = useStartJob();
    const cancelJob = useCancelJob();
    const { data: job, isError: isJobError } = useJob(jobId);

    const isAdmin = user?.Policy?.IsAdministrator === true;
    useEffect(() => {
        if (user && !isAdmin) {
            toast(globalize.translate('SubtitleOcrAdminRequired'));
            navigate('/home', { replace: true });
        }
    }, [ isAdmin, navigate, user ]);

    const goBack = useCallback(() => navigate(-1), [ navigate ]);

    const start = useCallback((track: EligibleTrack) => {
        if (!itemId || startJob.isPending) return;
        startJob.mutate({
            ItemId: itemId,
            MediaSourceId: track.mediaSourceId,
            StreamIndex: track.streamIndex
        }, {
            onSuccess: started => setJobId(started.Id)
        });
    }, [ itemId, setJobId, startJob ]);

    // Exactly one eligible track: start without asking.
    const autoStarted = useRef(false);
    useEffect(() => {
        if (!jobId && tracks.length === 1 && !autoStarted.current && user && isAdmin) {
            autoStarted.current = true;
            start(tracks[0]);
        }
    }, [ isAdmin, jobId, start, tracks, user ]);

    const cancelCurrentJob = useCallback(async () => {
        if (jobId && isJobActive(job?.State)) {
            await cancelJob.mutateAsync(jobId).catch(() => undefined);
        }
    }, [ cancelJob, job?.State, jobId ]);

    // Set once the user chose to cancel, so the leave guard does not ask again while the
    // cached job state is still active and the page navigates away.
    const [ isLeaving, setIsLeaving ] = useState(false);

    const onCancelClick = useCallback(() => {
        setIsLeaving(true);
        cancelCurrentJob().then(goBack);
    }, [ cancelCurrentJob, goBack ]);

    useLeaveGuard(!!jobId && isJobActive(job?.State) && !isLeaving, cancelCurrentJob);

    const phase = phaseFor({ hasJobId: !!jobId, job, trackCount: tracks.length, itemLoaded: !!user && !isItemPending && !!item });

    let content;
    switch (phase) {
        case 'nothing':
            content = <NothingToConvert onBack={goBack} />;
            break;
        case 'pick':
            content = <TrackPicker tracks={tracks} onSelect={start} disabled={startJob.isPending} />;
            break;
        case 'progress':
            content = (
                <JobProgress
                    job={job}
                    isReconnecting={isJobError}
                    onCancel={onCancelClick}
                    isCancelling={cancelJob.isPending}
                />
            );
            break;
        default:
            // review, done and failed are added in the following tasks.
            content = <Spinner />;
    }

    return (
        <Page
            id='subtitleOcrPage'
            title={globalize.translate('SubtitleOcrTitle')}
            className='mainAnimatedPage libraryPage noSecondaryNavPage'
            isBackButtonEnabled
            isNowPlayingBarEnabled={false}
        >
            <Container maxWidth='md' sx={{ py: 2 }}>
                {content}
            </Container>
        </Page>
    );
};

export default SubtitleOcr;
```

- [ ] **Step 7: Lint and type check**

Run: `npx eslint src/apps/legacy/routes/subtitleOcr.tsx src/apps/legacy/features/subtitleOcr && npm run build:check`
Expected: clean. If tsc rejects `useBlocker`'s callback parameter types, import `type BlockerFunction` from `react-router-dom` and annotate the callback with it.

- [ ] **Step 8: Verify in the browser**

With the rig server running and `npm start`, open the Bitmap movie and tap the convert button.
Expected: with one PGS track, the progress card appears immediately with "Extracting subtitles", then "Recognising text" with a determinate bar and cue counts; the URL now carries `jobId`. Refreshing the browser shows the same job again. Pressing the browser back button opens the "Leaving this page cancels the conversion" dialog; Cancel keeps you on the page, confirming returns to the details page and `GET /SubtitleOcr/Jobs` on the server no longer lists the job as active. Stopping the server briefly shows the "Reconnecting" chip and the page recovers when it is back.

- [ ] **Step 9: Commit**

```bash
git add src/apps/legacy/routes/subtitleOcr.tsx src/apps/legacy/features/subtitleOcr
git commit -m "Start, poll and cancel subtitle OCR jobs from the page

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 8: Review table components — crop images, scored candidates, resolved-lines audit

**Files:**
- Create: `src/apps/legacy/features/subtitleOcr/components/DiffText.tsx`
- Create: `src/apps/legacy/features/subtitleOcr/components/LineCropImage.tsx`
- Create: `src/apps/legacy/features/subtitleOcr/components/UncertainLineCard.tsx`
- Create: `src/apps/legacy/features/subtitleOcr/components/ResolvedLinesList.tsx`
- Create: `src/apps/legacy/features/subtitleOcr/components/ReviewTable.tsx`

**Interfaces:**
- Consumes: `useCropImage` (Task 4), `Review`, `ReviewLine` (Task 1), `isReviewComplete`, `splitReview` (Task 3), `wordDiff` (Task 2), `layoutManager` from `components/layoutManager`.
- Produces:
  - `DiffText({ original, corrected })` — renders `wordDiff` segments: removed struck through, added highlighted.
  - `LineCropImage({ jobId, index })` — the line's crop image, fetched on demand as an authenticated binary request and shown through an object URL.
  - `UncertainLineCard({ jobId, line, decision?: string, onDecide: (text: string) => void })` — crop image, scored candidate buttons and a free-text override for one uncertain line.
  - `ResolvedLinesList({ lines })` — collapsed audit list of certain/adjudicated lines, no crop images fetched.
  - `ReviewTable({ jobId, review, decisions, onDecide, namesText, onNamesTextChange, onFinish, isFinishing, error? })` — composes the above into the whole review screen.

This task builds presentational components only; Task 9 wires `ReviewTable` and its state into the page. There is no new pure logic here beyond what Tasks 2 and 3 already test, so no new unit tests; the components are checked by the manual pass in Task 9.

- [ ] **Step 1: Write `DiffText`**

`src/apps/legacy/features/subtitleOcr/components/DiffText.tsx`:

```tsx
import Box from '@mui/material/Box';
import React, { type FC, useMemo } from 'react';

import { wordDiff } from '../utils/wordDiff';

interface DiffTextProps {
    original: string;
    corrected: string;
}

const DiffText: FC<DiffTextProps> = ({ original, corrected }) => {
    const segments = useMemo(() => wordDiff(original, corrected), [ original, corrected ]);

    return (
        <Box component='span' sx={{ whiteSpace: 'pre-wrap' }}>
            {segments.map((segment, index) => {
                const key = `${index}-${segment.kind}`;
                if (segment.kind === 'removed') {
                    return (
                        <Box key={key} component='del' sx={{ color: 'error.main', textDecorationColor: 'inherit' }}>
                            {segment.text}
                        </Box>
                    );
                }
                if (segment.kind === 'added') {
                    return (
                        <Box key={key} component='ins' sx={{ bgcolor: 'success.dark', color: 'success.contrastText', textDecoration: 'none', px: 0.25, borderRadius: 0.5, ml: 0.5 }}>
                            {segment.text}
                        </Box>
                    );
                }
                return <React.Fragment key={key}>{segment.text}</React.Fragment>;
            })}
        </Box>
    );
};

export default DiffText;
```

- [ ] **Step 2: Write `LineCropImage`**

`src/apps/legacy/features/subtitleOcr/components/LineCropImage.tsx`:

```tsx
import Box from '@mui/material/Box';
import Skeleton from '@mui/material/Skeleton';
import React, { type FC, useEffect, useState } from 'react';

import globalize from 'lib/globalize';

import { useCropImage } from '../api/useCropImage';

interface LineCropImageProps {
    jobId: string;
    index: number;
}

/**
 * Shows one line's crop image. `GET /Jobs/{id}/Crops/{index}` is admin-gated and returns raw PNG, so
 * it is fetched as an authenticated binary request (`useCropImage`) and shown through an object URL,
 * not a bare `<img src>`, which would carry no `Authorization` header and 401. The object URL is
 * revoked whenever the underlying blob changes or the component unmounts.
 */
const LineCropImage: FC<LineCropImageProps> = ({ jobId, index }) => {
    const { data: blob, isError, isPending } = useCropImage(jobId, index);
    const [ url, setUrl ] = useState<string>();

    useEffect(() => {
        if (!blob) {
            setUrl(undefined);
            return;
        }

        const objectUrl = URL.createObjectURL(blob);
        setUrl(objectUrl);
        return () => URL.revokeObjectURL(objectUrl);
    }, [ blob ]);

    if (isPending) {
        return <Skeleton variant='rounded' height={64} />;
    }

    if (isError || !url) {
        return (
            <Box sx={{ bgcolor: 'action.disabledBackground', borderRadius: 1, p: 1 }}>
                {globalize.translate('SubtitleOcrCropLoadFailed')}
            </Box>
        );
    }

    return (
        <Box sx={{ bgcolor: '#000', borderRadius: 1, p: 1 }}>
            <img alt='' src={url} style={{ maxWidth: '100%', height: 'auto', display: 'block' }} />
        </Box>
    );
};

export default LineCropImage;
```

- [ ] **Step 3: Write `UncertainLineCard`**

`src/apps/legacy/features/subtitleOcr/components/UncertainLineCard.tsx`:

```tsx
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import React, { type FC, type FormEvent, useCallback, useEffect, useRef, useState } from 'react';

import layoutManager from 'components/layoutManager';
import globalize from 'lib/globalize';

import type { ReviewLine } from '../types';
import LineCropImage from './LineCropImage';

interface UncertainLineCardProps {
    jobId: string;
    line: ReviewLine;
    /** The text the user has picked or typed for this line so far, if any. */
    decision?: string;
    onDecide: (text: string) => void;
}

/**
 * One uncertain line: crop image, scored candidate buttons and a free-text override. Structurally
 * the direct successor of the old per-glyph picker, operating on a whole line's text instead of one
 * letter shape.
 */
const UncertainLineCard: FC<UncertainLineCardProps> = ({ jobId, line, decision, onDecide }) => {
    const [ text, setText ] = useState(decision ?? '');
    const inputRef = useRef<HTMLInputElement>(null);
    const useHardwareKeyboardFocus = !layoutManager.mobile;

    useEffect(() => {
        if (useHardwareKeyboardFocus) {
            inputRef.current?.focus();
        }
    }, [ useHardwareKeyboardFocus ]);

    // On touch layouts a hardware keyboard should still work without tapping the field first.
    useEffect(() => {
        if (useHardwareKeyboardFocus) return;

        const onKeyDown = (event: KeyboardEvent) => {
            if (document.activeElement === inputRef.current) return;
            if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
                inputRef.current?.focus();
            }
        };

        document.addEventListener('keydown', onKeyDown);
        return () => document.removeEventListener('keydown', onKeyDown);
    }, [ useHardwareKeyboardFocus ]);

    const submit = useCallback((value: string) => {
        if (!value) return;
        onDecide(value);
    }, [ onDecide ]);

    const onSubmit = useCallback((event: FormEvent) => {
        event.preventDefault();
        submit(text);
    }, [ submit, text ]);

    return (
        <Card variant='outlined'>
            <CardContent>
                <Stack spacing={1.5}>
                    <LineCropImage jobId={jobId} index={line.Index} />

                    {line.Candidates.length > 0 && (
                        <Stack direction='row' spacing={1} flexWrap='wrap' useFlexGap>
                            {line.Candidates.map(candidate => (
                                <Button
                                    key={candidate.Text}
                                    variant={decision === candidate.Text ? 'contained' : 'outlined'}
                                    onClick={() => { setText(candidate.Text); submit(candidate.Text); }}
                                >
                                    {candidate.Text}
                                    {candidate.Score !== null && (
                                        <Typography component='span' variant='caption' sx={{ ml: 0.75, opacity: 0.7 }}>
                                            {candidate.Score.toFixed(2)}
                                        </Typography>
                                    )}
                                </Button>
                            ))}
                        </Stack>
                    )}

                    <form onSubmit={onSubmit}>
                        <Stack direction='row' spacing={1}>
                            <TextField
                                inputRef={inputRef}
                                label={globalize.translate('SubtitleOcrTypeCorrection')}
                                value={text}
                                onChange={e => setText(e.target.value)}
                                size='small'
                                autoComplete='off'
                                slotProps={{ htmlInput: { autoCapitalize: 'none', spellCheck: false } }}
                                sx={{ flexGrow: 1 }}
                            />
                            <Button type='submit' variant='contained' disabled={!text}>
                                {globalize.translate('ButtonOk')}
                            </Button>
                        </Stack>
                    </form>

                    {decision !== undefined && (
                        <Typography variant='body2' color='text.secondary'>{decision}</Typography>
                    )}
                </Stack>
            </CardContent>
        </Card>
    );
};

export default UncertainLineCard;
```

- [ ] **Step 4: Write `ResolvedLinesList`**

`src/apps/legacy/features/subtitleOcr/components/ResolvedLinesList.tsx`:

```tsx
import Collapse from '@mui/material/Collapse';
import List from '@mui/material/List';
import ListItem from '@mui/material/ListItem';
import ListItemText from '@mui/material/ListItemText';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import React, { type FC, useState } from 'react';

import globalize from 'lib/globalize';

import type { ReviewLine } from '../types';
import DiffText from './DiffText';

interface ResolvedLinesListProps {
    lines: ReviewLine[];
}

/**
 * Certain and adjudicated lines need no decision; they are listed collapsed for audit, with no crop
 * images fetched (a full movie can have well over a thousand of these, so eagerly loading a crop per
 * row would be prohibitively expensive; the diff text alone is enough to audit a run).
 */
const ResolvedLinesList: FC<ResolvedLinesListProps> = ({ lines }) => {
    const [ open, setOpen ] = useState(false);

    if (lines.length === 0) return null;

    return (
        <>
            <Typography
                variant='body2'
                sx={{ cursor: 'pointer', textDecoration: 'underline' }}
                onClick={() => setOpen(o => !o)}
            >
                {globalize.translate('SubtitleOcrResolvedCount', lines.length)}
            </Typography>
            <Collapse in={open}>
                <List dense>
                    {lines.map(line => (
                        <ListItem key={line.Index} divider>
                            <ListItemText
                                primary={<DiffText original={line.OcrText} corrected={line.ChosenText} />}
                                secondary={line.Certainty === 'adjudicated' ? (
                                    <Tooltip title={line.Adjudication?.ModelId || ''}>
                                        <span>{globalize.translate('SubtitleOcrAdjudicatedBy')}</span>
                                    </Tooltip>
                                ) : undefined}
                            />
                        </ListItem>
                    ))}
                </List>
            </Collapse>
        </>
    );
};

export default ResolvedLinesList;
```

- [ ] **Step 5: Write `ReviewTable`**

`src/apps/legacy/features/subtitleOcr/components/ReviewTable.tsx`:

```tsx
import Alert from '@mui/material/Alert';
import Button from '@mui/material/Button';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import React, { type FC } from 'react';

import globalize from 'lib/globalize';

import type { Review } from '../types';
import { isReviewComplete, splitReview } from '../utils/review';
import ResolvedLinesList from './ResolvedLinesList';
import UncertainLineCard from './UncertainLineCard';

interface ReviewTableProps {
    jobId: string;
    review: Review;
    /** Keyed by `ReviewLine.Index`: the text the user has picked or typed for that uncertain line. */
    decisions: Record<number, string>;
    onDecide: (index: number, text: string) => void;
    namesText: string;
    onNamesTextChange: (value: string) => void;
    onFinish: () => void;
    isFinishing: boolean;
    /** Error from a failed Accept; decisions and names stay so the user can retry. */
    error?: string | null;
}

const ReviewTable: FC<ReviewTableProps> = ({
    jobId, review, decisions, onDecide, namesText, onNamesTextChange, onFinish, isFinishing, error
}) => {
    const split = splitReview(review);

    return (
        <Stack spacing={2}>
            <Typography variant='h2' component='h2'>{globalize.translate('SubtitleOcrReviewTitle')}</Typography>

            {split.uncertainLines.map(line => (
                <UncertainLineCard
                    key={line.Index}
                    jobId={jobId}
                    line={line}
                    decision={decisions[line.Index]}
                    onDecide={text => onDecide(line.Index, text)}
                />
            ))}

            <ResolvedLinesList lines={split.resolvedLines} />

            <TextField
                label={globalize.translate('SubtitleOcrNamesLabel')}
                placeholder={globalize.translate('SubtitleOcrNamesPlaceholder')}
                value={namesText}
                onChange={e => onNamesTextChange(e.target.value)}
                fullWidth
                size='small'
            />

            {error && <Alert severity='error'>{error}</Alert>}

            <Stack direction='row' justifyContent='flex-end'>
                <Button
                    variant='contained'
                    disabled={!isReviewComplete(split, decisions) || isFinishing}
                    onClick={onFinish}
                >
                    {globalize.translate(error ? 'SubtitleOcrRetry' : 'SubtitleOcrFinish')}
                </Button>
            </Stack>
        </Stack>
    );
};

export default ReviewTable;
```

- [ ] **Step 6: Lint and type check**

Run: `npx eslint src/apps/legacy/features/subtitleOcr/components && npm run build:check`
Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add src/apps/legacy/features/subtitleOcr/components
git commit -m "Add review table components: crop images, scored candidates, audit list

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 9: Wire the review into the page — decisions, names, auto-accept and completion

**Files:**
- Modify: `src/apps/legacy/routes/subtitleOcr.tsx`

**Interfaces:**
- Consumes: `useReview`, `useAccept` (Task 4), `splitReview`, `buildAcceptRequest` (Task 3), `ReviewTable` (Task 8), `getItemQuery` from `hooks/useItem`, `queryClient` from `utils/query/queryClient`.

- [ ] **Step 1: Add imports**

In `src/apps/legacy/routes/subtitleOcr.tsx` add:

```tsx
import { useAccept } from 'apps/legacy/features/subtitleOcr/api/useAccept';
import { useReview } from 'apps/legacy/features/subtitleOcr/api/useReview';
import ReviewTable from 'apps/legacy/features/subtitleOcr/components/ReviewTable';
import { buildAcceptRequest, splitReview } from 'apps/legacy/features/subtitleOcr/utils/review';
import { getItemQuery } from 'hooks/useItem';
import { queryClient } from 'utils/query/queryClient';
```

- [ ] **Step 2: Add review state, auto-accept and completion**

After the `const { data: job, isError: isJobError } = useJob(jobId);` line add:

```tsx
    const isReviewPhase = job?.State === 'AwaitingReview';
    const review = useReview(jobId, isReviewPhase);
    const accept = useAccept(jobId);
    const [ decisions, setDecisions ] = useState<Record<number, string>>({});
    const [ namesText, setNamesText ] = useState('');
    const split = useMemo(() => (review.data ? splitReview(review.data) : undefined), [ review.data ]);

    const onDecide = useCallback((index: number, text: string) => {
        setDecisions(prev => ({ ...prev, [index]: text }));
    }, []);

    const finish = useCallback(() => {
        if (!split || accept.isPending) return;
        accept.mutate(buildAcceptRequest(split, decisions, namesText));
    }, [ accept, decisions, namesText, split ]);

    // Nothing uncertain: accept without showing a review.
    const autoAccepted = useRef<string>();
    useEffect(() => {
        if (isReviewPhase && split?.autoAccept && jobId && autoAccepted.current !== jobId && !accept.isPending && !accept.isError) {
            autoAccepted.current = jobId;
            finish();
        }
    }, [ accept.isError, accept.isPending, finish, isReviewPhase, jobId, split?.autoAccept ]);

    // Done: tell the user, refresh the item and return to a freshly loaded details page.
    const completed = useRef<string>();
    useEffect(() => {
        if (job?.State !== 'Done' || !jobId || completed.current === jobId) return;
        completed.current = jobId;
        toast(globalize.translate('SubtitleOcrSaved', accept.data?.SavedCues ?? job.Total));
        void queryClient.invalidateQueries({ queryKey: getItemQuery(undefined, itemId, user?.Id).queryKey });
        const params = new URLSearchParams({ id: itemId || '', serverId: serverId || '' });
        navigate(`/details?${params.toString()}`, { replace: true });
    }, [ accept.data?.SavedCues, itemId, job, jobId, navigate, serverId, user?.Id ]);
```

`serverId` comes from `useSubtitleOcrParams`; add it to that destructuring if Task 7 did not already keep it there.

- [ ] **Step 3: Add the `review` case to the phase switch**

```tsx
        case 'review':
            if (!review.data || !split) {
                content = <Spinner />;
            } else if (split.autoAccept) {
                content = (
                    <JobProgress
                        job={job}
                        isReconnecting={false}
                        labelKeyOverride='SubtitleOcrSaving'
                        onCancel={onCancelClick}
                        isCancelling={cancelJob.isPending}
                    />
                );
            } else {
                content = (
                    <ReviewTable
                        jobId={jobId!}
                        review={review.data}
                        decisions={decisions}
                        onDecide={onDecide}
                        namesText={namesText}
                        onNamesTextChange={setNamesText}
                        onFinish={finish}
                        isFinishing={accept.isPending}
                        error={accept.isError ? String((accept.error as Error)?.message || accept.error) : null}
                    />
                );
            }
            break;
```

`jobId!` is safe here: reaching the `review` phase requires `hasJobId` to be true (see `phaseFor`). The `done` phase still renders `<Spinner />` (the completion effect above navigates away before it would ever need to render anything else).

- [ ] **Step 4: Lint and type check**

Run: `npx eslint src/apps/legacy/routes/subtitleOcr.tsx src/apps/legacy/features/subtitleOcr && npm run build:check`
Expected: clean.

- [ ] **Step 5: Verify in the browser**

Two runs on the rig server (see the server scoring-pipeline rig, `python tools/subtitle-rig/ocr_cycle.py`):

1. A track that yields uncertain lines: after "Recognising text" / "Generating candidates" / "Scoring candidates" / "Checking uncertain lines", the review screen shows one card per uncertain line with its crop image, scored candidate buttons and a free-text field, a "N lines resolved automatically" toggle that expands to a diff list with no network requests for images, and a names field. Finish stays disabled until every uncertain line has a decision. Finishing shows a "Subtitles saved (N cues)" toast, lands on the details page reloaded, where the convert button is gone and the subtitle selector lists the new external SRT.
2. A track where every line comes back `certain` or `adjudicated`: the page goes straight from progress to "Saving" to the toast and details page, with no review screen shown at all.

- [ ] **Step 6: Commit**

```bash
git add src/apps/legacy/routes/subtitleOcr.tsx
git commit -m "Wire the review table into the page: decisions, names, auto-accept

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 10: Failure view, start errors and lost-job recovery

**Files:**
- Create: `src/apps/legacy/features/subtitleOcr/components/JobFailed.tsx`
- Create: `src/apps/legacy/features/subtitleOcr/utils/errors.ts`
- Test: `src/apps/legacy/features/subtitleOcr/utils/errors.test.ts`
- Modify: `src/apps/legacy/routes/subtitleOcr.tsx`

**Interfaces:**
- Consumes: `statusOf` (Task 4), `PageMessage` (Task 5), `OcrJob`.
- Produces:
  - `startErrorMessage(error: unknown): string` — translation-ready text for a failed start: 404 gives `SubtitleOcrNotSupported`, otherwise the server's message or the error's message.
  - `nextStepAfterJobError(status?: number): 'restart' | 'keep'` — 404 means the job is gone and the page should drop `jobId` and start again; anything else keeps polling.
  - `JobFailed({ job, onRetry, onBack, isRetrying })`

- [ ] **Step 1: Write the failing tests**

`src/apps/legacy/features/subtitleOcr/utils/errors.test.ts`:

```ts
import { AxiosError } from 'axios';
import { describe, expect, it } from 'vitest';

import { nextStepAfterJobError, startErrorMessage } from './errors';

const axiosError = (status: number, data?: unknown) => new AxiosError('failed', String(status), undefined, undefined, {
    status, statusText: '', data, headers: {}, config: { headers: {} } as never
});

describe('startErrorMessage', () => {
    it('explains a 404 as an unsupported server', () => {
        expect(startErrorMessage(axiosError(404))).toBe('SubtitleOcrNotSupported');
    });

    it('uses the server message when the body is a string', () => {
        expect(startErrorMessage(axiosError(400, 'Stream 7 is not a bitmap subtitle.'))).toBe('Stream 7 is not a bitmap subtitle.');
    });

    it('uses a problem details title when present', () => {
        expect(startErrorMessage(axiosError(400, { title: 'Bad Request' }))).toBe('Bad Request');
    });

    it('falls back to the error message', () => {
        expect(startErrorMessage(new Error('boom'))).toBe('boom');
    });
});

describe('nextStepAfterJobError', () => {
    it('restarts when the job is gone', () => {
        expect(nextStepAfterJobError(404)).toBe('restart');
    });

    it('keeps polling for other failures', () => {
        expect(nextStepAfterJobError(500)).toBe('keep');
        expect(nextStepAfterJobError(undefined)).toBe('keep');
    });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/apps/legacy/features/subtitleOcr/utils/errors.test.ts`
Expected: FAIL with "Failed to resolve import './errors'".

- [ ] **Step 3: Implement**

`src/apps/legacy/features/subtitleOcr/utils/errors.ts`:

```ts
import { isAxiosError } from 'axios';

import { statusOf } from '../api/request';

/**
 * Text to show when starting a job failed. Returns a translation key for the unsupported-server case,
 * otherwise the server's own message. Callers pass the result through `globalize.translate`, which
 * returns unknown keys unchanged.
 */
export const startErrorMessage = (error: unknown): string => {
    if (statusOf(error) === 404) return 'SubtitleOcrNotSupported';

    if (isAxiosError(error)) {
        const data = error.response?.data as unknown;
        if (typeof data === 'string' && data) return data;
        if (data && typeof data === 'object') {
            const problem = data as { title?: string; detail?: string };
            if (problem.detail) return problem.detail;
            if (problem.title) return problem.title;
        }
    }

    return error instanceof Error ? error.message : String(error);
};

/** A 404 on the job means the server forgot it (restart with a discarded job); start over. */
export const nextStepAfterJobError = (status?: number): 'restart' | 'keep' =>
    status === 404 ? 'restart' : 'keep';
```

`src/apps/legacy/features/subtitleOcr/components/JobFailed.tsx`:

```tsx
import Button from '@mui/material/Button';
import React, { type FC } from 'react';

import globalize from 'lib/globalize';

import type { OcrJob } from '../types';
import PageMessage from './PageMessage';

interface JobFailedProps {
    job?: OcrJob;
    /** Message to show instead of the job's error, e.g. from a failed start. */
    message?: string | null;
    onRetry?: () => void;
    onBack: () => void;
    isRetrying: boolean;
}

const JobFailed: FC<JobFailedProps> = ({ job, message, onRetry, onBack, isRetrying }) => (
    <PageMessage
        title={globalize.translate('SubtitleOcrFailed')}
        text={message || job?.Error || globalize.translate('ErrorDefault')}
    >
        <Button onClick={onBack}>{globalize.translate('ButtonBack')}</Button>
        {onRetry && (
            <Button variant='contained' onClick={onRetry} disabled={isRetrying}>
                {globalize.translate('SubtitleOcrRetry')}
            </Button>
        )}
    </PageMessage>
);

export default JobFailed;
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/apps/legacy/features/subtitleOcr/utils/errors.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 5: Wire failures into the page**

In `src/apps/legacy/routes/subtitleOcr.tsx` add imports:

```tsx
import JobFailed from 'apps/legacy/features/subtitleOcr/components/JobFailed';
import { nextStepAfterJobError, startErrorMessage } from 'apps/legacy/features/subtitleOcr/utils/errors';
```

Change the `useJob` destructuring to also take the error:

```tsx
    const { data: job, isError: isJobError, error: jobError } = useJob(jobId);
```

Add, after it, the lost-job recovery:

```tsx
    // The server no longer knows this job (restart discarded it): drop the id and let the normal start flow run.
    useEffect(() => {
        if (isJobError && nextStepAfterJobError(statusOf(jobError)) === 'restart') {
            autoStarted.current = false;
            setJobId(undefined);
        }
    }, [ isJobError, jobError, setJobId ]);
```

(`autoStarted` must be declared above this effect; move the `useRef(false)` line up if needed.)

Remember the last started track so Retry can reuse it:

```tsx
    const lastTrack = useRef<EligibleTrack>();
```

and in `start`, before `startJob.mutate`, set `lastTrack.current = track;`.

Add a retry handler that starts a fresh job for the same track:

```tsx
    const retry = useCallback(() => {
        const track = lastTrack.current || tracks.find(t => t.mediaSourceId === job?.MediaSourceId && t.streamIndex === job?.StreamIndex) || tracks[0];
        if (!track) return;
        setJobId(undefined);
        startJob.reset();
        start(track);
    }, [ job?.MediaSourceId, job?.StreamIndex, setJobId, start, startJob, tracks ]);
```

Extend the `switch (phase)`:

```tsx
        case 'failed':
            content = (
                <JobFailed
                    job={job}
                    onRetry={retry}
                    onBack={goBack}
                    isRetrying={startJob.isPending}
                />
            );
            break;
```

and, before the switch, short-circuit a failed start:

```tsx
    if (startJob.isError) {
        content = (
            <JobFailed
                message={globalize.translate(startErrorMessage(startJob.error))}
                onRetry={statusOf(startJob.error) === 404 ? undefined : retry}
                onBack={goBack}
                isRetrying={startJob.isPending}
            />
        );
    } else {
        switch (phase) { /* existing cases */ }
    }
```

Note on Retry for a `Failed` job: the server discards failed jobs on restart, and `POST /Jobs` for the same track returns the existing job when it is still registered. If the server still returns the failed job, the user sees the failure again; the server plan (Task 9) removes a `Failed` job from the key map so a new start creates a fresh job. Verify this behaviour in Step 7 and, if a stale failed job comes back, call `cancelJob.mutateAsync(job.Id)` inside `retry` before `start(track)`.

- [ ] **Step 6: Lint and type check**

Run: `npx eslint src/apps/legacy/routes/subtitleOcr.tsx src/apps/legacy/features/subtitleOcr && npm run build:check`
Expected: clean.

- [ ] **Step 7: Verify in the browser**

1. Point the dev client at a Jellyfin server without the OCR feature (or temporarily change the route path in `request.ts` to `/SubtitleOcrX`, then revert): the button still shows for admins; tapping Convert yields "This server does not support subtitle conversion." with Back only.
2. Stop the `ocr-sidecar` container while a job is `Recognising`, then restart Jellyfin: the page shows the failure card with the server's message ("sidecar restarted, start again") and Retry starts a new job that extracts again.
3. Start a job, note the URL, stop the server, delete `<data>/subtitle-ocr/jobs/<jobId>.json`, start the server, reload the page URL: the page drops `jobId` and starts a fresh job automatically.

- [ ] **Step 8: Commit**

```bash
git add src/apps/legacy/routes/subtitleOcr.tsx src/apps/legacy/features/subtitleOcr
git commit -m "Handle failed and lost subtitle OCR jobs on the page

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 11: Burned-in subtitle settings on the transcoding dashboard page

**Files:**
- Create: `src/apps/dashboard/features/playback/types/encodingOptions.ts`
- Modify: `src/apps/dashboard/routes/playback/transcoding.tsx` (imports ~line 24, `action` ~line 39, `Component` state ~lines 54-55, form block after the `EnableSubtitleExtraction` `FormControl` ~line 240)
- Modify: `src/strings/en-us.json` (seven keys, inserted directly after the `"LabelBurnSubtitles"` line, ~line 678)

**Interfaces:**
- Consumes: the server's `EncodingOptions` JSON from `GET/POST /System/Configuration/encoding`, which on servers built from the `feature/subtitle-burn-in-engine` branch carries `BurnInTextSubtitles: boolean` (default `true`), `BurnInSubtitleFontSize1080p: number` (default 48, accepted 8..200) and `BurnInSubtitleOutlineWidth1080p: number` (default 2, accepted 0..20). Out-of-range values are clamped to the default by the server with a warning, so the page validates only with `min`/`max`. The page's existing `useNamedConfiguration('encoding')`, `onConfigChange`, `onCheckboxChange`, `onSubmit` and `action` are reused unchanged; `onConfigChange` stores number inputs as strings and the server accepts numbers from strings, exactly as the existing `VppTonemappingBrightness` field relies on.
- Produces: `ExtendedEncodingOptions` type used by the page; nothing else depends on this task.

Why a local type: the bundled `@jellyfin/sdk` was generated before the server change, so `EncodingOptions` has no burn-in members and `config.BurnInTextSubtitles` would not compile under `tsc`. The extension type disappears when the SDK is regenerated.

- [ ] **Step 1: Add the extension type**

`src/apps/dashboard/features/playback/types/encodingOptions.ts`:

```ts
import type { EncodingOptions } from '@jellyfin/sdk/lib/generated-client/models/encoding-options';

/**
 * Server encoding options that are newer than the bundled SDK.
 * Added by the server branch feature/subtitle-burn-in-engine; remove once the SDK is regenerated.
 */
export interface BurnInEncodingOptions {
    /** Burn text subtitles (srt, vtt, mov_text) into the video by default. Server default: true. */
    BurnInTextSubtitles?: boolean;
    /** Font size in pixels on a 1080p frame, scaled for other resolutions. Server accepts 8..200, default 48. */
    BurnInSubtitleFontSize1080p?: number;
    /** Outline width in pixels on a 1080p frame. Server accepts 0..20, default 2. */
    BurnInSubtitleOutlineWidth1080p?: number;
}

export type ExtendedEncodingOptions = EncodingOptions & BurnInEncodingOptions;

export const BURN_IN_FONT_SIZE_MIN = 8;
export const BURN_IN_FONT_SIZE_MAX = 200;
export const BURN_IN_OUTLINE_MIN = 0;
export const BURN_IN_OUTLINE_MAX = 20;
```

- [ ] **Step 2: Verify the type check fails before the page uses the type**

Add the form block from Step 4 to `transcoding.tsx` first (it references `config.BurnInTextSubtitles`), then run: `npm run build:check`
Expected: FAIL with `Property 'BurnInTextSubtitles' does not exist on type 'EncodingOptions'`. This is the RED step; Step 3 turns it green.

- [ ] **Step 3: Switch the page to the extended type**

In `src/apps/dashboard/routes/playback/transcoding.tsx`:

Replace the import
```ts
import type { EncodingOptions } from '@jellyfin/sdk/lib/generated-client/models/encoding-options';
```
with
```ts
import { BURN_IN_FONT_SIZE_MAX, BURN_IN_FONT_SIZE_MIN, BURN_IN_OUTLINE_MAX, BURN_IN_OUTLINE_MIN, type ExtendedEncodingOptions } from 'apps/dashboard/features/playback/types/encodingOptions';
```

and change the three type usages:
```ts
    const data = await request.json() as ExtendedEncodingOptions;
```
```ts
    const { data: initialConfig, isPending, isError } = useNamedConfiguration<ExtendedEncodingOptions>(CONFIG_KEY);
    const [ config, setConfig ] = useState<ExtendedEncodingOptions | null>(null);
```

- [ ] **Step 4: Add the form block**

Directly after the `FormControl` that contains the `EnableSubtitleExtraction` checkbox (it ends with `<FormHelperText>{globalize.translate('AllowOnTheFlySubtitleExtractionHelp')}</FormHelperText>` and `</FormControl>`), insert:

```tsx
                            <Typography variant='h3'>{globalize.translate('HeaderBurnedInSubtitles')}</Typography>

                            <FormControl>
                                <FormControlLabel
                                    label={globalize.translate('LabelBurnInTextSubtitles')}
                                    control={
                                        <Checkbox
                                            name='BurnInTextSubtitles'
                                            checked={config.BurnInTextSubtitles ?? true}
                                            onChange={onCheckboxChange}
                                        />
                                    }
                                />
                                <FormHelperText>{globalize.translate('LabelBurnInTextSubtitlesHelp')}</FormHelperText>
                            </FormControl>

                            <TextField
                                name='BurnInSubtitleFontSize1080p'
                                value={config.BurnInSubtitleFontSize1080p ?? 48}
                                onChange={onConfigChange}
                                label={globalize.translate('LabelBurnInSubtitleFontSize')}
                                helperText={globalize.translate('LabelBurnInSubtitleFontSizeHelp')}
                                type='number'
                                slotProps={{
                                    htmlInput: {
                                        min: BURN_IN_FONT_SIZE_MIN,
                                        max: BURN_IN_FONT_SIZE_MAX,
                                        step: 1
                                    }
                                }}
                            />

                            <TextField
                                name='BurnInSubtitleOutlineWidth1080p'
                                value={config.BurnInSubtitleOutlineWidth1080p ?? 2}
                                onChange={onConfigChange}
                                label={globalize.translate('LabelBurnInSubtitleOutlineWidth')}
                                helperText={globalize.translate('LabelBurnInSubtitleOutlineWidthHelp')}
                                type='number'
                                slotProps={{
                                    htmlInput: {
                                        min: BURN_IN_OUTLINE_MIN,
                                        max: BURN_IN_OUTLINE_MAX,
                                        step: 1
                                    }
                                }}
                            />
```

The `?? 48` / `?? 2` / `?? true` fallbacks only matter against an older server whose JSON lacks the members; they mirror the server defaults so the form never renders an empty number field.

- [ ] **Step 5: Add the strings**

In `src/strings/en-us.json`, directly after the line `"LabelBurnSubtitles": "Burn subtitles",` insert (keep the file's 4-space indentation and trailing commas):

```json
    "HeaderBurnedInSubtitles": "Burned-in subtitles",
    "LabelBurnInTextSubtitles": "Burn in text subtitles by default",
    "LabelBurnInTextSubtitlesHelp": "Render SRT and other text subtitles into the video on the server, so every client (including Chromecast) shows white text with a black outline instead of its own styling. A video transcode is required whenever a text subtitle is selected. Users without video transcoding permission keep the client-rendered subtitles.",
    "LabelBurnInSubtitleFontSize": "Burned-in subtitle font size",
    "LabelBurnInSubtitleFontSizeHelp": "Font size in pixels on a 1080p frame, scaled proportionally for other resolutions. 8 to 200, default 48.",
    "LabelBurnInSubtitleOutlineWidth": "Burned-in subtitle outline width",
    "LabelBurnInSubtitleOutlineWidthHelp": "Black outline width in pixels on a 1080p frame. 0 to 20, default 2.",
```

- [ ] **Step 6: Lint and type check**

Run:
```bash
npx eslint src/apps/dashboard/routes/playback/transcoding.tsx src/apps/dashboard/features/playback/types/encodingOptions.ts
npm run build:check
```
Expected: no lint output; tsc succeeds.

- [ ] **Step 7: Verify against the rig server**

The server rig (`C:\Users\bru\spare-source\jellyfin`, skill `subtitle-rig`, container `jf-rig` on `http://localhost:18096`) runs the burn-in branch. Build this web client (`npm run build:development`) and point the rig container at it, or open the dashboard from a dev server that proxies to `localhost:18096`. Then:

1. Open Dashboard → Playback → Transcoding. Expected: the three new fields show `true`, `48`, `2`.
2. Set the font size to `60`, save. Expected: the saved toast; `curl -s -H "Authorization: MediaBrowser Token=<token from tools/subtitle-rig/rig_state.json>" http://localhost:18096/System/Configuration/encoding | grep -o '"BurnInSubtitleFontSize1080p":[0-9]*'` prints `60`.
3. In the server repo run `python tools/subtitle-rig/cycle.py --resume --expect encode --label web-size-60`. Expected: `MET`, and `podman exec jf-rig sh -c 'grep -o "FontSize=[0-9.]*" /config/log/FFmpeg.Transcode-*.log | tail -1'` prints `FontSize=16` (60 × 288 / 1080). Open `~/.jellyfin-subtitle-rig/captures/web-size-60-native-Embedded.png` and confirm the text is visibly larger than in `tools/subtitle-rig/expected/burnin-native-Embedded.png` of the server repo.
4. Untick "Burn in text subtitles by default", save, run `--resume --expect external --label web-off`. Expected: `MET`. Re-tick, set the size back to `48`, save.

- [ ] **Step 8: Commit**

```bash
git add src/apps/dashboard/features/playback/types/encodingOptions.ts src/apps/dashboard/routes/playback/transcoding.tsx src/strings/en-us.json
git commit -m "Add burned-in subtitle settings to the transcoding dashboard page

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 12: Full pass, Pixel 8 viewport check and spec status

**Files:**
- Modify: `docs/superpowers/specs/2026-09-28-subtitle-ocr-page-design.md` (the `Status:` line)

- [ ] **Step 1: Run the whole test suite, lint and type check**

```bash
npm test
npx eslint src/apps/legacy/features/subtitleOcr src/apps/legacy/routes/subtitleOcr.tsx src/apps/legacy/controllers/itemDetails src/apps/legacy/routes/asyncRoutes src/apps/modern/routes/asyncRoutes src/apps/dashboard/routes/playback/transcoding.tsx src/apps/dashboard/features/playback/types
npm run build:check
npm run build:production
```

Expected: all tests pass, no lint output, tsc and the production build succeed.

- [ ] **Step 2: Pixel 8 viewport manual pass**

In the browser's device emulation, select or enter the Pixel 8 preset (412 × 915 CSS pixels, touch enabled), and run the full flow from the details page button through the review table to the toast and reloaded details page, against the Bitmap movie's English-language PGS track.
Expected: no horizontal scrolling; crop images fit the width; candidate buttons wrap; the free-text field is not focused on load on touch layouts; the Finish button is reachable below the last card; the "N lines resolved automatically" toggle expands without layout shift. Repeat once at desktop width. Also open Dashboard → Playback → Transcoding at phone width and confirm the three burned-in subtitle fields stack without overflow.

- [ ] **Step 3: Danish-language pass**

Repeat the flow at the Pixel 8 viewport against a Danish-language bitmap track (the server's scoring pipeline runs Tesseract `dan` with the `da_DK` lexicon for it; the rig's `make_media.py` can mux a second PGS or VobSub track from a Danish SRT containing æ, ø and å; if none is available, type `æ`, `ø` and `å` into an uncertain line's free-text field during an English-track run to confirm entry and display).
Expected: crop images and candidate text render the Danish letters correctly; typing `æ`, `ø` or `å` in the free-text field submits correctly; the collapsed resolved-lines list renders them correctly too. The server no longer applies any English-specific fix list to non-English tracks (that whole mechanism was dropped with the nOCR engine), so there is nothing English-specific left to check for on this track.

- [ ] **Step 4: Update the spec status and commit**

Change the spec's `Status:` line to `Status: implemented on branch feature/subtitle-ocr-page`.

```bash
git add docs/superpowers/specs/2026-09-28-subtitle-ocr-page-design.md
git commit -m "Mark subtitle OCR page spec as implemented

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```
