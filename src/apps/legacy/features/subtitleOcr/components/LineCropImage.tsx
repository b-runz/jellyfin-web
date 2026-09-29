import Box from '@mui/material/Box';
import Skeleton from '@mui/material/Skeleton';
import React, { type FC, useEffect, useState } from 'react';

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
    const { data: blob, isError, isPending } = useCropImage(jobId, index);
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

    if (isPending) {
        return <Skeleton variant='rounded' height={64} />;
    }

    if (isError || !url) {
        return (
            <Box sx={{ bgcolor: 'action.disabledBackground', borderRadius: 1, p: 1 }}>
                {globalize.translate('SubtitleOcrCropLoadFailed')}
            </Box>
        );
    }

    return (
        <Box sx={{ bgcolor: '#000', borderRadius: 1, p: 1 }}>
            <img alt='' src={url} style={{ maxWidth: '100%', height: 'auto', display: 'block' }} />
        </Box>
    );
};

export default LineCropImage;
