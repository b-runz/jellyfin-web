# Subtitle OCR Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `subtitleocr` React page to jellyfin-web, reached from a new button on the movie details page, that drives the server's bitmap subtitle OCR job and prompts the administrator only for unknown glyphs and uncertain corrections.

**Architecture:** A feature folder `src/apps/legacy/features/subtitleOcr/` holds typed react-query hooks over the `/SubtitleOcr` routes, pure utilities (eligibility, word diff, review splitting) with vitest tests, and MUI components for each phase. A page file `src/apps/legacy/routes/subtitleOcr.tsx` reads `itemId`, `serverId` and `jobId` from the query string and renders the component matching the job state. The legacy details page controller gains one button that navigates to the route.

**Tech Stack:** React 18, react-router-dom 6.30 (`useSearchParams`, `useNavigate`, `useBlocker`), `@tanstack/react-query` 5, `@jellyfin/sdk` `Api` (axios) via `hooks/useApi`, MUI 6 (`@mui/material`), vitest 3 with jsdom, ESLint with `@stylistic` (4-space indent, single quotes, no trailing commas).

**Spec:** `docs/superpowers/specs/2026-09-28-subtitle-ocr-page-design.md`

## Global Constraints

- Repository `C:\Users\bru\spare-source\jellyfin-web`, branch `feature/subtitle-ocr-page`. Run all commands from the repository root.
- Node modules are not installed at the time of writing; run `npm ci` once before Task 1.
- Style: 4-space indentation, single quotes (`'`), JSX single quotes, no trailing commas, spaces inside object braces and array brackets (`[ a, b ]`, `{ a }`), semicolons, final newline. Check with `npx eslint <files>`.
- Type check with `npm run build:check` (`tsc --noEmit`). Tests with `npx vitest run <path>`.
- MUI components are imported per file: `import Button from '@mui/material/Button';`. Icons from `@mui/icons-material/<Name>`.
- Translations: add keys to `src/strings/en-us.json` only, inserted alphabetically among the existing `Subtitle...` keys. Never edit other language files.
- Server payloads are PascalCase (`Id`, `State`, `CuesDone`). Type names in `types/` mirror the server plan records exactly.
- Every server route lives under `${api.basePath}/SubtitleOcr` and needs the `Authorization: api.authorizationHeader` header, as `src/utils/bitrateTest.ts` does.
- The job id URL parameter is `jobId`; item and server parameters are `itemId` and `serverId`.
- Commit after every task with the trailer `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.

## Review Focus

1. **A media source with a PGS track and an external SRT whose `Language` differs only in case (`ENG` vs `eng`).** Expected: the track is not eligible. Test in Task 1.
2. **A cue where the correction only inserts a word, or only deletes one (`"I am here"` to `"I am not here"`).** Expected: `wordDiff` yields an `added` or `removed` segment with no crash and `changedWords` counts one word. Test in Task 2.
3. **A review whose `Edits` is empty and `DetectedNames` has one uncertain name.** Expected: `autoAccept` is false and the uncertainty prompt shows just the name card. Test in Task 3.
4. **A glyph answer request that times out after the server already applied it.** Expected: the page refetches the glyph, sees a different `ShapeId`, drops the pending answer and shows the next glyph, without a duplicate `Learn`. Test in Task 8 (a unit test of the pure `resolveAnswerOutcome` decision helper).
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
  - all types listed in Step 3 (`JobState`, `OcrJob`, `GlyphQuestion`, `StartJobRequest`, `GlyphAnswer`, `ReviewCue`, `ReviewEdit`, `DetectedName`, `Review`, `AcceptRequest`, `AcceptResult`, `EligibleTrack`)
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
/** Server job states, see the server plan Task 9 (`SubtitleOcrJobState`). */
export type JobState =
    | 'Extracting'
    | 'Recognising'
    | 'AwaitingGlyph'
    | 'Correcting'
    | 'AwaitingReview'
    | 'Done'
    | 'Failed'
    | 'Cancelled';

export interface OcrJob {
    Id: string;
    ItemId: string;
    MediaSourceId: string;
    StreamIndex: number;
    State: JobState;
    CuesDone: number;
    CuesTotal: number;
    QuestionsRemaining: number;
    Error?: string | null;
    Warning?: string | null;
}

export interface GlyphQuestion {
    ShapeId: string;
    CueIndex: number;
    LetterPngBase64: string;
    CuePngBase64: string;
    Left: number;
    Top: number;
    Width: number;
    Height: number;
    Candidates: string[];
    Remaining: number;
    Occurrences: number;
}

export interface StartJobRequest {
    ItemId: string;
    MediaSourceId: string;
    StreamIndex: number;
}

export interface GlyphAnswer {
    ShapeId: string;
    Text?: string | null;
    Italic: boolean;
    Skip: boolean;
}

export interface ReviewCue {
    Index: number;
    Start: string;
    End: string;
    Text: string;
}

export interface ReviewEdit {
    Id: number;
    CueIndex: number;
    Original: string;
    Corrected: string;
    Reason: string;
    Certain: boolean;
}

export interface DetectedName {
    Name: string;
    CueIndex: number;
    Certain: boolean;
}

export interface Review {
    Cues: ReviewCue[];
    Edits: ReviewEdit[];
    DetectedNames: DetectedName[];
    CorrectorError?: string | null;
}

export interface AcceptRequest {
    RejectedEditIds: number[];
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
export const PROGRESS_STATES: JobState[] = [ 'Extracting', 'Recognising', 'Correcting' ];

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

### Task 3: Review splitting and accept request builder

**Files:**
- Create: `src/apps/legacy/features/subtitleOcr/utils/review.ts`
- Test: `src/apps/legacy/features/subtitleOcr/utils/review.test.ts`

**Interfaces:**
- Consumes: `Review`, `ReviewEdit`, `DetectedName`, `AcceptRequest` (Task 1), `changedWords` (Task 2).
- Produces:
  - `interface SplitReview { certainEdits: ReviewEdit[]; uncertainEdits: ReviewEdit[]; certainNames: DetectedName[]; uncertainNames: DetectedName[]; autoAccept: boolean }`
  - `splitReview(review: Review): SplitReview`
  - `type EditDecision = 'accept' | 'reject'`
  - `interface ReviewAnswers { edits: Record<number, EditDecision>; neverAsk: Record<number, boolean>; names: Record<string, boolean> }`
  - `isReviewComplete(split: SplitReview, answers: ReviewAnswers): boolean`
  - `buildAcceptRequest(split: SplitReview, answers: ReviewAnswers): AcceptRequest`
  - `emptyAnswers(): ReviewAnswers`

- [ ] **Step 1: Write the failing tests**

`src/apps/legacy/features/subtitleOcr/utils/review.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

import type { DetectedName, Review, ReviewEdit } from '../types';
import { buildAcceptRequest, emptyAnswers, isReviewComplete, splitReview } from './review';

const edit = (id: number, certain: boolean, original = 'l am', corrected = 'I am'): ReviewEdit => ({
    Id: id,
    CueIndex: id,
    Original: original,
    Corrected: corrected,
    Reason: 'ocr',
    Certain: certain
});

