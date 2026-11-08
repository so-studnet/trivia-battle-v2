import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "雑学カードバトル",
    short_name: "雑学バトル",
    description: "本当？ウソ？友だちと雑学で対戦する2人用オンラインカードゲーム",
    start_url: "/",
    display: "standalone",
    background_color: "#f5f3ff",
    theme_color: "#6d28d9",
    icons: [{ src: "/icon.svg", sizes: "any", type: "image/svg+xml" }],
  };
}
