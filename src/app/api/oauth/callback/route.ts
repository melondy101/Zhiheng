// CloudBase URL already registered with Zhihu before the route was namespaced.
// Keep this compatibility entrypoint delegating to the single OAuth handler.
export { GET } from '../../auth/zhihu/callback/route';
export const runtime = 'nodejs';
