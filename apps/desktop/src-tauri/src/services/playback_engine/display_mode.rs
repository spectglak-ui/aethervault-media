//! Modes d'affichage du lecteur (0.7.9) : Ajuster, Remplir, Étirer, Taille originale.
//!
//! ## Pourquoi côté mpv et pas en CSS
//! mpv dessine déjà la vidéo AVEC ses bandes noires dans une image de la taille de
//! la zone d'affichage (`keepaspect=yes`). L'image envoyée au canvas a donc le
//! format de la fenêtre : un `object-fit` CSS (cover, fill, none) sur cette image
//! ne change rien — ou, pour « Taille originale », rogne le centre de l'image au
//! lieu d'afficher la vidéo à sa taille. Les modes sont donc réglés dans mpv, qui
//! place aussi les sous-titres et l'OSD par rapport à la fenêtre (une vidéo
//! « remplie » et rognée garde ses sous-titres visibles).
//!
//! ## Réglages mpv (vérifiés avec libmpv 0.37, rendu logiciel `sw`)
//! | Mode            | keepaspect | video-unscaled | video-zoom (log2)              |
//! |-----------------|------------|----------------|--------------------------------|
//! | Ajuster         | yes        | no             | 0                              |
//! | Remplir         | yes        | no             | log2(échelle « remplir » / « ajuster ») |
//! | Étirer          | **no**     | no             | 0                              |
//! | Taille originale| yes        | **yes**        | log2(image rendue / taille écran) |
//!
//! `panscan` (le réglage « naturel » de Remplir) est SANS EFFET avec le rendu
//! logiciel de libmpv : « Remplir » passe donc par `video-zoom`.
//!
//! ## Taille originale et réduction du rendu
//! `video-unscaled` donne 1 pixel vidéo = 1 pixel de l'image RENDUE. Or cette image
//! est plafonnée (1920×1080) et réduite par l'échelle adaptative (voir
//! `sw_render.rs`), puis agrandie par le canvas : sans correction, la vidéo
//! paraîtrait trop grande sur un écran plus grand que le plafond. On applique donc
//! `video-zoom = log2(largeur rendue / largeur réelle de la zone)`.

use super::PlaybackEngineHandle;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DisplayMode {
    Contain,
    Cover,
    Stretch,
    Original,
}

impl DisplayMode {
    /// Valeurs du frontend : `contain` | `cover` | `stretch` | `original`.
    pub fn parse(raw: &str) -> Option<DisplayMode> {
        match raw {
            "contain" => Some(DisplayMode::Contain),
            "cover" => Some(DisplayMode::Cover),
            "stretch" => Some(DisplayMode::Stretch),
            "original" => Some(DisplayMode::Original),
            _ => None,
        }
    }
}

/// Dimensions (en pixels) nécessaires au calcul du zoom.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Geometry {
    /// Image RENDUE par mpv (plafonnée / réduite) = taille du canvas.
    pub buffer: (f64, f64),
    /// Zone d'affichage réelle, en pixels physiques (HiDPI compris).
    pub physical: (f64, f64),
    /// Taille d'affichage de la vidéo (`dwidth` × `dheight`, format corrigé).
    pub video: (f64, f64),
}

/// Réglages mpv correspondant à un mode.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Layout {
    pub keepaspect: bool,
    pub unscaled: bool,
    /// Valeur de `video-zoom` (logarithme base 2).
    pub zoom_log2: f64,
}

fn valid(pair: (f64, f64)) -> bool {
    pair.0.is_finite() && pair.1.is_finite() && pair.0 > 0.0 && pair.1 > 0.0
}

/// Plage acceptée par mpv pour `video-zoom`.
const ZOOM_LIMIT: f64 = 20.0;

pub fn layout_for(mode: DisplayMode, geometry: Geometry) -> Layout {
    let zoom_log2 = match mode {
        DisplayMode::Contain | DisplayMode::Stretch => 0.0,
        DisplayMode::Cover => {
            if valid(geometry.buffer) && valid(geometry.video) {
                let (bw, bh) = geometry.buffer;
                let (vw, vh) = geometry.video;
                let (sx, sy) = (bw / vw, bh / vh);
                (sx.max(sy) / sx.min(sy)).log2()
            } else {
                0.0
            }
        }
        DisplayMode::Original => {
            if valid(geometry.buffer) && valid(geometry.physical) {
                (geometry.buffer.0 / geometry.physical.0).log2()
            } else {
                0.0
            }
        }
    };
    Layout {
        keepaspect: mode != DisplayMode::Stretch,
        unscaled: mode == DisplayMode::Original,
        zoom_log2: zoom_log2.clamp(-ZOOM_LIMIT, ZOOM_LIMIT),
    }
}

