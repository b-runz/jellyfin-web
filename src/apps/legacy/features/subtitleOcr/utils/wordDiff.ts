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
    // eslint-disable-next-line sonarjs/slow-regex
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
        } else if (j < b.length && (i >= a.length || table[i][j + 1] > table[i + 1][j])) {
            // Emit whitespace before the first changed word as unchanged, then the added word. Skip it
            // when continuing a run that already emitted its leading whitespace via a removed word.
            if (segments.length === 0 || segments[segments.length - 1].kind === 'same') {
                push(segments, b[j].leading, 'same');
            }
            pushChanged(segments, b[j].word, 'added');
            j++;
        } else {
            // Mirrors the added-branch guard: only emit leading whitespace when starting a fresh run, not
            // when continuing a removed run that has run past the end of the corrected text.
            if (segments.length === 0 || segments[segments.length - 1].kind === 'same') {
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

// Matches ASCII letters/digits plus the Latin-1 Supplement / Latin Extended-A/B ranges (covers Danish
// æ/ø/å and other Latin-diacritic letters) so punctuation can be stripped without the `u` flag, which
// TypeScript disallows when compiling against the ES5 target this repo uses.
// eslint-disable-next-line sonarjs/slow-regex
const stripPunctuation = (word: string) => word.replace(/^[^a-zA-Z0-9À-ɏ]+|[^a-zA-Z0-9À-ɏ]+$/g, '');

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
