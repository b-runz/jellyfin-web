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
