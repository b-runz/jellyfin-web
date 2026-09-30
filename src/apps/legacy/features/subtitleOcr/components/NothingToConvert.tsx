import Button from '@mui/material/Button';
import React, { type FC } from 'react';

import globalize from 'lib/globalize';

import PageMessage from './PageMessage';

interface NothingToConvertProps {
    onBack: () => void;
}

const NothingToConvert: FC<NothingToConvertProps> = ({ onBack }) => (
    <PageMessage
        title={globalize.translate('SubtitleOcrTitle')}
        text={globalize.translate('SubtitleOcrNothingToConvert')}
    >
        <Button variant='contained' onClick={onBack}>{globalize.translate('ButtonBack')}</Button>
    </PageMessage>
);

export default NothingToConvert;
