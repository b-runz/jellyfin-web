import RefreshIcon from '@mui/icons-material/Refresh';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Skeleton from '@mui/material/Skeleton';
import Stack from '@mui/material/Stack';
import React, { type FC, useCallback, useEffect, useState } from 'react';

import globalize from 'lib/globalize';

import { useCropImage } from '../api/useCropImage';

interface LineCropImageProps {
    jobId: string;
    index: number;
}

/**
 * Shows one line's crop image. `GET /Jobs/{id}/Crops/{index}` is admin-gated and returns raw PNG, so
 * it is fetched as an authenticated binary request (`useCropImage`) and shown through an object URL,
 * not a bare `<img src>`, which would carry no `Authorization` header and 401. The object URL is
 * revoked whenever the underlying blob changes or the component unmounts.
 */
const LineCropImage: FC<LineCropImageProps> = ({ jobId, index }) => {
    const { data: blob, isError, isPending, refetch } = useCropImage(jobId, index);
    const [ url, setUrl ] = useState<string>();

    useEffect(() => {
        if (!blob) {
            setUrl(undefined);
            return;
        }

        const objectUrl = URL.createObjectURL(blob);
        setUrl(objectUrl);
        return () => URL.revokeObjectURL(objectUrl);
    }, [ blob ]);

    const onRetryClick = useCallback(() => {
        refetch().catch(() => undefined);
    }, [ refetch ]);

    if (isError) {
        return (
            <Box sx={{ bgcolor: 'action.disabledBackground', borderRadius: 1, p: 1 }}>
                <Stack direction='row' spacing={1} alignItems='center' justifyContent='space-between'>
                    {globalize.translate('SubtitleOcrCropLoadFailed')}
                    <Button size='small' startIcon={<RefreshIcon />} onClick={onRetryClick}>
                        {globalize.translate('SubtitleOcrRetry')}
                    </Button>
                </Stack>
            </Box>
        );
    }

    // Pending, or the blob just arrived but the object-URL-creation effect above has not run
    // yet: both are still "loading", not an error, so neither falls into the branch above.
    if (isPending || !url) {
        return <Skeleton variant='rounded' height={64} />;
    }

    return (
        <Box sx={{ bgcolor: '#000', borderRadius: 1, p: 1 }}>
            <img alt='' src={url} style={{ maxWidth: '100%', height: 'auto', display: 'block' }} />
        </Box>
    );
};

export default LineCropImage;
