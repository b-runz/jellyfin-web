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
