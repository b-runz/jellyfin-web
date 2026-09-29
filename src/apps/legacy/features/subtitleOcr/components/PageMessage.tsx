import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import React, { type FC, type PropsWithChildren } from 'react';

interface PageMessageProps {
    title: string;
    text?: string | null;
}

/** Centred card for terminal and waiting views. Children render as the action row. */
const PageMessage: FC<PropsWithChildren<PageMessageProps>> = ({ title, text, children }) => (
    <Card sx={{ maxWidth: 560, mx: 'auto', my: 2 }}>
        <CardContent>
            <Stack spacing={2}>
                <Typography variant='h2' component='h2'>{title}</Typography>
                {text && <Typography variant='body1'>{text}</Typography>}
                {children && <Stack direction='row' spacing={1} justifyContent='flex-end'>{children}</Stack>}
            </Stack>
        </CardContent>
    </Card>
);

export default PageMessage;
