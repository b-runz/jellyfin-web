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
        cancelCurrentJob().then(goBack).catch(() => { /* no-op: cancelCurrentJob already swallows errors */ });
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