const name = (value: string, certain: boolean): DetectedName => ({ Name: value, CueIndex: 0, Certain: certain });

const review = (edits: ReviewEdit[], names: DetectedName[]): Review => ({
    Cues: [],
    Edits: edits,
    DetectedNames: names,
    CorrectorError: null
});

describe('splitReview', () => {
    it('auto-accepts when every edit and name is certain', () => {
        const split = splitReview(review([ edit(1, true) ], [ name('Anakin', true) ]));

        expect(split.autoAccept).toBe(true);
        expect(split.certainEdits).toHaveLength(1);
        expect(split.uncertainEdits).toHaveLength(0);
        expect(split.certainNames.map(n => n.Name)).toEqual([ 'Anakin' ]);
    });

    it('auto-accepts an empty review', () => {
        expect(splitReview(review([], [])).autoAccept).toBe(true);
    });

    it('does not auto-accept when only an uncertain name is present', () => {
        const split = splitReview(review([], [ name('Padme', false) ]));

        expect(split.autoAccept).toBe(false);
        expect(split.uncertainNames.map(n => n.Name)).toEqual([ 'Padme' ]);
    });

    it('does not auto-accept when an uncertain edit is present', () => {
        expect(splitReview(review([ edit(1, true), edit(2, false) ], [])).autoAccept).toBe(false);
    });
});

describe('isReviewComplete', () => {
    it('requires an answer for every uncertain edit and name', () => {
        const split = splitReview(review([ edit(1, false), edit(2, false) ], [ name('Padme', false) ]));
        const answers = emptyAnswers();

        expect(isReviewComplete(split, answers)).toBe(false);

        answers.edits[1] = 'accept';
        answers.edits[2] = 'reject';
        expect(isReviewComplete(split, answers)).toBe(false);

        answers.names.Padme = true;
        expect(isReviewComplete(split, answers)).toBe(true);
    });

    it('is complete immediately when nothing is uncertain', () => {
        expect(isReviewComplete(splitReview(review([ edit(1, true) ], [])), emptyAnswers())).toBe(true);
    });
});

