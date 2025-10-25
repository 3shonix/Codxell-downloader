
// app/api/youtube/download/route.js
import { NextResponse } from 'next/server';

export async function POST(request) {
  try {
    const { videoId, format } = await request.json();

    if (!videoId || !format) {
      return NextResponse.json(
        { error: 'Video ID and format are required' },
        { status: 400 }
      );
    }

    if (!['mp3', 'mp4'].includes(format)) {
      return NextResponse.json(
        { error: 'Invalid format' },
        { status: 400 }
      );
    }

    let downloadUrl;

    if (format === 'mp4') {
      // Download MP4 using yt-api
      downloadUrl = `https://yt-api.vercel.app/download?videoId=${videoId}&quality=highest`;
    } else {
      // Download MP3 using yt-api
      downloadUrl = `https://yt-api.vercel.app/download?videoId=${videoId}&quality=audio`;
    }

    const contentResponse = await fetch(downloadUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      },
    });

    if (!contentResponse.ok) {
      // Try alternative service
      const altUrl = `https://youtubeshortsdownloader.com/api/download?videoUrl=https://www.youtube.com/watch?v=${videoId}`;
      const altResponse = await fetch(altUrl);

      if (!altResponse.ok) {
        throw new Error('Download service unavailable');
      }

      const altData = await altResponse.json();
      const finalUrl = format === 'mp4' ? altData.videoUrl : altData.audioUrl;

      if (!finalUrl) {
        throw new Error(`${format.toUpperCase()} not available`);
      }

      const finalResponse = await fetch(finalUrl);
      const buffer = await finalResponse.arrayBuffer();

      return new NextResponse(buffer, {
        headers: {
          'Content-Type': format === 'mp3' ? 'audio/mpeg' : 'video/mp4',
          'Content-Disposition': `attachment; filename="video_${videoId}.${format}"`,
          'Content-Length': buffer.byteLength,
        },
      });
    }

    const buffer = await contentResponse.arrayBuffer();

    return new NextResponse(buffer, {
      headers: {
        'Content-Type': format === 'mp3' ? 'audio/mpeg' : 'video/mp4',
        'Content-Disposition': `attachment; filename="video_${videoId}.${format}"`,
        'Content-Length': buffer.byteLength,
      },
    });
  } catch (error) {
    console.error('Download error:', error);
    return NextResponse.json(
      { error: `Download failed: ${error.message}. Please try again.` },
      { status: 500 }
    );
  }
}