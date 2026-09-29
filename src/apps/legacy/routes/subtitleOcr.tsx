import CircularProgress from '@mui/material/CircularProgress';
import Container from '@mui/material/Container';
import React, { type FC, type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';

import { statusOf } from 'apps/legacy/features/subtitleOcr/api/request';
import { useAccept } from 'apps/legacy/features/subtitleOcr/api/useAccept';
import { useCancelJob } from 'apps/legacy/features/subtitleOcr/api/useCancelJob';
import { useJob } from 'apps/legacy/features/subtitleOcr/api/useJob';
import { useReview } from 'apps/legacy/features/subtitleOcr/api/useReview';
import { useStartJob } from 'apps/legacy/features/subtitleOcr/api/useStartJob';
import JobFailed from 'apps/legacy/features/subtitleOcr/components/JobFailed';
import JobProgress from 'apps/legacy/features/subtitleOcr/components/JobProgress';
import NothingToConvert from 'apps/legacy/features/subtitleOcr/components/NothingToConvert';
import ReviewTable from 'apps/legacy/features/subtitleOcr/components/ReviewTable';
import TrackPicker from 'apps/legacy/features/subtitleOcr/components/TrackPicker';
import { ITEM_ID_PARAM, JOB_ID_PARAM, SERVER_ID_PARAM } from 'apps/legacy/features/subtitleOcr/constants';
import { useLeaveGuard } from 'apps/legacy/features/subtitleOcr/hooks/useLeaveGuard';
import type { EligibleTrack, OcrJob } from 'apps/legacy/features/subtitleOcr/types';
import { eligibleTracks } from 'apps/legacy/features/subtitleOcr/utils/eligibleTracks';
import { nextStepAfterJobError, startErrorMessage } from 'apps/legacy/features/subtitleOcr/utils/errors';
import { type Phase, isJobActive, phaseFor } from 'apps/legacy/features/subtitleOcr/utils/phase';
import { buildAcceptRequest, type SplitReview, splitReview } from 'apps/legacy/features/subtitleOcr/utils/review';
import Page from 'components/Page';
import toast from 'components/toast/toast';
import { useApi } from 'hooks/useApi';
import { getItemQuery, useItem } from 'hooks/useItem';
import globalize from 'lib/globalize';
import { queryClient } from 'utils/query/queryClient';

const Spinner: FC = () => <CircularProgress sx={{ display: 'block', mx: 'auto', my: 4 }} />;

interface ContentArgs {
    startJob: ReturnType<typeof useStartJob>;
    cancelJob: ReturnType<typeof useCancelJob>;
    phase: Phase;
    tracks: EligibleTrack[];
    job?: OcrJob;
    isJobError: boolean;
    review: ReturnType<typeof useReview>;
    split?: SplitReview;
    jobId?: string;
    decisions: Record<number, string>;
    namesText: string;
    accept: ReturnType<typeof useAccept>;
    start: (track: EligibleTrack) => void;
    onDecide: (index: number, text: string) => void;
    onNamesTextChange: (text: string) => void;
    finish: () => void;
    onCancelClick: () => void;
    retry: () => void;
    goBack: () => void;
}

/** Picks the content for the current phase, short-circuiting to the failure view for a failed start. */
const resolveContent = ({
    startJob, cancelJob, phase, tracks, job, isJobError, review, split, jobId,
    decisions, namesText, accept, start, onDecide, onNamesTextChange, finish, onCancelClick, retry, goBack
// eslint-disable-next-line sonarjs/function-return-type -- genuinely returns a mix of JSX nodes across phases
}: ContentArgs): ReactNode => {
    if (startJob.isError) {
        return (
            <JobFailed
                message={globalize.translate(startErrorMessage(startJob.error))}
                onRetry={statusOf(startJob.error) === 404 ? undefined : retry}
                onBack={goBack}
                isRetrying={startJob.isPending}
            />
        );
    }

    switch (phase) {
        case 'nothing':
            return <NothingToConvert onBack={goBack} />;
        case 'pick':
            return <TrackPicker tracks={tracks} onSelect={start} disabled={startJob.isPending} />;
        case 'progress':
            return (
                <JobProgress
                    job={job}
                    isReconnecting={isJobError}
                    onCancel={onCancelClick}
                    isCancelling={cancelJob.isPending}
                />
            );
        case 'review':
            if (!review.data || !split) return <Spinner />;
            if (split.autoAccept) {
                // The server's target is fewer than 1-in-200 lines needing review, so this silent
                // auto-accept path is the common case: if the Accept call fails, show a retry
                // affordance instead of leaving an indefinite "Saving" spinner on screen. Retrying
                // re-posts the same empty-decisions Accept against the existing job; it does not
                // start a new job.
                if (accept.isError) {
                    return (
                        <JobFailed
                            job={job}
                            message={globalize.translate(startErrorMessage(accept.error))}
                            onRetry={finish}
                            onBack={goBack}
                            isRetrying={accept.isPending}
                        />
                    );
                }
                return (
                    <JobProgress
                        job={job}
                        isReconnecting={false}
                        labelKeyOverride='SubtitleOcrSaving'
                        onCancel={onCancelClick}
                        isCancelling={cancelJob.isPending}
                    />
                );
            }
            return (
                <ReviewTable
                    jobId={jobId!}
                    review={review.data}
                    decisions={decisions}
                    onDecide={onDecide}
                    namesText={namesText}
                    onNamesTextChange={onNamesTextChange}
                    onFinish={finish}
                    isFinishing={accept.isPending}
                    error={accept.isError ? globalize.translate(startErrorMessage(accept.error)) : null}
                />
            );
        case 'failed':
            return (
                <JobFailed
                    job={job}
                    onRetry={retry}
                    onBack={goBack}
                    isRetrying={startJob.isPending}
                />
            );
        default:
            // Covers 'loading' and 'done': for 'done', the completion effect navigates away
            // before this would ever render, so a spinner is shown only briefly, if at all.
            return <Spinner />;
    }
};

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
    const { itemId, serverId, jobId, setJobId } = useSubtitleOcrParams();
    const { data: item, isPending: isItemPending } = useItem(itemId);
    const tracks = useMemo(() => (item ? eligibleTracks(item) : []), [ item ]);

    const startJob = useStartJob();
    const cancelJob = useCancelJob();
    const { data: job, isError: isJobError, error: jobError } = useJob(jobId);

    // Declared here (rather than beside the effect that sets it, further down) because the
    // lost-job recovery effect immediately below also needs to reset it.
    const autoStarted = useRef(false);

    // The server no longer knows this job (restart discarded it): drop the id and let the normal start flow run.
    useEffect(() => {
        if (isJobError && nextStepAfterJobError(statusOf(jobError)) === 'restart') {
            autoStarted.current = false;
            setJobId();
        }
    }, [ isJobError, jobError, setJobId ]);

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

    const isAdmin = user?.Policy?.IsAdministrator === true;
    useEffect(() => {
        if (user && !isAdmin) {
            toast(globalize.translate('SubtitleOcrAdminRequired'));
            navigate('/home', { replace: true });
        }
    }, [ isAdmin, navigate, user ]);

    const goBack = useCallback(() => navigate(-1), [ navigate ]);

    // Remembers the last started track so Retry can reuse it without asking again.
    const lastTrack = useRef<EligibleTrack>();

    const start = useCallback((track: EligibleTrack) => {
        if (!itemId || startJob.isPending) return;
        lastTrack.current = track;
        // Clear any stale result from a previous job's auto-accept, so this job's own
        // auto-accept effect (below) is not blocked by an error that belongs to a job that
        // is no longer mounted.
        accept.reset();
        // Clear decisions and names left over from a previous job (e.g. Retry, or the 404
        // auto-restart), so a new job with zero uncertain lines sends an empty Names array on
        // auto-accept instead of a stale list from the job before it.
        setDecisions({});
        setNamesText('');
        startJob.mutate({
            ItemId: itemId,
            MediaSourceId: track.mediaSourceId,
            StreamIndex: track.streamIndex
        }, {
            onSuccess: started => setJobId(started.Id)
        });
    }, [ accept, itemId, setJobId, startJob, setDecisions, setNamesText ]);

    // Exactly one eligible track: start without asking.
    useEffect(() => {
        if (!jobId && tracks.length === 1 && !autoStarted.current && user && isAdmin) {
            autoStarted.current = true;
            start(tracks[0]);
        }
    }, [ isAdmin, jobId, start, tracks, user ]);

    // Starts a fresh job for the same track after a failure, since the old job is terminal
    // (or, on a 404, already gone).
    const retry = useCallback(() => {
        const track = lastTrack.current || tracks.find(t => t.mediaSourceId === job?.MediaSourceId && t.streamIndex === job?.StreamIndex) || tracks[0];
        if (!track) return;
        setJobId();
        startJob.reset();
        start(track);
    }, [ job?.MediaSourceId, job?.StreamIndex, setJobId, start, startJob, tracks ]);

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
        cancelCurrentJob().then(goBack).catch(() => { /* no-op: cancelCurrentJob already swallows errors */ });
    }, [ cancelCurrentJob, goBack ]);

    useLeaveGuard(!!jobId && isJobActive(job?.State) && !isLeaving, cancelCurrentJob);

    const phase = phaseFor({ hasJobId: !!jobId, job, trackCount: tracks.length, itemLoaded: !!user && !isItemPending && !!item });

    const content = resolveContent({
        startJob,
        cancelJob,
        phase,
        tracks,
        job,
        isJobError,
        review,
        split,
        jobId,
        decisions,
        namesText,
        accept,
        start,
        onDecide,
        onNamesTextChange: setNamesText,
        finish,
        onCancelClick,
        retry,
        goBack
    });

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
