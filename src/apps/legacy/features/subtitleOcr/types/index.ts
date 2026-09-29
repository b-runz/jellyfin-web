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