impl PlaybackEngineHandle {
    /// Applique un mode d'affichage au média en cours (et aux suivants : les
    /// réglages mpv persistent d'un fichier à l'autre). À rappeler quand la
    /// géométrie ou le média changent (voir `PlayerSurface.tsx`).
    pub fn apply_display_mode(&self, mode: DisplayMode, buffer: (f64, f64), physical: (f64, f64)) -> Result<(), String> {
        // `dwidth` / `dheight` : taille d'affichage de la vidéo, format corrigé.
        // Absentes tant qu'aucune vidéo n'est chargée → zoom neutre, le frontend
        // ré-applique dès la première image.
        let video = (
            self.get_property_double("dwidth").unwrap_or(0.0),
            self.get_property_double("dheight").unwrap_or(0.0),
        );
        let layout = layout_for(mode, Geometry { buffer, physical, video });
        let yes_no = |value: bool| if value { "yes" } else { "no" };
        self.command(&["set", "keepaspect", yes_no(layout.keepaspect)])?;
        self.command(&["set", "video-unscaled", yes_no(layout.unscaled)])?;
        // `panscan` n'agit pas avec le rendu logiciel : on le garde à 0 pour qu'il
        // ne s'ajoute jamais au zoom calculé.
        self.command(&["set", "panscan", "0"])?;
        self.command(&["set", "video-zoom", &format!("{:.6}", layout.zoom_log2)])?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn geometry(buffer: (f64, f64), physical: (f64, f64), video: (f64, f64)) -> Geometry {
        Geometry { buffer, physical, video }
    }

    fn close(a: f64, b: f64) -> bool {
        (a - b).abs() < 1e-3
    }

    #[test]
    fn analyser_les_noms_du_frontend() {
        assert_eq!(DisplayMode::parse("contain"), Some(DisplayMode::Contain));
        assert_eq!(DisplayMode::parse("cover"), Some(DisplayMode::Cover));
        assert_eq!(DisplayMode::parse("stretch"), Some(DisplayMode::Stretch));
        assert_eq!(DisplayMode::parse("original"), Some(DisplayMode::Original));
        assert_eq!(DisplayMode::parse("fill"), None);
        assert_eq!(DisplayMode::parse(""), None);
    }

    #[test]
    fn ajuster_et_etirer_n_ont_pas_de_zoom() {
        let g = geometry((1280.0, 720.0), (1280.0, 720.0), (640.0, 480.0));
        let contain = layout_for(DisplayMode::Contain, g);
        assert_eq!(contain, Layout { keepaspect: true, unscaled: false, zoom_log2: 0.0 });
        let stretch = layout_for(DisplayMode::Stretch, g);
        assert_eq!(stretch, Layout { keepaspect: false, unscaled: false, zoom_log2: 0.0 });
    }

    /// Valeurs mesurées avec libmpv 0.37 (rendu logiciel) : 640×480 dans 1280×720
    /// → échelle « remplir » 2,0 contre « ajuster » 1,5 → log2(2/1,5) = 0,4150.
    #[test]
    fn remplir_zoome_jusqu_a_couvrir_toute_la_zone() {
        let l = layout_for(DisplayMode::Cover, geometry((1280.0, 720.0), (1280.0, 720.0), (640.0, 480.0)));
        assert!(l.keepaspect && !l.unscaled);
        assert!(close(l.zoom_log2, 0.41504), "{}", l.zoom_log2);
        // Vidéo 2,4:1 (1920×800) dans 1280×720 : log2(0,9 / 0,6667) = 0,4330.
        let l = layout_for(DisplayMode::Cover, geometry((1280.0, 720.0), (1280.0, 720.0), (1920.0, 800.0)));
        assert!(close(l.zoom_log2, 0.43296), "{}", l.zoom_log2);
    }

    #[test]
    fn remplir_sans_rognage_quand_les_formats_sont_identiques() {
        let l = layout_for(DisplayMode::Cover, geometry((1920.0, 1080.0), (1920.0, 1080.0), (1280.0, 720.0)));
        assert!(close(l.zoom_log2, 0.0));
    }

    #[test]
    fn taille_originale_compense_la_reduction_du_rendu() {
        // Zone 1280×720 rendue à 1280×720 : 1 pixel vidéo = 1 pixel écran.
        let l = layout_for(DisplayMode::Original, geometry((1280.0, 720.0), (1280.0, 720.0), (640.0, 480.0)));
        assert!(l.keepaspect && l.unscaled);
        assert!(close(l.zoom_log2, 0.0));
        // Écran 2560×1440 rendu plafonné à 1920×1080 (75 %) : zoom log2(0,75).
        let l = layout_for(DisplayMode::Original, geometry((1920.0, 1080.0), (2560.0, 1440.0), (1920.0, 1080.0)));
        assert!(close(l.zoom_log2, -0.41504), "{}", l.zoom_log2);
        // Échelle adaptative à 50 % sur une zone 1920×1080.
        let l = layout_for(DisplayMode::Original, geometry((960.0, 540.0), (1920.0, 1080.0), (1920.0, 1080.0)));
        assert!(close(l.zoom_log2, -1.0));
    }

    #[test]
    fn dimensions_inconnues_donnent_un_zoom_neutre() {
        for g in [
            geometry((1280.0, 720.0), (1280.0, 720.0), (0.0, 0.0)), // pas encore de vidéo
            geometry((0.0, 0.0), (1280.0, 720.0), (640.0, 480.0)),
            geometry((f64::NAN, 720.0), (0.0, 0.0), (640.0, f64::INFINITY)),
        ] {
            assert_eq!(layout_for(DisplayMode::Cover, g).zoom_log2, 0.0);
            assert_eq!(layout_for(DisplayMode::Original, g).zoom_log2, 0.0);
        }
    }

    #[test]
    fn le_zoom_reste_dans_la_plage_de_mpv() {
        let l = layout_for(DisplayMode::Cover, geometry((1e9, 1.0), (1.0, 1.0), (1.0, 1e9)));
        assert!(l.zoom_log2.abs() <= ZOOM_LIMIT);
    }
}
