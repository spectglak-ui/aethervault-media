/** Charge une seule fois le script API IFrame YouTube (partagé par la fiche d'un titre et le Héro de l'accueil). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function loadYouTubeApi(): Promise<any> {
  return new Promise((resolve) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const w = window as any;
    if (w.YT && w.YT.Player) {
      resolve(w.YT);
      return;
    }
    const previous = w.onYouTubeIframeAPIReady;
    w.onYouTubeIframeAPIReady = () => {
      previous?.();
      resolve(w.YT);
    };
    if (!document.querySelector('script[src="https://www.youtube.com/iframe_api"]')) {
      const script = document.createElement("script");
      script.src = "https://www.youtube.com/iframe_api";
      document.head.appendChild(script);
    }
  });
}
