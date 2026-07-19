import type { Metadata } from "next";
import { WeaverApp } from "./WeaverApp";

export const metadata: Metadata = {
  description: "Weave user-owned sources into portable, verifiable context.",
};

export default function Home() {
  return <WeaverApp />;
}
