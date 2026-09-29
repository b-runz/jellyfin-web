import { useEffect, useRef } from 'react';
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

    // `onLeave` is a new function identity on every render (it closes over a react-query
    // mutation result, which react-query itself recreates every render). Keeping the latest
    // value in a ref lets the effect below always call the freshest `onLeave` without needing
    // it in its dependency array, so an unrelated re-render while blocked cannot re-fire it.
    const onLeaveRef = useRef(onLeave);
    onLeaveRef.current = onLeave;

    useEffect(() => {
        if (blocker.state !== 'blocked') return;

        confirm({
            title: globalize.translate('SubtitleOcrTitle'),
            text: globalize.translate('SubtitleOcrLeaveConfirm'),
            confirmText: globalize.translate('SubtitleOcrCancelConversion'),
            primary: 'delete'
        }).then(async () => {
            await onLeaveRef.current();
            blocker.proceed();
        }).catch(() => {
            blocker.reset();
        });
    // `blocker` is only referentially new when the router's blocker state actually transitions
    // (react-router hands back the same object from its internal state map while blocked), so
    // this intentionally excludes `onLeave` to avoid re-opening the dialog on every re-render.
    }, [ blocker ]);
};
