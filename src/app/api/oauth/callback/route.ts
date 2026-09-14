// Backward-compatible alias for deployments that registered /api/oauth/callback
// before the Zhihu-specific route was namespaced under /api/auth/zhihu.
export { GET } from '../../auth/zhihu/callback/route';
export const runtime = 'nodejs';