describe('buildAcceptRequest', () => {
    it('sends no rejections and all certain names on auto-accept', () => {
        const split = splitReview(review([ edit(1, true) ], [ name('Anakin', true) ]));

        expect(buildAcceptRequest(split, emptyAnswers())).toEqual({
            RejectedEditIds: [],
            Names: [ 'Anakin' ],
            NeverAsk: []
        });
    });

    it('collects rejected ids, accepted uncertain names and never-ask words', () => {
        const split = splitReview(review(
            [ edit(1, false, 'gonna go', 'going to go'), edit(2, false), edit(3, true) ],
            [ name('Anakin', true), name('Padme', false), name('Rn', false) ]
        ));
        const answers = emptyAnswers();
        answers.edits[1] = 'reject';
        answers.neverAsk[1] = true;
        answers.edits[2] = 'accept';
        answers.names.Padme = true;
        answers.names.Rn = false;

        expect(buildAcceptRequest(split, answers)).toEqual({
            RejectedEditIds: [ 1 ],
            Names: [ 'Anakin', 'Padme' ],
            NeverAsk: [ 'gonna' ]
        });
    });

    it('does not add never-ask words for a rejected edit when the box is unchecked', () => {
        const split = splitReview(review([ edit(1, false, 'gonna', 'going to') ], []));
        const answers = emptyAnswers();
        answers.edits[1] = 'reject';

        expect(buildAcceptRequest(split, answers).NeverAsk).toEqual([]);
    });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/apps/legacy/features/subtitleOcr/utils/review.test.ts`
Expected: FAIL with "Failed to resolve import './review'".

- [ ] **Step 3: Implement**

`src/apps/legacy/features/subtitleOcr/utils/review.ts`:

```ts
import type { AcceptRequest, DetectedName, Review, ReviewEdit } from '../types';
import { changedWords } from './wordDiff';

export interface SplitReview {
    certainEdits: ReviewEdit[];
    uncertainEdits: ReviewEdit[];
    certainNames: DetectedName[];
    uncertainNames: DetectedName[];
    /** True when there is nothing to ask the user about. */
    autoAccept: boolean;
}

export type EditDecision = 'accept' | 'reject';

export interface ReviewAnswers {
    /** Keyed by `ReviewEdit.Id`. */
    edits: Record<number, EditDecision>;
    /** Keyed by `ReviewEdit.Id`; true when the rejected edit's words should never be asked about again. */
    neverAsk: Record<number, boolean>;
    /** Keyed by `DetectedName.Name`; true when the user confirmed it is a name. */
    names: Record<string, boolean>;
}

export const emptyAnswers = (): ReviewAnswers => ({ edits: {}, neverAsk: {}, names: {} });

export const splitReview = (review: Review): SplitReview => {
    const certainEdits = review.Edits.filter(e => e.Certain);
    const uncertainEdits = review.Edits.filter(e => !e.Certain);
    const certainNames = review.DetectedNames.filter(n => n.Certain);
    const uncertainNames = review.DetectedNames.filter(n => !n.Certain);

    return {
        certainEdits,
        uncertainEdits,
        certainNames,
        uncertainNames,
        autoAccept: uncertainEdits.length === 0 && uncertainNames.length === 0
    };
};

export const isReviewComplete = (split: SplitReview, answers: ReviewAnswers): boolean =>
    split.uncertainEdits.every(e => answers.edits[e.Id] !== undefined)
    && split.uncertainNames.every(n => answers.names[n.Name] !== undefined);

export const buildAcceptRequest = (split: SplitReview, answers: ReviewAnswers): AcceptRequest => {
    const rejected = split.uncertainEdits.filter(e => answers.edits[e.Id] === 'reject');

    const neverAsk = rejected
        .filter(e => answers.neverAsk[e.Id])
        .flatMap(e => changedWords(e.Original, e.Corrected));

    const names = [
        ...split.certainNames.map(n => n.Name),
        ...split.uncertainNames.filter(n => answers.names[n.Name] === true).map(n => n.Name)
    ];

    return {
        RejectedEditIds: rejected.map(e => e.Id),
        Names: Array.from(new Set(names)),
        NeverAsk: Array.from(new Set(neverAsk))
    };
};
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/apps/legacy/features/subtitleOcr/utils`
Expected: PASS, all three utility test files.

- [ ] **Step 5: Lint and commit**

```bash
npx eslint src/apps/legacy/features/subtitleOcr
git add src/apps/legacy/features/subtitleOcr/utils/review.ts src/apps/legacy/features/subtitleOcr/utils/review.test.ts
git commit -m "Add review splitting and accept request builder for subtitle OCR

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 4: API hooks over the `/SubtitleOcr` routes

**Files:**
- Create: `src/apps/legacy/features/subtitleOcr/api/request.ts`
- Create: `src/apps/legacy/features/subtitleOcr/api/useStartJob.ts`
- Create: `src/apps/legacy/features/subtitleOcr/api/useJob.ts`
- Create: `src/apps/legacy/features/subtitleOcr/api/useGlyph.ts`
- Create: `src/apps/legacy/features/subtitleOcr/api/useAnswerGlyph.ts`
- Create: `src/apps/legacy/features/subtitleOcr/api/useReview.ts`
- Create: `src/apps/legacy/features/subtitleOcr/api/useAccept.ts`
- Create: `src/apps/legacy/features/subtitleOcr/api/useCancelJob.ts`
- Test: `src/apps/legacy/features/subtitleOcr/api/request.test.ts`

**Interfaces:**
- Consumes: `Api` from `@jellyfin/sdk` (`api.basePath`, `api.authorizationHeader`, `api.axiosInstance`), `useApi` from `hooks/useApi`, `queryClient` from `utils/query/queryClient`, types and constants from Task 1.
- Produces:
  - `ocrRequest<T>(api: Api, method: 'GET' | 'POST' | 'DELETE', path: string, data?: unknown, signal?: AbortSignal): Promise<AxiosResponse<T>>` — `path` is appended to `/SubtitleOcr`.
  - `statusOf(error: unknown): number | undefined` — HTTP status of an axios error, else undefined.
  - `jobQueryKey(jobId)`, `glyphQueryKey(jobId)`, `reviewQueryKey(jobId)`.
  - `useStartJob(): UseMutationResult<OcrJob, unknown, StartJobRequest>`
  - `useJob(jobId?: string): UseQueryResult<OcrJob>` — polls while in `PROGRESS_STATES`.
  - `useGlyph(jobId: string | undefined, enabled: boolean): UseQueryResult<GlyphQuestion | null>`
  - `useAnswerGlyph(jobId?: string): UseMutationResult<void, unknown, GlyphAnswer>`
  - `useReview(jobId: string | undefined, enabled: boolean): UseQueryResult<Review>`
  - `useAccept(jobId?: string): UseMutationResult<AcceptResult, unknown, AcceptRequest>`
  - `useCancelJob(): UseMutationResult<void, unknown, string>` (argument is the job id)

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
import { type AxiosResponse, isAxiosError } from 'axios';

import { QUERY_KEY } from '../constants';

export type OcrMethod = 'GET' | 'POST' | 'DELETE';

/**
 * Sends a request to a `/SubtitleOcr` route. These routes are not in the generated SDK client,
 * so the SDK's axios instance is used directly with the same authorization header the SDK would send.
 */
export const ocrRequest = <T>(
    api: Api,
    method: OcrMethod,
    path: string,
    data?: unknown,
    signal?: AbortSignal
): Promise<AxiosResponse<T>> => api.axiosInstance.request<T>({
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
export const glyphQueryKey = (jobId?: string) => [ QUERY_KEY, 'Glyph', jobId ];
export const reviewQueryKey = (jobId?: string) => [ QUERY_KEY, 'Review', jobId ];
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/apps/legacy/features/subtitleOcr/api/request.test.ts`
Expected: PASS, 3 tests.

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

`src/apps/legacy/features/subtitleOcr/api/useGlyph.ts`:

```ts
import { useQuery } from '@tanstack/react-query';

import { useApi } from 'hooks/useApi';

import type { GlyphQuestion } from '../types';
import { glyphQueryKey, ocrRequest } from './request';

/** The glyph question at the head of the server's queue, or null when there is none (HTTP 204). */
export const useGlyph = (jobId: string | undefined, enabled: boolean) => {
    const { api } = useApi();

    return useQuery({
        queryKey: glyphQueryKey(jobId),
        queryFn: async ({ signal }) => {
            const response = await ocrRequest<GlyphQuestion | ''>(api!, 'GET', `/Jobs/${jobId}/Glyph`, undefined, signal);
            return response.status === 204 || !response.data ? null : response.data;
        },
        enabled: !!api && !!jobId && enabled,
        staleTime: 0
    });
};
```

`src/apps/legacy/features/subtitleOcr/api/useAnswerGlyph.ts`:

```ts
import { useMutation } from '@tanstack/react-query';

import { useApi } from 'hooks/useApi';
import { queryClient } from 'utils/query/queryClient';

import type { GlyphAnswer } from '../types';
import { glyphQueryKey, jobQueryKey, ocrRequest } from './request';

export const useAnswerGlyph = (jobId?: string) => {
    const { api } = useApi();

    return useMutation({
        mutationFn: async (answer: GlyphAnswer) => {
            await ocrRequest<void>(api!, 'POST', `/Jobs/${jobId}/Glyph`, answer);
        },
        onSettled: () => Promise.all([
            queryClient.invalidateQueries({ queryKey: glyphQueryKey(jobId) }),
            queryClient.invalidateQueries({ queryKey: jobQueryKey(jobId) })
        ])
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

- [ ] **Step 6: Lint and type check**

Run: `npx eslint src/apps/legacy/features/subtitleOcr && npm run build:check`
Expected: no lint output, tsc exits 0. If tsc complains that `refetchInterval`'s callback parameter is untyped, annotate it as `(query: { state: { data?: OcrJob } })`.

- [ ] **Step 7: Commit**

```bash
git add src/apps/legacy/features/subtitleOcr/api
git commit -m "Add react-query hooks for the subtitle OCR routes

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
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
    "SubtitleOcrAccept": "Accept",
    "SubtitleOcrAdminRequired": "Administrator access is required to convert subtitles.",
    "SubtitleOcrCancelConversion": "Cancel conversion",
    "SubtitleOcrChecking": "Checking spelling",
    "SubtitleOcrConvert": "Convert",
    "SubtitleOcrExtracting": "Extracting subtitles",
    "SubtitleOcrFailed": "The conversion failed",
    "SubtitleOcrFinish": "Finish",
    "SubtitleOcrIsName": "It's a name",
    "SubtitleOcrItalic": "Italic",
    "SubtitleOcrLeaveConfirm": "Leaving this page cancels the conversion. Leave anyway?",
    "SubtitleOcrNeverAsk": "Never ask about this word again",
    "SubtitleOcrNothingToConvert": "This item has no PGS or VobSub subtitle track without a text version.",
    "SubtitleOcrNotName": "Not a name",
    "SubtitleOcrNotSupported": "This server does not support subtitle conversion.",
    "SubtitleOcrOccurrences": "Used in {0} cues",
    "SubtitleOcrPickTrack": "Choose the subtitle track to convert",
    "SubtitleOcrRecognising": "Recognising text",
    "SubtitleOcrReconnecting": "Reconnecting",
    "SubtitleOcrReject": "Reject",
    "SubtitleOcrRemaining": "{0} remaining",
    "SubtitleOcrRetry": "Retry",
    "SubtitleOcrReviewTitle": "Please check these",
    "SubtitleOcrSaved": "Subtitles saved ({0} cues)",
    "SubtitleOcrSaving": "Saving",
    "SubtitleOcrShapesNeedHelp": "{0} letter shapes need your help",
    "SubtitleOcrSkip": "Skip",
    "SubtitleOcrTitle": "Convert subtitles",
    "SubtitleOcrTypeLetter": "Type the letter",
    "SubtitleOcrUnknownLetter": "Which letter is this?",
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
Expected: the page titled "Convert subtitles" shows a track picker listing the PGS track with a Convert button. For an item without bitmap tracks the "nothing to convert" card appears with Back. Signed in as a non-admin the page toasts and lands on home.

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
Expected: a `document_scanner` icon button appears after Download with the tooltip "Convert subtitles to text" and tapping it opens the page from Task 5 with the track picker. On a movie with only text subtitles the button is absent. Signed in as a non-admin the button is absent. If the icon renders as a box with text, the font lacks that glyph: switch the class to `text_fields` in both this step and the spec.

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
  - `type Phase = 'loading' | 'pick' | 'nothing' | 'progress' | 'glyph' | 'review' | 'done' | 'failed'`
  - `phaseFor(args: { hasJobId: boolean; job?: OcrJob; trackCount: number; itemLoaded: boolean }): Phase`
  - `isJobActive(state?: JobState): boolean` — true for every non-terminal state.
  - `progressLabelKey(state: JobState): string` — the translation key for the phase label.
  - `JobProgress({ job, isReconnecting, onCancel, isCancelling, labelKeyOverride? })`
  - `useLeaveGuard(active: boolean, onLeave: () => Promise<void>)` — blocks in-app navigation while `active`, confirms with the user, runs `onLeave` then proceeds.

- [ ] **Step 1: Write the failing phase tests**

`src/apps/legacy/features/subtitleOcr/utils/phase.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

import type { OcrJob } from '../types';
import { isJobActive, phaseFor, progressLabelKey } from './phase';

const job = (State: OcrJob['State']): OcrJob => ({
    Id: 'j', ItemId: 'i', MediaSourceId: 'm', StreamIndex: 2, State, CuesDone: 0, CuesTotal: 0, QuestionsRemaining: 0
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
        expect(at('Recognising')).toBe('progress');
        expect(at('Correcting')).toBe('progress');
        expect(at('AwaitingGlyph')).toBe('glyph');
        expect(at('AwaitingReview')).toBe('review');
        expect(at('Done')).toBe('done');
        expect(at('Failed')).toBe('failed');
        expect(at('Cancelled')).toBe('failed');
    });
});

describe('isJobActive', () => {
    it('is true for non-terminal states only', () => {
        expect(isJobActive('Extracting')).toBe(true);
        expect(isJobActive('AwaitingGlyph')).toBe(true);
        expect(isJobActive('AwaitingReview')).toBe(true);
        expect(isJobActive('Done')).toBe(false);
        expect(isJobActive('Failed')).toBe(false);
        expect(isJobActive('Cancelled')).toBe(false);
        expect(isJobActive(undefined)).toBe(false);
    });
});

describe('progressLabelKey', () => {
    it('names each working phase', () => {
        expect(progressLabelKey('Extracting')).toBe('SubtitleOcrExtracting');
        expect(progressLabelKey('Recognising')).toBe('SubtitleOcrRecognising');
        expect(progressLabelKey('Correcting')).toBe('SubtitleOcrChecking');
        expect(progressLabelKey('AwaitingReview')).toBe('SubtitleOcrSaving');
    });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/apps/legacy/features/subtitleOcr/utils/phase.test.ts`
Expected: FAIL with "Failed to resolve import './phase'".

- [ ] **Step 3: Implement the phase helpers**

`src/apps/legacy/features/subtitleOcr/utils/phase.ts`:

```ts
import type { JobState, OcrJob } from '../types';

export type Phase = 'loading' | 'pick' | 'nothing' | 'progress' | 'glyph' | 'review' | 'done' | 'failed';

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
        case 'AwaitingGlyph':
            return 'glyph';
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

export const progressLabelKey = (state: JobState): string => {
    switch (state) {
        case 'Extracting':
            return 'SubtitleOcrExtracting';
        case 'Recognising':
            return 'SubtitleOcrRecognising';
        case 'Correcting':
            return 'SubtitleOcrChecking';
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
    const labelKey = labelKeyOverride || (job ? progressLabelKey(job.State) : 'SubtitleOcrExtracting');
    const showBar = job?.State === 'Recognising' && job.CuesTotal > 0;
    const percent = showBar ? Math.round((job.CuesDone / job.CuesTotal) * 100) : 0;

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
                    <Typography variant='body2'>{job.CuesDone} / {job.CuesTotal}</Typography>
                )}
                {!!job?.QuestionsRemaining && (
                    <Typography variant='body2'>
                        {globalize.translate('SubtitleOcrShapesNeedHelp', job.QuestionsRemaining)}
                    </Typography>
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
            // glyph, review, done and failed are added in the following tasks.
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

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 8: Glyph prompt with keyboard entry and answer re-anchoring

**Files:**
- Create: `src/apps/legacy/features/subtitleOcr/components/GlyphPrompt.tsx`
- Create: `src/apps/legacy/features/subtitleOcr/components/GlyphImage.tsx`
- Create: `src/apps/legacy/features/subtitleOcr/utils/glyphAnswer.ts`
- Test: `src/apps/legacy/features/subtitleOcr/utils/glyphAnswer.test.ts`
- Modify: `src/apps/legacy/routes/subtitleOcr.tsx`

**Interfaces:**
- Consumes: `useGlyph`, `useAnswerGlyph`, `statusOf` (Task 4), `GlyphQuestion`, `GlyphAnswer` (Task 1), `layoutManager` from `components/layoutManager`.
- Produces:
  - `type AnswerOutcome = 'applied' | 'resend' | 'give-up'`
  - `resolveAnswerOutcome(args: { answeredShapeId: string; currentShapeId: string | null | undefined; attempts: number; status?: number }): AnswerOutcome`
  - `GlyphImage({ question })` — cue image with the letter bounds drawn.
  - `GlyphPrompt({ question, onAnswer: (answer: GlyphAnswer) => void, isSubmitting: boolean, pendingRetry?: GlyphAnswer, onRetry: () => void })`

- [ ] **Step 1: Write the failing re-anchoring tests**

`src/apps/legacy/features/subtitleOcr/utils/glyphAnswer.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

import { resolveAnswerOutcome } from './glyphAnswer';

describe('resolveAnswerOutcome', () => {
    it('treats a different current shape as applied', () => {
        expect(resolveAnswerOutcome({ answeredShapeId: 'a', currentShapeId: 'b', attempts: 1 })).toBe('applied');
    });

    it('treats no current glyph (204) as applied', () => {
        expect(resolveAnswerOutcome({ answeredShapeId: 'a', currentShapeId: null, attempts: 1 })).toBe('applied');
    });

    it('treats a 409 as applied because the queue moved on', () => {
        expect(resolveAnswerOutcome({ answeredShapeId: 'a', currentShapeId: 'a', attempts: 1, status: 409 })).toBe('applied');
    });

    it('resends once when the same shape is still current after a network failure', () => {
        expect(resolveAnswerOutcome({ answeredShapeId: 'a', currentShapeId: 'a', attempts: 1 })).toBe('resend');
    });

    it('gives up after the automatic resend also failed', () => {
        expect(resolveAnswerOutcome({ answeredShapeId: 'a', currentShapeId: 'a', attempts: 2 })).toBe('give-up');
    });

    it('waits for the refetch when the current shape is unknown', () => {
        expect(resolveAnswerOutcome({ answeredShapeId: 'a', currentShapeId: undefined, attempts: 1 })).toBe('give-up');
    });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/apps/legacy/features/subtitleOcr/utils/glyphAnswer.test.ts`
Expected: FAIL with "Failed to resolve import './glyphAnswer'".

- [ ] **Step 3: Implement the decision helper**

`src/apps/legacy/features/subtitleOcr/utils/glyphAnswer.ts`:

```ts
export type AnswerOutcome = 'applied' | 'resend' | 'give-up';

interface ResolveArgs {
    /** Shape id the user answered. */
    answeredShapeId: string;
    /** Shape id the server serves now: a string, null for "no question" (204), undefined when unknown. */
    currentShapeId: string | null | undefined;
    /** How many times the answer has been sent so far, including the failed one. */
    attempts: number;
    /** HTTP status of the failure, when there was a response. */
    status?: number;
}

/**
 * After a failed answer request, decides what to do from the glyph the server serves now.
 * The server always serves the head of its queue, so a different or absent shape means the
 * answer was applied. The same shape means it was not; resend once, then hand control back
 * to the user with a Retry button.
 */
export const resolveAnswerOutcome = ({ answeredShapeId, currentShapeId, attempts, status }: ResolveArgs): AnswerOutcome => {
    if (status === 409) return 'applied';
    if (currentShapeId === null) return 'applied';
    if (currentShapeId === undefined) return 'give-up';
    if (currentShapeId !== answeredShapeId) return 'applied';
    return attempts < 2 ? 'resend' : 'give-up';
};
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/apps/legacy/features/subtitleOcr/utils/glyphAnswer.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 5: Write the image and prompt components**

`src/apps/legacy/features/subtitleOcr/components/GlyphImage.tsx`:

```tsx
import Box from '@mui/material/Box';
import React, { type FC, useEffect, useRef } from 'react';

import type { GlyphQuestion } from '../types';

interface GlyphImageProps {
    question: GlyphQuestion;
}

/** The cue bitmap with a rectangle around the unknown letter, scaled to the container width. */
const GlyphImage: FC<GlyphImageProps> = ({ question }) => {
    const canvasRef = useRef<HTMLCanvasElement>(null);

    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;

        const image = new Image();
        image.onload = () => {
            canvas.width = image.width;
            canvas.height = image.height;
            const context = canvas.getContext('2d');
            if (!context) return;
            context.drawImage(image, 0, 0);
            context.lineWidth = Math.max(2, Math.round(image.width / 300));
            context.strokeStyle = '#ff5252';
            context.strokeRect(question.Left - 2, question.Top - 2, question.Width + 4, question.Height + 4);
        };
        image.src = `data:image/png;base64,${question.CuePngBase64}`;
    }, [ question ]);

    return (
        <Box sx={{ bgcolor: '#000', borderRadius: 1, p: 1 }}>
            <canvas ref={canvasRef} style={{ width: '100%', height: 'auto', display: 'block' }} />
        </Box>
    );
};

export default GlyphImage;
```

`src/apps/legacy/features/subtitleOcr/components/GlyphPrompt.tsx`:

```tsx
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Checkbox from '@mui/material/Checkbox';
import FormControlLabel from '@mui/material/FormControlLabel';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import React, { type FC, type FormEvent, useCallback, useEffect, useRef, useState } from 'react';

import layoutManager from 'components/layoutManager';
import globalize from 'lib/globalize';

import type { GlyphAnswer, GlyphQuestion } from '../types';
import GlyphImage from './GlyphImage';

interface GlyphPromptProps {
    question: GlyphQuestion;
    onAnswer: (answer: GlyphAnswer) => void;
    isSubmitting: boolean;
    /** Set when an answer failed twice; shows a Retry button that resends it. */
    pendingRetry?: GlyphAnswer;
    onRetry: () => void;
}

const GlyphPrompt: FC<GlyphPromptProps> = ({ question, onAnswer, isSubmitting, pendingRetry, onRetry }) => {
    const [ text, setText ] = useState('');
    const [ italic, setItalic ] = useState(false);
    const inputRef = useRef<HTMLInputElement>(null);
    const useHardwareKeyboardFocus = !layoutManager.mobile;

    // New question: clear the field and, off touch layouts, focus it.
    useEffect(() => {
        setText('');
        if (useHardwareKeyboardFocus) {
            inputRef.current?.focus();
        }
    }, [ question.ShapeId, useHardwareKeyboardFocus ]);

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
        if (!value || isSubmitting) return;
        onAnswer({ ShapeId: question.ShapeId, Text: value, Italic: italic, Skip: false });
    }, [ isSubmitting, italic, onAnswer, question.ShapeId ]);

    const onSubmit = useCallback((event: FormEvent) => {
        event.preventDefault();
        submit(text);
    }, [ submit, text ]);

    const skip = useCallback(() => {
        if (isSubmitting) return;
        onAnswer({ ShapeId: question.ShapeId, Text: null, Italic: false, Skip: true });
    }, [ isSubmitting, onAnswer, question.ShapeId ]);

    return (
        <Stack spacing={2}>
            <Stack direction='row' justifyContent='space-between' alignItems='baseline'>
                <Typography variant='h2' component='h2'>{globalize.translate('SubtitleOcrUnknownLetter')}</Typography>
                <Typography variant='body2'>{globalize.translate('SubtitleOcrRemaining', question.Remaining)}</Typography>
            </Stack>

            <GlyphImage question={question} />

            <Stack direction='row' spacing={2} alignItems='center'>
                <Box sx={{ bgcolor: '#000', borderRadius: 1, p: 1, lineHeight: 0 }}>
                    <img
                        alt=''
                        src={`data:image/png;base64,${question.LetterPngBase64}`}
                        style={{ height: 96, imageRendering: 'pixelated' }}
                    />
                </Box>
                <Typography variant='body2'>{globalize.translate('SubtitleOcrOccurrences', question.Occurrences)}</Typography>
            </Stack>

            {question.Candidates.length > 0 && (
                <Stack direction='row' spacing={1} flexWrap='wrap' useFlexGap>
                    {question.Candidates.map(candidate => (
                        <Button
                            key={candidate}
                            variant='outlined'
                            size='large'
                            disabled={isSubmitting}
                            onClick={() => submit(candidate)}
                            sx={{ minWidth: 56, fontSize: '1.25rem', fontStyle: italic ? 'italic' : 'normal' }}
                        >
                            {candidate}
                        </Button>
                    ))}
                </Stack>
            )}

            <form onSubmit={onSubmit}>
                <Stack direction='row' spacing={1} alignItems='center'>
                    <TextField
                        inputRef={inputRef}
                        label={globalize.translate('SubtitleOcrTypeLetter')}
                        value={text}
                        onChange={e => setText(e.target.value)}
                        size='small'
                        autoComplete='off'
                        slotProps={{ htmlInput: { autoCapitalize: 'none', spellCheck: false } }}
                        sx={{ flexGrow: 1 }}
                    />
                    <FormControlLabel
                        control={<Checkbox checked={italic} onChange={e => setItalic(e.target.checked)} />}
                        label={globalize.translate('SubtitleOcrItalic')}
                    />
                    <Button type='submit' variant='contained' disabled={!text || isSubmitting}>
                        {globalize.translate('ButtonOk')}
                    </Button>
                    <Button onClick={skip} disabled={isSubmitting}>{globalize.translate('SubtitleOcrSkip')}</Button>
                </Stack>
            </form>

            {pendingRetry && (
                <Alert
                    severity='error'
                    action={<Button color='inherit' size='small' onClick={onRetry}>{globalize.translate('SubtitleOcrRetry')}</Button>}
                >
                    {globalize.translate('MessageUnableToConnectToServer')}
                </Alert>
            )}
        </Stack>
    );
};

export default GlyphPrompt;
```

- [ ] **Step 6: Wire the glyph phase into the page**

In `src/apps/legacy/routes/subtitleOcr.tsx`:

Add imports:

```tsx
import { useAnswerGlyph } from 'apps/legacy/features/subtitleOcr/api/useAnswerGlyph';
import { useGlyph } from 'apps/legacy/features/subtitleOcr/api/useGlyph';
import { statusOf } from 'apps/legacy/features/subtitleOcr/api/request';
import GlyphPrompt from 'apps/legacy/features/subtitleOcr/components/GlyphPrompt';
import type { EligibleTrack, GlyphAnswer } from 'apps/legacy/features/subtitleOcr/types';
import { resolveAnswerOutcome } from 'apps/legacy/features/subtitleOcr/utils/glyphAnswer';
```

After the `useJob` line add:

```tsx
    const isGlyphPhase = job?.State === 'AwaitingGlyph';
    const glyph = useGlyph(jobId, isGlyphPhase);
    const answerGlyph = useAnswerGlyph(jobId);
    const [ pendingRetry, setPendingRetry ] = useState<GlyphAnswer>();

    const sendAnswer = useCallback((answer: GlyphAnswer, attempts: number) => {
        answerGlyph.mutate(answer, {
            onSuccess: () => setPendingRetry(undefined),
            onError: async error => {
                const status = statusOf(error);
                const refreshed = await glyph.refetch();
                const outcome = resolveAnswerOutcome({
                    answeredShapeId: answer.ShapeId,
                    currentShapeId: refreshed.data === undefined ? undefined : refreshed.data?.ShapeId ?? null,
                    attempts,
                    status
                });

                if (outcome === 'resend') {
                    sendAnswer(answer, attempts + 1);
                } else if (outcome === 'give-up') {
                    setPendingRetry(answer);
                } else {
                    setPendingRetry(undefined);
                }
            }
        });
    }, [ answerGlyph, glyph ]);

    const onAnswer = useCallback((answer: GlyphAnswer) => sendAnswer(answer, 1), [ sendAnswer ]);
    const onRetry = useCallback(() => {
        if (pendingRetry) sendAnswer(pendingRetry, 1);
    }, [ pendingRetry, sendAnswer ]);
```

Add a `case 'glyph':` to the `switch (phase)`:

```tsx
        case 'glyph':
            content = glyph.data ? (
                <GlyphPrompt
                    question={glyph.data}
                    onAnswer={onAnswer}
                    isSubmitting={answerGlyph.isPending}
                    pendingRetry={pendingRetry}
                    onRetry={onRetry}
                />
            ) : (
                <Spinner />
            );
            break;
```

The `useAnswerGlyph` hook invalidates the glyph and job queries on settle, so after a successful answer the next question appears without an extra poll.

- [ ] **Step 7: Lint and type check**

Run: `npx eslint src/apps/legacy/routes/subtitleOcr.tsx src/apps/legacy/features/subtitleOcr && npm run build:check`
Expected: clean. If `useCallback` complains about the recursive `sendAnswer`, declare it with `useRef` holding the latest function: `const sendAnswerRef = useRef<(a: GlyphAnswer, n: number) => void>(); sendAnswerRef.current = sendAnswer;` and call `sendAnswerRef.current?.(answer, attempts + 1)` inside.

- [ ] **Step 8: Verify in the browser**

Run a conversion on the Bitmap movie whose PGS track uses a font outside the seeded set (the rig's `make_media.py` produces one; see the server plan Task 12).
Expected: after recognition, the glyph prompt shows the cue image with a red box around one letter, the enlarged letter, candidate buttons and a text field. On desktop the field has focus and typing a letter plus Enter moves to the next shape; tapping a candidate does the same; Skip advances without learning. The remaining counter decreases. In the browser's device emulation (touch), the field is not focused on load but pressing a key on the keyboard focuses it and types. When the queue empties the page returns to the progress card ("Checking spelling").

- [ ] **Step 9: Commit**

```bash
git add src/apps/legacy/routes/subtitleOcr.tsx src/apps/legacy/features/subtitleOcr
git commit -m "Add glyph prompt with keyboard entry and answer re-anchoring

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 9: Uncertainty prompt, auto-accept and completion

**Files:**
- Create: `src/apps/legacy/features/subtitleOcr/components/UncertaintyPrompt.tsx`
- Create: `src/apps/legacy/features/subtitleOcr/components/EditCard.tsx`
- Create: `src/apps/legacy/features/subtitleOcr/components/NameCard.tsx`
- Create: `src/apps/legacy/features/subtitleOcr/components/DiffText.tsx`
- Modify: `src/apps/legacy/routes/subtitleOcr.tsx`

**Interfaces:**
- Consumes: `useReview`, `useAccept` (Task 4), `splitReview`, `emptyAnswers`, `isReviewComplete`, `buildAcceptRequest`, `ReviewAnswers`, `EditDecision` (Task 3), `wordDiff`, `changedWords` (Task 2), `getItemQuery` from `hooks/useItem`, `queryClient`.
- Produces:
  - `DiffText({ original, corrected })` — renders `wordDiff` segments: removed as struck-through, added as highlighted.
  - `EditCard({ edit, cueText, decision, neverAsk, onDecide: (d: EditDecision) => void, onNeverAskChange: (v: boolean) => void })`
  - `NameCard({ name, cueText, decision?: boolean, onDecide: (isName: boolean) => void })`
  - `UncertaintyPrompt({ review, answers, onAnswersChange, onFinish, isFinishing, error?: string | null })`

- [ ] **Step 1: Write the presentational components**

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

`src/apps/legacy/features/subtitleOcr/components/EditCard.tsx`:

```tsx
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import Checkbox from '@mui/material/Checkbox';
import FormControlLabel from '@mui/material/FormControlLabel';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import React, { type FC } from 'react';

import globalize from 'lib/globalize';

import type { ReviewEdit } from '../types';
import type { EditDecision } from '../utils/review';
import DiffText from './DiffText';

interface EditCardProps {
    edit: ReviewEdit;
    decision?: EditDecision;
    neverAsk: boolean;
    onDecide: (decision: EditDecision) => void;
    onNeverAskChange: (value: boolean) => void;
}

const EditCard: FC<EditCardProps> = ({ edit, decision, neverAsk, onDecide, onNeverAskChange }) => (
    <Card variant='outlined'>
        <CardContent>
            <Stack spacing={1}>
                <Typography variant='body1'><DiffText original={edit.Original} corrected={edit.Corrected} /></Typography>
                {edit.Reason && <Typography variant='body2' color='text.secondary'>{edit.Reason}</Typography>}
                <Stack direction='row' spacing={1}>
                    <Button
                        variant={decision === 'accept' ? 'contained' : 'outlined'}
                        color='success'
                        onClick={() => onDecide('accept')}
                    >
                        {globalize.translate('SubtitleOcrAccept')}
                    </Button>
                    <Button
                        variant={decision === 'reject' ? 'contained' : 'outlined'}
                        color='error'
                        onClick={() => onDecide('reject')}
                    >
                        {globalize.translate('SubtitleOcrReject')}
                    </Button>
                </Stack>
                {decision === 'reject' && (
                    <FormControlLabel
                        control={<Checkbox checked={neverAsk} onChange={e => onNeverAskChange(e.target.checked)} />}
                        label={globalize.translate('SubtitleOcrNeverAsk')}
                    />
                )}
            </Stack>
        </CardContent>
    </Card>
);

export default EditCard;
```

`src/apps/legacy/features/subtitleOcr/components/NameCard.tsx`:

```tsx
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import React, { type FC } from 'react';

import globalize from 'lib/globalize';

import type { DetectedName } from '../types';

interface NameCardProps {
    name: DetectedName;
    cueText?: string;
    decision?: boolean;
    onDecide: (isName: boolean) => void;
}

const NameCard: FC<NameCardProps> = ({ name, cueText, decision, onDecide }) => (
    <Card variant='outlined'>
        <CardContent>
            <Stack spacing={1}>
                <Typography variant='h3' component='p'>{name.Name}</Typography>
                {cueText && <Typography variant='body2' color='text.secondary' sx={{ whiteSpace: 'pre-wrap' }}>{cueText}</Typography>}
                <Stack direction='row' spacing={1}>
                    <Button
                        variant={decision === true ? 'contained' : 'outlined'}
                        color='success'
                        onClick={() => onDecide(true)}
                    >
                        {globalize.translate('SubtitleOcrIsName')}
                    </Button>
                    <Button
                        variant={decision === false ? 'contained' : 'outlined'}
                        color='error'
                        onClick={() => onDecide(false)}
                    >
                        {globalize.translate('SubtitleOcrNotName')}
                    </Button>
                </Stack>
            </Stack>
        </CardContent>
    </Card>
);

export default NameCard;
```

`src/apps/legacy/features/subtitleOcr/components/UncertaintyPrompt.tsx`:

```tsx
import Alert from '@mui/material/Alert';
import Button from '@mui/material/Button';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import React, { type FC, useCallback, useMemo } from 'react';

import globalize from 'lib/globalize';

import type { Review } from '../types';
import { type EditDecision, type ReviewAnswers, isReviewComplete, splitReview } from '../utils/review';
import { changedWords } from '../utils/wordDiff';
import EditCard from './EditCard';
import NameCard from './NameCard';

interface UncertaintyPromptProps {
    review: Review;
    answers: ReviewAnswers;
    onAnswersChange: (answers: ReviewAnswers) => void;
    onFinish: () => void;
    isFinishing: boolean;
    /** Error from a failed Accept; answers are kept so the user can retry. */
    error?: string | null;
}

type PromptCard =
    | { kind: 'edit'; cueIndex: number; id: number }
    | { kind: 'name'; cueIndex: number; name: string };

const UncertaintyPrompt: FC<UncertaintyPromptProps> = ({ review, answers, onAnswersChange, onFinish, isFinishing, error }) => {
    const split = useMemo(() => splitReview(review), [ review ]);
    const cueText = useMemo(() => new Map(review.Cues.map(c => [ c.Index, c.Text ])), [ review.Cues ]);
    const editById = useMemo(() => new Map(split.uncertainEdits.map(e => [ e.Id, e ])), [ split.uncertainEdits ]);
    const nameByName = useMemo(() => new Map(split.uncertainNames.map(n => [ n.Name, n ])), [ split.uncertainNames ]);

    // Server order: by cue index, edits before names on the same cue.
    const cards = useMemo<PromptCard[]>(() => [
        ...split.uncertainEdits.map(e => ({ kind: 'edit' as const, cueIndex: e.CueIndex, id: e.Id })),
        ...split.uncertainNames.map(n => ({ kind: 'name' as const, cueIndex: n.CueIndex, name: n.Name }))
    ].sort((a, b) => a.cueIndex - b.cueIndex || (a.kind === 'edit' ? -1 : 1)), [ split ]);

    const decideEdit = useCallback((id: number, decision: EditDecision) => {
        const edit = editById.get(id);
        const next: ReviewAnswers = {
            ...answers,
            edits: { ...answers.edits, [id]: decision },
            neverAsk: { ...answers.neverAsk }
        };
        if (decision === 'reject' && next.neverAsk[id] === undefined && edit) {
            // Default on when exactly one word changed: that is the moment the user knows the word was fine.
            next.neverAsk[id] = changedWords(edit.Original, edit.Corrected).length === 1;
        }
        onAnswersChange(next);
    }, [ answers, editById, onAnswersChange ]);

    const setNeverAsk = useCallback((id: number, value: boolean) => {
        onAnswersChange({ ...answers, neverAsk: { ...answers.neverAsk, [id]: value } });
    }, [ answers, onAnswersChange ]);

    const decideName = useCallback((name: string, isName: boolean) => {
        onAnswersChange({ ...answers, names: { ...answers.names, [name]: isName } });
    }, [ answers, onAnswersChange ]);

    return (
        <Stack spacing={2}>
            <Typography variant='h2' component='h2'>{globalize.translate('SubtitleOcrReviewTitle')}</Typography>
            {review.CorrectorError && <Alert severity='warning'>{review.CorrectorError}</Alert>}
            {cards.map(card => (card.kind === 'edit' ? (
                <EditCard
                    key={`edit-${card.id}`}
                    edit={editById.get(card.id)!}
                    decision={answers.edits[card.id]}
                    neverAsk={answers.neverAsk[card.id] === true}
                    onDecide={decision => decideEdit(card.id, decision)}
                    onNeverAskChange={value => setNeverAsk(card.id, value)}
                />
            ) : (
                <NameCard
                    key={`name-${card.name}`}
                    name={nameByName.get(card.name)!}
                    cueText={cueText.get(card.cueIndex)}
                    decision={answers.names[card.name]}
                    onDecide={isName => decideName(card.name, isName)}
                />
            )))}
            {error && <Alert severity='error'>{error}</Alert>}
            <Stack direction='row' justifyContent='flex-end'>
                <Button
                    variant='contained'
                    disabled={!isReviewComplete(split, answers) || isFinishing}
                    onClick={onFinish}
                >
                    {globalize.translate(error ? 'SubtitleOcrRetry' : 'SubtitleOcrFinish')}
                </Button>
            </Stack>
        </Stack>
    );
};

export default UncertaintyPrompt;
```

- [ ] **Step 2: Wire review, auto-accept and completion into the page**

In `src/apps/legacy/routes/subtitleOcr.tsx` add imports:

```tsx
import { useAccept } from 'apps/legacy/features/subtitleOcr/api/useAccept';
import { useReview } from 'apps/legacy/features/subtitleOcr/api/useReview';
import UncertaintyPrompt from 'apps/legacy/features/subtitleOcr/components/UncertaintyPrompt';
import { buildAcceptRequest, emptyAnswers, type ReviewAnswers, splitReview } from 'apps/legacy/features/subtitleOcr/utils/review';
import { getItemQuery } from 'hooks/useItem';
import { queryClient } from 'utils/query/queryClient';
```

After the glyph block add:

```tsx
    const isReviewPhase = job?.State === 'AwaitingReview';
    const review = useReview(jobId, isReviewPhase);
    const accept = useAccept(jobId);
    const [ answers, setAnswers ] = useState<ReviewAnswers>(emptyAnswers);
    const split = useMemo(() => (review.data ? splitReview(review.data) : undefined), [ review.data ]);

    const finish = useCallback(() => {
        if (!split || accept.isPending) return;
        accept.mutate(buildAcceptRequest(split, answers));
    }, [ accept, answers, split ]);

    // Nothing uncertain: accept without showing a review.
    const autoAccepted = useRef<string>();
    useEffect(() => {
        if (isReviewPhase && split?.autoAccept && jobId && autoAccepted.current !== jobId && !accept.isPending && !accept.isError) {
            autoAccepted.current = jobId;
            if (review.data?.CorrectorError) {
                toast(review.data.CorrectorError);
            }
            finish();
        }
    }, [ accept.isError, accept.isPending, finish, isReviewPhase, jobId, review.data?.CorrectorError, split?.autoAccept ]);

    // Done: tell the user, refresh the item and return to a freshly loaded details page.
    const completed = useRef<string>();
    useEffect(() => {
        if (job?.State !== 'Done' || !jobId || completed.current === jobId) return;
        completed.current = jobId;
        toast(globalize.translate('SubtitleOcrSaved', accept.data?.SavedCues ?? job.CuesTotal));
        void queryClient.invalidateQueries({ queryKey: getItemQuery(undefined, itemId, user?.Id).queryKey });
        const params = new URLSearchParams({ id: itemId || '', serverId: serverId || '' });
        navigate(`/details?${params.toString()}`, { replace: true });
    }, [ accept.data?.SavedCues, itemId, job, jobId, navigate, serverId, user?.Id ]);
```

(`serverId` comes from `useSubtitleOcrParams`; add it back to the destructuring.)

Add the `case 'review':` to the switch:

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
                    <UncertaintyPrompt
                        review={review.data}
                        answers={answers}
                        onAnswersChange={setAnswers}
                        onFinish={finish}
                        isFinishing={accept.isPending}
                        error={accept.isError ? String((accept.error as Error)?.message || accept.error) : null}
                    />
                );
            }
            break;
```

The `done` phase renders `<Spinner />` (the effect above navigates away).

- [ ] **Step 3: Lint and type check**

Run: `npx eslint src/apps/legacy/routes/subtitleOcr.tsx src/apps/legacy/features/subtitleOcr && npm run build:check`
Expected: clean.

- [ ] **Step 4: Verify in the browser**

Two runs on the rig server:

1. With the Gemini key configured and a disc that yields uncertain items: after glyphs, the "Please check these" list appears with edit cards (struck-through and highlighted words, reason, Accept and Reject; Reject reveals the never-ask checkbox, checked when one word changed) and name cards. Finish stays disabled until every card has an answer. Finishing shows a "Subtitles saved (N cues)" toast, lands on the details page reloaded, where the convert button is gone and the subtitle selector lists the new external SRT.
2. With `SubtitleOcrCorrectorEnabled` false on the server (so the review has zero edits and names): after glyphs, the card shows "Saving" briefly and then the toast and details page, with no review shown.

- [ ] **Step 5: Commit**

```bash
git add src/apps/legacy/routes/subtitleOcr.tsx src/apps/legacy/features/subtitleOcr
git commit -m "Add uncertainty review with auto-accept for subtitle OCR

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
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
2. Delete the cached `.sup` under the rig server's subtitle cache while a job waits for glyphs, then restart the server: the page shows the failure card with the server's message and Retry starts a new job that extracts again.
3. Start a job, note the URL, stop the server, delete `<data>/subtitle-ocr/jobs/<jobId>.json`, start the server, reload the page URL: the page drops `jobId` and starts a fresh job automatically.

- [ ] **Step 8: Commit**

```bash
git add src/apps/legacy/routes/subtitleOcr.tsx src/apps/legacy/features/subtitleOcr
git commit -m "Handle failed and lost subtitle OCR jobs on the page

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 11: Full pass, phone viewport check and spec status

**Files:**
- Modify: `docs/superpowers/specs/2026-09-28-subtitle-ocr-page-design.md` (the `Status:` line)

- [ ] **Step 1: Run the whole test suite, lint and type check**

```bash
npm test
npx eslint src/apps/legacy/features/subtitleOcr src/apps/legacy/routes/subtitleOcr.tsx src/apps/legacy/controllers/itemDetails src/apps/legacy/routes/asyncRoutes src/apps/modern/routes/asyncRoutes
npm run build:check
npm run build:production
```

Expected: all tests pass, no lint output, tsc and the production build succeed.

- [ ] **Step 2: Phone-sized manual pass**

In the browser's device emulation at 390 × 844 with touch enabled, run the full flow from the details page button through glyphs and the uncertainty list to the toast and reloaded details page.
Expected: no horizontal scrolling; the cue image fits the width; candidate buttons wrap; the text field is not focused on load; the Finish button is reachable below the last card. Repeat once at desktop width.

- [ ] **Step 3: Android app pass**

Open the rig server from the Android app (the WebView loads this build once the server's web directory points at `dist/`; see the server rig note in the spec's Testing section). Run the flow once on a movie with a PGS track.
Expected: same behaviour as the phone emulation; the hardware back button while a job runs shows the leave confirmation.

- [ ] **Step 4: Update the spec status and commit**

Change the spec's `Status:` line to `Status: implemented on branch feature/subtitle-ocr-page`.

```bash
git add docs/superpowers/specs/2026-09-28-subtitle-ocr-page-design.md
git commit -m "Mark subtitle OCR page spec as implemented

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```
