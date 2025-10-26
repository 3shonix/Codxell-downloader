/** @type {import('next').NextConfig} */
const nextConfig = {
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "www.instagram.com",
        pathname: "/**",
      },
      {
        protocol: "https",
        hostname: "**.fbcdn.net", // Instagram CDN
        pathname: "/**",
      },
      {
        protocol: "https",
        hostname: "s.pinimg.com",
        pathname: "/**",
      },
      {
        protocol: "https",
        hostname: "i.ytimg.com",
        pathname: "/**",
      },
      {
        protocol: "https",
        hostname: "**.ytimg.com",
        pathname: "/**",
      },
    ],
  },

  // 👇 Add this for LAN/dev access
  experimental: {
    allowedDevOrigins: [
      "http://10.114.39.167:3000", // your LAN IP
      "http://localhost:3000",    // localhost
    ],
  },
};

module.exports = nextConfig;
