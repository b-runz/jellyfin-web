import { AsyncRoute } from '../../../../components/router/AsyncRoute';

export const ASYNC_USER_ROUTES: AsyncRoute[] = [
    { path: 'mypreferencesmenu', page: 'user/settings' },
    { path: 'quickconnect', page: 'quickConnect' },
    { path: 'search', page: 'search' },
    { path: 'subtitleocr', page: 'subtitleOcr' },
    { path: 'userprofile', page: 'user/userprofile' }
];
