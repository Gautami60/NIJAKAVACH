/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  transpilePackages: [
    "@nijakavach/contracts",
    "@nijakavach/shared-types",
    "@nijakavach/validation"
  ]
};

module.exports = nextConfig;
