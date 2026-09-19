import { useState } from "react";
import { youtubeReferences } from "./youtube";
import "./youtube.css";
export function YouTubeReferences({ text }: { text: string }) {
  const videos = youtubeReferences(text);
  return videos.length ? (
    <div className="youtube-references">
      {videos.map((video) => (
        <Video key={video.id} video={video} />
      ))}
    </div>
  ) : null;
}
function Video({
  video,
}: {
  video: ReturnType<typeof youtubeReferences>[number];
}) {
  const [loaded, setLoaded] = useState(false);
  return (
    <figure className="youtube-reference">
      {loaded ? (
        <iframe
          title="YouTube video player"
          src={`https://www.youtube-nocookie.com/embed/${video.id}?start=${video.start}&playsinline=1`}
          referrerPolicy="strict-origin-when-cross-origin"
          allow="encrypted-media; fullscreen; picture-in-picture"
          allowFullScreen
        />
      ) : (
        <button
          className="youtube-load"
          onClick={() => setLoaded(true)}
          aria-label="Load YouTube video player"
        >
          <span className="youtube-play" aria-hidden="true">
            ▶
          </span>
          <span>Play YouTube video</span>
        </button>
      )}
      <figcaption>
        <a href={video.url} target="_blank" rel="noopener">
          Watch on YouTube ↗
        </a>
        {loaded ? (
          <button onClick={() => setLoaded(false)}>Close player</button>
        ) : (
          <span>Loads from YouTube when opened</span>
        )}
      </figcaption>
    </figure>
  );
}
