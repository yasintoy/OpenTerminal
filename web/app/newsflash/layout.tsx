import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Newsflash — Commerce-1 Decision Replay",
  description: "Human versus Commerce-1 in a bounded paper-market news replay.",
};

export default function NewsflashLayout({ children }: { children: React.ReactNode }) {
  return children;
}
