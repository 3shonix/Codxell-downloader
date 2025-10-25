import { NextResponse } from 'next/server';

export async function POST(request) {
  try {
    const { videoId } = await request.json();

    if (!videoId) {
      return NextResponse.json(
        { error: 'Video ID is required' },
        { status: 400 }
      );
    }

    const url = `https://www.youtube.com/watch?v=${videoId}`;

    // Fetch from Invidious API for complete info
    const response = await fetch(
      `https://invidious.jotunder.com/api/v1/videos/${videoId}?fields=title,lengthSeconds,author,videoThumbnails`,
      {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        }
      }
    );

    if (!response.ok) {
      throw new Error('Video not found');
    }

    const data = await response.json();

    // Get best quality thumbnail
    let thumbnail = `https://img.youtube.com/vi/${videoId}/maxresdefault.jpg`;
    if (data.videoThumbnails && data.videoThumbnails.length > 0) {
      const best = data.videoThumbnails.reduce((prev, current) => {
        return (prev.width * prev.height) > (current.width * current.height) ? prev : current;
      });
      thumbnail = `https://invidious.jotunder.com${best.url}`;
    }

    return NextResponse.json({
      title: data.title || 'Unknown Title',
      duration: data.lengthSeconds || 0,
      author: data.author || 'Unknown Author',
      thumbnail: thumbnail,
      videoId: videoId,
    });
  } catch (error) {
    console.error('Error fetching video info:', error);
    return NextResponse.json(
      { error: 'Failed to fetch video information. Make sure the URL is correct and the video is public.' },
      { status: 500 }
    );
  }
}
