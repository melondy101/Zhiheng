/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Produces the self-contained server bundle consumed by Docker/CloudBase.
  // Vercel continues to use its native Next.js build output and vercel.json.
  output: 'standalone',
};

export default nextConfig;
