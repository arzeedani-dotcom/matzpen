import type { MetadataRoute } from "next";
import { instance } from "@/config/instance";

/** Lets the app be installed on the phone's home screen and open full-screen. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: instance.productName,
    short_name: instance.productName,
    description: instance.tagline,
    lang: "he",
    dir: "rtl",
    start_url: "/",
    display: "standalone",
    background_color: "#0e3b43",
    theme_color: "#0e3b43",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
