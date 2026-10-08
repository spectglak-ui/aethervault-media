import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Tv, Plus, Link2, Trash2, Download } from "lucide-react";
import { tvApi, IPTV_FR_URL, type TvChannel } from "../features/tv/api";
import { TvStreamGuard } from "../features/tv/TvStreamGuard";

export function TvPage() {
  const navigate = useNavigate();
  const [channels, setChannels] = useState<TvChannel[]>([]);
  const [loading, setLoading] = useState(true);
  const [group, setGroup] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setChannels(await tvApi.listChannels());
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const groups = useMemo(() => {
    const s = new Set<string>();
    channels.forEach((c) => c.group_name && s.add(c.group_name));
    return [...s].sort();
  }, [channels]);

  const shown = useMemo(
    () => (group ? channels.filter((c) => c.group_name === group) : channels),
    [channels, group]
  );

  const doImport = async (source: string) => {
    setImporting(true);
    setMsg(null);
    try {
      const n = await tvApi.importM3u(source, "fr");
      setMsg(`${n} chaîne(s) importée(s).`);
      await load();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Import impossible.");
    } finally {
      setImporting(false);
    }
  };

  const importPrompt = async () => {
    const src = window.prompt(
      "URL ou chemin local d'une playlist M3U/M3U8 :",
      IPTV_FR_URL
    );
    if (src?.trim()) await doImport(src.trim());
  };

  const addManual = async () => {
    const name = window.prompt("Nom de la chaîne :");
    if (!name?.trim()) return;
    const url = window.prompt("URL du flux (.m3u8 / HLS) :");
    if (!url?.trim()) return;
    try {
      await tvApi.addChannel({ name: name.trim(), url: url.trim() });
      await load();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Ajout impossible.");
    }
  };

  return (
    <div style={{ padding: "8px 24px 48px" }}>
      <div className="afy-page-head">
        <h1>
          <Tv size={20} style={{ color: "#2ec4b6" }} /> TV
        </h1>
        <div className="afy-page-head__actions">
          <TvStreamGuard />
          <button
            type="button"
            className="afy-btn-primary"
            disabled={importing}
            onClick={() => void doImport(IPTV_FR_URL)}
            title="Importe les chaînes françaises publiques agrégées par iptv-org"
          >
            <Download size={14} /> {importing ? "Import…" : "Chaînes FR officielles"}
          </button>
          <button type="button" className="afy-btn-secondary" onClick={() => void importPrompt()}>
            <Link2 size={14} /> Importer M3U
          </button>
          <button type="button" className="afy-btn-secondary" onClick={() => void addManual()}>
            <Plus size={14} /> Ajouter une chaîne
          </button>
        </div>
      </div>
      {msg && (
        <div style={{ margin: "10px 0", fontSize: 13, color: "#93a8af" }}>{msg}</div>
      )}
      {groups.length > 0 && (
        <div className="afy-chips" style={{ padding: "12px 0" }}>
          <button
            type="button"
            className={`afy-chip${group === null ? " afy-chip--active" : ""}`}
            onClick={() => setGroup(null)}
          >
            Toutes ({channels.length})
          </button>
          {groups.map((g) => (
            <button
              key={g}
              type="button"
              className={`afy-chip${group === g ? " afy-chip--active" : ""}`}
              onClick={() => setGroup(g)}
            >
              {g}
            </button>
          ))}
        </div>
      )}
      {loading && <div className="afy-loader">Chargement des chaînes…</div>}
      {!loading && channels.length === 0 && (
        <div className="afy-empty">
          <Tv size={40} className="afy-empty__icon" />
          <div className="afy-empty__title">Aucune chaîne pour l'instant</div>
          <div>
            Clique sur « Chaînes FR officielles » pour importer gratuitement les
            flux publics (info, TNT, international), ou importe ta propre
            playlist M3U.
          </div>
        </div>
      )}
      {!loading && shown.length > 0 && (
        <div className="afy-grid" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))" }}>
          {shown.map((c) => (
            <div key={c.id} className="afy-removable">
              <button
                type="button"
                className="afy-sub-card"
                style={{ cursor: "pointer", width: "100%" }}
                onClick={() => navigate(`/tv/watch/${c.id}`)}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                  <div
                    style={{
                      width: 56,
                      height: 56,
                      borderRadius: 12,
                      background: "rgba(255,255,255,.06)",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      overflow: "hidden",
                      flexShrink: 0,
                    }}
                  >
                    {c.logo_url ? (
                      <img
                        onError={(e) => {
                          (e.currentTarget as HTMLImageElement).style.visibility = "hidden";
                        }}
                        src={c.logo_url}
                        alt=""
                        style={{ width: "100%", height: "100%", objectFit: "contain" }}
                      />
                    ) : (
                      <Tv size={22} style={{ color: "#93a8af" }} />
                    )}
                  </div>
                  <div style={{ minWidth: 0 }}>
                    <div
                      style={{
                        fontSize: 14,
                        fontWeight: 700,
                        color: "#eaf3f4",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {c.name}
                    </div>
                    <div style={{ fontSize: 11, color: "#93a8af", marginTop: 2 }}>
                      {c.group_name ?? "Sans catégorie"}
                    </div>
                  </div>
                </div>
              </button>
              <button
                type="button"
                className="afy-remove-btn"
                title="Supprimer la chaîne"
                onClick={() => {
                  if (window.confirm(`Supprimer « ${c.name} » ?`)) {
                    void tvApi.removeChannel(c.id).then(() => load());
                  }
                }}
              >
                <Trash2 size={14} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}