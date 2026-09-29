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
    split.uncertainLines.every(l => decisions[l.Index] != undefined);

export const buildAcceptRequest = (
    split: SplitReview,
    decisions: Record<number, string>,
    namesText: string
): AcceptRequest => ({
    Decisions: split.uncertainLines
        .filter(l => decisions[l.Index] != undefined)
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
