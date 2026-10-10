"use client";

import dynamic from "next/dynamic";

const NewsflashTerminal = dynamic(() => import("../../components/NewsflashTerminal"), {
  ssr: false,
});

export default function NewsflashPage() {
  return <NewsflashTerminal />;
}
