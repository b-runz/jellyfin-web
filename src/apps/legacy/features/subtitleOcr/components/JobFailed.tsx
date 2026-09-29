import Button from '@mui/material/Button';
import React, { type FC } from 'react';

import globalize from 'lib/globalize';

import type { OcrJob } from '../types';
import PageMessage from './PageMessage';

interface JobFailedProps {
    job?: OcrJob;
    /** Message to show instead of the job's error, e.g. from a failed start. */
    message?: string | null;
    onRetry?: () => void;
    onBack: () => void;
    isRetrying: boolean;
}

const JobFailed: FC<JobFailedProps> = ({ job, message, onRetry, onBack, isRetrying }) => (
    <PageMessage
        title={globalize.translate('SubtitleOcrFailed')}
        text={message || job?.Error || globalize.translate('ErrorDefault')}
    >
        <Button onClick={onBack}>{globalize.translate('ButtonBack')}</Button>
        {onRetry && (
            <Button variant='contained' onClick={onRetry} disabled={isRetrying}>
                {globalize.translate('SubtitleOcrRetry')}
            </Button>
        )}
    </PageMessage>
);

export default JobFailed;
