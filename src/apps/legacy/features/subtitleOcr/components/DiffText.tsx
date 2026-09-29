import Box from '@mui/material/Box';
import React, { type FC, useMemo } from 'react';

import { wordDiff } from '../utils/wordDiff';

interface DiffTextProps {
    original: string;
    corrected: string;
}

const DiffText: FC<DiffTextProps> = ({ original, corrected }) => {
    const segments = useMemo(() => wordDiff(original, corrected), [ original, corrected ]);

    return (
        <Box component='span' sx={{ whiteSpace: 'pre-wrap' }}>
            {segments.map((segment, index) => {
                const key = `${index}-${segment.kind}`;
                if (segment.kind === 'removed') {
                    return (
                        <Box key={key} component='del' sx={{ color: 'error.main', textDecorationColor: 'inherit' }}>
                            {segment.text}
                        </Box>
                    );
                }
                if (segment.kind === 'added') {
                    return (
                        <Box key={key} component='ins' sx={{ bgcolor: 'success.dark', color: 'success.contrastText', textDecoration: 'none', px: 0.25, borderRadius: 0.5, ml: 0.5 }}>
                            {segment.text}
                        </Box>
                    );
                }
                return <React.Fragment key={key}>{segment.text}</React.Fragment>;
            })}
        </Box>
    );
};

export default DiffText;
