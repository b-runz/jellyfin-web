import Alert from '@mui/material/Alert';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import LinearProgress from '@mui/material/LinearProgress';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import React, { type FC } from 'react';

import globalize from 'lib/globalize';

import type { OcrJob } from '../types';
import { progressLabelKey } from '../utils/phase';
import PageMessage from './PageMessage';

interface JobProgressProps {
    job?: OcrJob;
    /** True while the last poll failed and the page keeps trying. */
    isReconnecting: boolean;
    /** Overrides the label derived from the job state, used for "Saving" during accept. */
    labelKeyOverride?: string;
    onCancel: () => void;
    isCancelling: boolean;
}

const JobProgress: FC<JobProgressProps> = ({ job, isReconnecting, labelKeyOverride, onCancel, isCancelling }) => {
    const labelKey = labelKeyOverride || (job ? progressLabelKey(job.State, job.Stage) : 'SubtitleOcrExtracting');
    const showBar = !!job && job.Total > 0;
    const percent = showBar ? Math.round((job.Done / job.Total) * 100) : 0;

    return (
        <PageMessage title={globalize.translate('SubtitleOcrTitle')}>
            <Stack spacing={2} sx={{ width: '100%' }}>
                <Stack direction='row' spacing={1} alignItems='center'>
                    <Typography variant='body1'>{globalize.translate(labelKey)}</Typography>
                    {isReconnecting && <Chip size='small' color='warning' label={globalize.translate('SubtitleOcrReconnecting')} />}
                </Stack>
                {showBar ? (
                    <LinearProgress variant='determinate' value={percent} />
                ) : (
                    <LinearProgress variant='indeterminate' />
                )}
                {showBar && (
                    <Typography variant='body2'>{job.Done} / {job.Total}</Typography>
                )}
                {job?.Warning && <Alert severity='warning'>{job.Warning}</Alert>}
                <Stack direction='row' justifyContent='flex-end'>
                    <Button color='error' onClick={onCancel} disabled={isCancelling}>
                        {globalize.translate('SubtitleOcrCancelConversion')}
                    </Button>
                </Stack>
            </Stack>
        </PageMessage>
    );
};

export default JobProgress;
