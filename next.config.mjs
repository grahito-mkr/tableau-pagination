/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  experimental: {
    serverComponentsExternalPackages: ["pdfkit"],
    outputFileTracingIncludes: {
      "/api/**/*": ["./node_modules/pdfkit/js/data/**"]
    }
  }
};

export default nextConfig;
