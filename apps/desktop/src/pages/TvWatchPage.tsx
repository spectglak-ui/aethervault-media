import { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import {
  ArrowLeft, Volume2, VolumeX, Maximize, Minimize, Pause, Play, Radio, Tv,
} from "lucide-react";
import { tvApi, type TvChannel } from "../features/tv/api";
import { usePlayer } from "../player/PlayerContext";
import { PlayerSurface } from "../player/PlayerSurface";
import { playerApi } from "../features/player/api";

export function TvWatchPage() {
  const { id } = useParams<{ id: string }>();
  const channelId = Number(id);
  const navigate = useNavigate();
  const location = useLocation();
  const { play, stop, togglePlay, isPlaying, volume, muted, setVolumeLevel, toggleMuted, lastError } = usePlayer();
  const [channel, setChannel] = useState<TvChannel | null>(null);
  const [channels, setChannels] = useState<TvChannel[]>([]);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [localFs, setLocalFs] = useState(false);

  const playRef = useRef(play);
  playRef.current = play;
  const stopRef = useRef(stop);
  stopRef.current = stop;

  const killTvRef = useRef(() => {});
  killTvRef.current = () => {
    void playerApi.stop().catch(() => {});
    stopRef.current();
  };

  useEffect(() => {
    let cancelled = false;
    tvApi
      .listChannels()
      .then((list) => {
        if (cancelled) return;
        setChannels(list);
        setChannel(list.find((c) => c.id === channelId) ?? null);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [channelId]);

  useEffect(() => {
    if (!channel) return;
    playRef.current({
      id: -(1000 + channel.id),
      title: channel.name,
      path: channel.url,
      libraryId: -1,
    });
  }, [channel]);

  useEffect(() => {
    return () => {
      killTvRef.current();
    };
  }, []);

  useEffect(() => {
    if (location.pathname.startsWith("/tv/watch")) return;
    killTvRef.current();
  }, [location.pathname]);

  useEffect(() => {
    const onChange = () => setLocalFs(document.fullscreenElement === wrapRef.current);
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  const toggleLocalFs = () => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void wrapRef.current?.requestFullscreen();
  };

  if (!channel) {
    return <div className="afy-loader">Chargement de la chaîne…</div>;
  }

  return (
    <div className="afy-watch">
      <div className="afy-watch__primary">
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 12,
            padding: "0 0 12px",
          }}
        >
          <button
            type="button"
            className="afy-btn-secondary"
            onClick={async () => {
              killTvRef.current();
              await new Promise((r) => window.setTimeout(r, 100));
              navigate("/tv");
            }}
          >
            <ArrowLeft size={14} /> Chaînes
          </button>
          <div style={{ fontSize: 18, fontWeight: 800, color: "#eaf3f4" }}>{channel.name}</div>
          <span className="afy-card__live-dot" style={{ position: "static" }}>
            EN DIRECT
          </span>
        </div>
        <div className="afy-player-wrap" ref={wrapRef}>
          <PlayerSurface />
          {lastError && (
            <div
              style={{
                position: "absolute",
                inset: 0,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                background: "rgba(0,0,0,.72)",
                color: "#fb7185",
                fontSize: 13,
                textAlign: "center",
                padding: 24,
                zIndex: 5,
              }}
            >
              <div>
                <div style={{ fontWeight: 700, marginBottom: 6 }}>Flux indisponible</div>
                <div style={{ color: "#93a8af" }}>
                  Cette chaîne ne répond pas (les listes IPTV publiques contiennent
                  des flux morts). Zappez vers une autre chaîne via la colonne
                  « Zapping ».
                </div>
              </div>
            </div>
          )}
          <div className="afy-controls afy-controls--visible">
            <div className="afy-controls__row">
              <button
                type="button"
                className="afy-controls__btn"
                onClick={togglePlay}
                title={isPlaying ? "Pause" : "Lecture"}
              >
                {isPlaying ? <Pause size={18} /> : <Play size={18} />}
              </button>
              <span className="afy-controls__time">
                <Radio size={14} style={{ verticalAlign: "text-bottom" }} /> direct
              </span>
              <span style={{ flex: 1 }} />
              <button
                type="button"
                className="afy-controls__btn"
                onClick={toggleMuted}
                title={muted ? "Réactiver le son" : "Couper le son"}
              >
                {muted ? <VolumeX size={16} /> : <Volume2 size={16} />}
              </button>
              <input
                type="range"
                className="afy-controls__vol"
                min={0}
                max={1}
                step={0.05}
                value={muted ? 0 : volume}
                onChange={(e) => setVolumeLevel(Number(e.target.value))}
              />
              <button
                type="button"
                className="afy-controls__btn"
                onClick={toggleLocalFs}
                title="Plein écran"
              >
                {localFs ? <Minimize size={16} /> : <Maximize size={16} />}
              </button>
            </div>
          </div>
        </div>
      </div>
      <aside className="afy-watch__aside">
        <div className="afy-playlist">
          <div className="afy-playlist__head">
            <div>
              <div className="afy-playlist__title">Zapping</div>
              <div className="afy-playlist__sub">{channels.length} chaîne(s)</div>
            </div>
          </div>
          <div className="afy-playlist__list">
            {channels.map((c) => {
              const isActive = c.id === channel.id;
              return (
                <button
                  key={c.id}
                  type="button"
                  className={`afy-playlist-item${isActive ? " afy-playlist-item--active" : ""}`}
                  onClick={() => navigate(`/tv/watch/${c.id}`)}
                >
                  <div className="afy-playlist-item__thumb" style={{ display: "flex", alignItems: "center", justifyContent: "center" }}>
                    {c.logo_url ? (
                      <img
                        onError={(e) => { (e.currentTarget as HTMLImageElement).style.visibility = "hidden"; }}
                        src={c.logo_url} alt="" style={{ objectFit: "contain" }}
                      />
                    ) : (
                      <Tv size={16} style={{ color: "#93a8af" }} />
                    )}
                  </div>
                  <div className="afy-playlist-item__info">
                    <div className="afy-playlist-item__title">{c.name}</div>
                    <div className="afy-playlist-item__channel">
                      {c.group_name ?? "Sans catégorie"}
                      {isActive && " • à l'antenne"}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      </aside>
    </div>
  );
}