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
};

module.exports = nextConfig;