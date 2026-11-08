/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // exceljs and nodemailer are Node-only; keep them out of the bundler.
  serverExternalPackages: ["exceljs", "nodemailer"],
};

export default nextConfig;
