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
